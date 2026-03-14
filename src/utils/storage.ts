import type {
  Assignment,
  ChecklistTask,
  Member,
  Notification,
  Planner,
  ReminderJob,
  SettingsChangeRequest,
  TodoItem,
  UnitSettings,
  User,
} from "../types";
import { backendEnabled, exportRemoteDB, importRemoteDB } from "./backend";

const APP_KEY = "sac_meeting_planner_mvp_v1";

export type DB = {
  UNIT_SETTINGS: UnitSettings | null;
  USERS: User[];
  PLANNERS: Planner[];
  ASSIGNMENTS: Assignment[];
  MEMBERS: Member[];
  CHECKLISTS: ChecklistTask[];
  NOTIFICATIONS: Notification[];
  SETTINGS_REQUESTS: SettingsChangeRequest[];
  TODOS: TodoItem[];
  REMINDERS: ReminderJob[];
};

const nowISO = () => new Date().toISOString();

let remoteSyncTimer: number | null = null;
let remoteSyncInFlight = false;
let suppressRemoteSync = 0;

let cachedDB: DB | null = null;
let syncListeners: ((syncing: boolean) => void)[] = [];

function notifySyncListeners(syncing: boolean) {
  syncListeners.forEach((l) => l(syncing));
}

export function onSyncStatusChange(listener: (syncing: boolean) => void) {
  syncListeners.push(listener);
  return () => {
    syncListeners = syncListeners.filter((l) => l !== listener);
  };
}

function safeParse<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function normalizeDB(raw: any): DB {
  const USERS0 = Array.isArray(raw?.USERS) ? (raw.USERS as User[]) : [];

  // Migration: ensure every user has a unique username.
  const used = new Set<string>();
  for (const u of USERS0) {
    if (u.username) used.add(u.username.toLowerCase());
  }

  function slug(s: string) {
    return (s || "")
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace(/[^a-z0-9._-]/g, "")
      .slice(0, 24);
  }

  function unique(base: string) {
    let candidate = base || "user";
    let i = 1;
    while (used.has(candidate.toLowerCase())) {
      i += 1;
      candidate = `${base}${i}`;
    }
    used.add(candidate.toLowerCase());
    return candidate;
  }

  const USERS = USERS0.map((u) => {
    // Backward/alternate schema support: some sheets use "password" instead of "password_hash".
    const password_hash =
      (u as any).password_hash ||
      (u as any).password ||
      (u as any).passwordHash ||
      (u as any).password_hash;

    const merged = password_hash ? { ...u, password_hash } : u;

    if (merged.username && merged.username.trim()) return merged;
    const fromEmail = u.email ? slug(u.email.split("@")[0] || "") : "";
    const fromName = slug(u.name);
    const base = fromEmail || fromName || "user";
    return { ...merged, username: unique(base) };
  });

  const toArr = (v: any): string[] => {
    if (Array.isArray(v)) return v.map((x) => String(x || "").trim()).filter(Boolean);
    const s = String(v || "").trim();
    if (!s) return [];
    return s
      .split(/[;,]/g)
      .map((x) => x.trim())
      .filter(Boolean);
  };

  const PLANNERS = Array.isArray(raw?.PLANNERS)
    ? (raw.PLANNERS as any[]).map((p) => ({
        ...p,
        weeks: Array.isArray(p?.weeks)
          ? p.weeks.map((w: any) => ({
              ...w,
              sacrament: {
                preparing: toArr(w?.sacrament?.preparing),
                blessing: toArr(w?.sacrament?.blessing),
                passing: toArr(w?.sacrament?.passing),
              },
              note: typeof w?.note === "string" ? w.note : "",
            }))
          : [],
      }))
    : [];

  const base: DB = {
    UNIT_SETTINGS: raw?.UNIT_SETTINGS ?? null,
    USERS,
    PLANNERS,
    ASSIGNMENTS: Array.isArray(raw?.ASSIGNMENTS) ? raw.ASSIGNMENTS : [],
    MEMBERS: Array.isArray(raw?.MEMBERS) ? raw.MEMBERS : [],
    CHECKLISTS: Array.isArray(raw?.CHECKLISTS) ? raw.CHECKLISTS : [],
    NOTIFICATIONS: Array.isArray(raw?.NOTIFICATIONS) ? raw.NOTIFICATIONS : [],
    SETTINGS_REQUESTS: Array.isArray(raw?.SETTINGS_REQUESTS) ? raw.SETTINGS_REQUESTS : [],
    TODOS: Array.isArray(raw?.TODOS) ? raw.TODOS : [],
    REMINDERS: Array.isArray(raw?.REMINDERS) ? raw.REMINDERS : [],
  };
  return base;
}

function isEmptyDB(db: DB): boolean {
  return (
    !db.UNIT_SETTINGS &&
    db.USERS.length === 0 &&
    db.PLANNERS.length === 0 &&
    db.ASSIGNMENTS.length === 0 &&
    db.MEMBERS.length === 0 &&
    db.CHECKLISTS.length === 0 &&
    db.NOTIFICATIONS.length === 0 &&
    db.SETTINGS_REQUESTS.length === 0 &&
    db.TODOS.length === 0 &&
    db.REMINDERS.length === 0
  );
}

function scheduleRemoteSync() {
  if (!backendEnabled() || suppressRemoteSync > 0) return;
  if (remoteSyncTimer) window.clearTimeout(remoteSyncTimer);
  remoteSyncTimer = window.setTimeout(() => {
    void pushAllToBackend();
  }, 800);
}

async function pushAllToBackend() {
  if (!backendEnabled() || suppressRemoteSync > 0) return;
  if (remoteSyncInFlight) return;
  remoteSyncInFlight = true;
  notifySyncListeners(true);
  try {
    const db = getDB();
    console.log(`[Sync] Pushing local changes to backend... (${db.PLANNERS.length} planners, ${db.USERS.length} users)`);
    await importRemoteDB(db, "merge");
    console.log("[Sync] Push successful.");
  } catch (err) {
    console.warn("[Sync] Push failed:", err);
  } finally {
    remoteSyncInFlight = false;
    notifySyncListeners(false);
  }
}

function setDBInternal(next: DB, suppressRemote?: boolean) {
  cachedDB = next;
  localStorage.setItem(APP_KEY, JSON.stringify(next));
  if (!suppressRemote) scheduleRemoteSync();
}

export async function syncFromBackend(): Promise<boolean> {
  if (!backendEnabled()) return false;
  notifySyncListeners(true);
  try {
    const remote = await exportRemoteDB();
    if (!remote) {
      console.warn("[Sync] Remote DB export returned null/empty.");
      return false;
    }

    const local = getDB();
    const normalizedRemote = normalizeDB(remote);

    console.log(`[Sync] Remote data: ${normalizedRemote.USERS.length} users, ${normalizedRemote.PLANNERS.length} planners`);

    // Guard against remote data missing UNIT_SETTINGS (common misconfig / empty sheet).
    // Keep local settings and seed the backend instead of forcing re-setup.
    if (!normalizedRemote.UNIT_SETTINGS && local.UNIT_SETTINGS) {
      console.log("[Sync] Remote missing UNIT_SETTINGS. Merging local to remote.");
      await importRemoteDB(local, "merge");
      return true;
    }

    if (isEmptyDB(normalizedRemote) && !isEmptyDB(local)) {
      console.log("[Sync] Remote is empty but local is not. Merging local to remote.");
      await importRemoteDB(local, "merge");
      return true;
    }

    // CRITICAL: Ensure we don't accidentally lose the current user from USERS list
    // if they exist locally but not remotely (e.g. sync delay or partial sheet).
    // However, if the sheet is the source of truth, we must be careful.
    // For now, let's just log it if the local user list is significantly larger.
    if (local.USERS.length > normalizedRemote.USERS.length) {
      console.warn(`[Sync] Local has ${local.USERS.length} users, remote has ${normalizedRemote.USERS.length}. Possible data loss?`);
    }

    suppressRemoteSync += 1;
    try {
      setDBInternal(normalizedRemote, true);
      console.log("[Sync] Local DB updated from remote.");
    } finally {
      suppressRemoteSync -= 1;
    }

    return true;
  } catch (err) {
    console.warn("[Sync] Sync from backend failed:", err);
    return false;
  } finally {
    notifySyncListeners(false);
  }
}

export async function syncNow(): Promise<boolean> {
  if (!backendEnabled()) return false;
  try {
    const local = getDB();
    await importRemoteDB(local, "merge");
    return await syncFromBackend();
  } catch (err) {
    console.warn("Manual sync failed", err);
    return false;
  }
}

export function getDB(): DB {
  if (cachedDB) return cachedDB;

  const existing = safeParse<any>(localStorage.getItem(APP_KEY));
  if (existing) {
    const normalized = normalizeDB(existing);

    const needsPersist =
      !Array.isArray((existing as any).NOTIFICATIONS) ||
      !Array.isArray((existing as any).SETTINGS_REQUESTS) ||
      !Array.isArray((existing as any).TODOS) ||
      !Array.isArray((existing as any).REMINDERS) ||
      (Array.isArray((existing as any).USERS) && (existing as any).USERS.some((u: any) => !u?.username));

    if (needsPersist) {
      localStorage.setItem(APP_KEY, JSON.stringify(normalized));
    }
    cachedDB = normalized;
    return normalized;
  }
  const fresh: DB = {
    UNIT_SETTINGS: null,
    USERS: [],
    PLANNERS: [],
    ASSIGNMENTS: [],
    MEMBERS: [],
    CHECKLISTS: [],
    NOTIFICATIONS: [],
    SETTINGS_REQUESTS: [],
    TODOS: [],
    REMINDERS: [],
  };
  localStorage.setItem(APP_KEY, JSON.stringify(fresh));
  cachedDB = fresh;
  return fresh;
}

export function setDB(next: DB) {
  setDBInternal(next);
}

export function updateDB(mutator: (db: DB) => DB) {
  const db = getDB();
  const next = mutator(db);
  setDBInternal(next);
  return next;
}

export const ids = {
  uid(prefix: string) {
    return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
  },
};

export const time = {
  nowISO,
};

export function resetDB() {
  cachedDB = null;
  localStorage.removeItem(APP_KEY);
  scheduleRemoteSync();
}

