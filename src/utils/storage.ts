import { useState, useEffect } from "react";
import type {
  Assignment,
  ChecklistTask,
  Hymn,
  Member,
  Notification,
  Planner,
  PlannerApprovalRequest,
  ReminderJob,
  SettingsChangeRequest,
  TodoItem,
  UnitSettings,
  User,
} from "../types";
import { backendEnabled, exportRemoteDB, importRemoteDB, apiPost, pingBackend } from "./backend";

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
  PLANNER_APPROVAL_REQUESTS: PlannerApprovalRequest[];
  TODOS: TodoItem[];
  REMINDERS: ReminderJob[];
  HYMNS: Hymn[];
};

const nowISO = () => new Date().toISOString();

let remoteSyncTimer: number | null = null;
let remoteSyncInFlight = false;
let remotePullInFlight = false;
let suppressRemoteSync = 0;
let hasPendingPush = false; // Track if local changes are waiting to be sent

let cachedDB: DB | null = null;
let lastSyncedDB: DB | null = null;
let syncListeners: ((syncing: boolean) => void)[] = [];

const SYNC_TABLES: { name: keyof DB; idCol: string }[] = [
  { name: "USERS", idCol: "user_id" },
  { name: "PLANNERS", idCol: "planner_id" },
  { name: "ASSIGNMENTS", idCol: "assignment_id" },
  { name: "MEMBERS", idCol: "name" },
  { name: "CHECKLISTS", idCol: "checklist_id" },
  { name: "NOTIFICATIONS", idCol: "notification_id" },
  { name: "SETTINGS_REQUESTS", idCol: "request_id" },
  { name: "PLANNER_APPROVAL_REQUESTS", idCol: "request_id" },
  { name: "TODOS", idCol: "todo_id" },
  { name: "REMINDERS", idCol: "reminder_id" },
  { name: "HYMNS", idCol: "number" },
];

const REMOTE_DELETABLE_TABLES = new Set<keyof DB>(["MEMBERS", "NOTIFICATIONS", "TODOS"]);

const dbListeners = new Set<() => void>();
function notifyDBListeners() {
  dbListeners.forEach((l) => l());
}

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

function asText(value: unknown) {
  return typeof value === "string" ? value : String(value ?? "");
}

function sanitizeMemberRecord(raw: any) {
  const name = asText(raw?.name).trim();
  const ageValue = raw?.age;
  const parsedAge =
    ageValue === undefined || ageValue === null || String(ageValue).trim() === ""
      ? undefined
      : Number(ageValue);

  return {
    member_id: name || asText(raw?.member_id).trim(),
    name,
    gender: asText(raw?.gender).trim(),
    age: Number.isFinite(parsedAge) ? parsedAge : undefined,
    phone: asText(raw?.phone).trim(),
    email: asText(raw?.email).trim(),
    organisation: asText(raw?.organisation).trim(),
    status: asText(raw?.status).trim(),
    notes: asText(raw?.notes).trim(),
    created_date: asText(raw?.created_date).trim() || undefined,
  };
}

function sanitizeUserRecord(raw: any) {
  return {
    user_id: asText(raw?.user_id).trim(),
    name: asText(raw?.name).trim(),
    preferred_name: asText(raw?.preferred_name).trim() || undefined,
    username: asText(raw?.username).trim() || undefined,
    email: asText(raw?.email).trim(),
    password_hash: asText(raw?.password_hash || raw?.password || raw?.passwordHash).trim(),
    role: raw?.role,
    organisation: asText(raw?.organisation).trim() || undefined,
    calling: asText(raw?.calling).trim() || undefined,
    phone: asText(raw?.phone).trim() || undefined,
    whatsapp: asText(raw?.whatsapp).trim() || undefined,
    gender: asText(raw?.gender).trim() || undefined,
    address: asText(raw?.address).trim() || undefined,
    lga: asText(raw?.lga).trim() || undefined,
    state: asText(raw?.state).trim() || undefined,
    country: asText(raw?.country).trim() || undefined,
    emergency_contact_name: asText(raw?.emergency_contact_name).trim() || undefined,
    emergency_contact_phone: asText(raw?.emergency_contact_phone).trim() || undefined,
    signature_data_url: asText(raw?.signature_data_url).trim() || undefined,
    notes: asText(raw?.notes).trim() || undefined,
    created_date: asText(raw?.created_date).trim(),
    last_login_date: asText(raw?.last_login_date).trim() || undefined,
    must_reset_password: raw?.must_reset_password === true || String(raw?.must_reset_password).toLowerCase() === "true",
    disabled: raw?.disabled === true || String(raw?.disabled).toLowerCase() === "true",
  };
}

function serializeUserForRemote(raw: any) {
  const user = sanitizeUserRecord(raw);
  return {
    user_id: user.user_id,
    name: user.name,
    preferred_name: user.preferred_name || "",
    username: user.username || "",
    email: user.email,
    password_hash: user.password_hash,
    role: user.role || "",
    organisation: user.organisation || "",
    calling: user.calling || "",
    phone: user.phone || "",
    whatsapp: user.whatsapp || "",
    gender: user.gender || "",
    address: user.address || "",
    lga: user.lga || "",
    state: user.state || "",
    country: user.country || "",
    emergency_contact_name: user.emergency_contact_name || "",
    emergency_contact_phone: user.emergency_contact_phone || "",
    signature_data_url: user.signature_data_url || "",
    notes: user.notes || "",
    created_date: user.created_date || "",
    last_login_date: user.last_login_date || "",
    must_reset_password: !!user.must_reset_password,
    disabled: !!user.disabled,
  };
}

function serializeMemberForRemote(raw: any) {
  const member = sanitizeMemberRecord(raw);
  return {
    name: member.name,
    gender: member.gender || "",
    age: member.age ?? "",
    phone: member.phone || "",
    email: member.email || "",
    organisation: member.organisation || "",
    status: member.status || "",
    notes: member.notes || "",
  };
}

function serializeDBForRemote(db: DB): DB {
  return {
    ...db,
    USERS: db.USERS.map((user) => serializeUserForRemote(user) as any),
    MEMBERS: db.MEMBERS.map((member) => serializeMemberForRemote(member) as any),
  };
}

function serializeRowForRemote(tableName: keyof DB | "UNIT_SETTINGS", row: any) {
  if (tableName === "USERS") return serializeUserForRemote(row);
  if (tableName === "MEMBERS") return serializeMemberForRemote(row);
  return row;
}

function getComparableRow(tableName: keyof DB, row: any) {
  return serializeRowForRemote(tableName, row);
}

function normalizeDB(raw: any): DB {
  const USERS0 = Array.isArray(raw?.USERS) ? (raw.USERS as any[]).map((u) => sanitizeUserRecord(u) as User) : [];

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

  const now = new Date();

  const PLANNERS_RAW = Array.isArray(raw?.PLANNERS)
    ? (raw.PLANNERS as any[]).map((p) => {
        let state = p.state;
        let archive_method = p.archive_method;
        let archive_date = p.archive_date;
        const year = parseInt(p.year, 10);
        const month = parseInt(p.month, 10);

        if (state === "SUBMITTED" && !isNaN(year) && !isNaN(month)) {
          const threshold = new Date(year, month + 1, 1);
          if (now >= threshold) {
            console.log(`[AutoArchive] Archiving expired planner: ${month}/${year}`);
            state = "ARCHIVED";
            archive_method = "auto";
            archive_date = now.toISOString();
          }
        }

        return {
        ...p,
        state,
        archive_method,
        archive_date,
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
        };
      })
    : [];

  const PLANNERS = PLANNERS_RAW.filter((p) => {
    if (p.state === "ARCHIVED") {
      const method = p.archive_method || "manual";
      const dateStr = p.archive_date || p.updated_date || p.created_date;
      if (dateStr) {
        const days = (now.getTime() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24);
        if (method === "manual" && days >= 30) return false;
        if (method === "auto" && days >= 365) return false;
      }
    }
    return true;
  });

  const base: DB = {
    UNIT_SETTINGS: raw?.UNIT_SETTINGS ?? null,
    USERS,
    PLANNERS,
    ASSIGNMENTS: Array.isArray(raw?.ASSIGNMENTS) ? raw.ASSIGNMENTS : [],
    MEMBERS: Array.isArray(raw?.MEMBERS) ? raw.MEMBERS.map((m: any) => sanitizeMemberRecord(m) as Member) : [],
    CHECKLISTS: Array.isArray(raw?.CHECKLISTS) ? raw.CHECKLISTS : [],
    NOTIFICATIONS: Array.isArray(raw?.NOTIFICATIONS) ? raw.NOTIFICATIONS : [],
    SETTINGS_REQUESTS: Array.isArray(raw?.SETTINGS_REQUESTS) ? raw.SETTINGS_REQUESTS : [],
    PLANNER_APPROVAL_REQUESTS: Array.isArray(raw?.PLANNER_APPROVAL_REQUESTS) ? raw.PLANNER_APPROVAL_REQUESTS : [],
    TODOS: Array.isArray(raw?.TODOS) ? raw.TODOS : [],
    REMINDERS: Array.isArray(raw?.REMINDERS) ? raw.REMINDERS : [],
    HYMNS: Array.isArray(raw?.HYMNS) ? raw.HYMNS : [],
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
    db.REMINDERS.length === 0 &&
    db.HYMNS.length === 0
  );
}

const VERSION_KEY = "sac_meeting_planner_db_version_v1";

function getLocalDBVersion(): number {
  const v = localStorage.getItem(VERSION_KEY);
  return v ? parseInt(v, 10) : 0;
}

function setLocalDBVersion(v: number) {
  localStorage.setItem(VERSION_KEY, String(v));
}

export async function forcePushChanges(): Promise<boolean> {
  if (!backendEnabled()) return true;
  await pushAllToBackend();
  return !hasPendingPush;
}

function scheduleRemoteSync() {
  if (!backendEnabled() || suppressRemoteSync > 0) return;
  hasPendingPush = true; // Mark as dirty
  if (remoteSyncTimer) window.clearTimeout(remoteSyncTimer);
  remoteSyncTimer = window.setTimeout(() => {
    void pushAllToBackend();
  }, 120);
}

async function pushAllToBackend() {
  if (!backendEnabled() || suppressRemoteSync > 0) return;
  if (remoteSyncInFlight) return;
  remoteSyncInFlight = true;
  notifySyncListeners(true);
  try {
      const db = serializeDBForRemote(getDB());
    if (!lastSyncedDB) {
      console.log(`[Sync] Baseline missing. Pushing local changes via full merge... (${db.PLANNERS.length} planners, ${db.USERS.length} users)`);
      const importRes = await importRemoteDB(db, "merge");
      if (importRes && importRes.db_version) {
        setLocalDBVersion(importRes.db_version);
      }
    } else {
      console.log(`[Sync] Calculating row-level differences for backend push...`);
      const updates: any[] = [];
      const deletes: any[] = [];
      
      for (const t of SYNC_TABLES) {
        const currentRows = (db[t.name] || []) as any[];
        const lastRows = (lastSyncedDB[t.name] || []) as any[];
        
        const currentMap = new Map(currentRows.map(r => [String(r[t.idCol] || ""), r]));
        const lastMap = new Map(lastRows.map(r => [String(r[t.idCol] || ""), r]));

        // Find updates (new or modified)
        for (const r of currentRows) {
          const id = String(r[t.idCol] || "");
          if (!id) continue;
          const old = lastMap.get(id);
          const nextComparable = getComparableRow(t.name, r);
          const oldComparable = old ? getComparableRow(t.name, old) : null;
          if (!oldComparable || JSON.stringify(oldComparable) !== JSON.stringify(nextComparable)) {
            updates.push({ table: t.name, row: nextComparable });
          }
        }

        // Find deletes
        if (REMOTE_DELETABLE_TABLES.has(t.name)) {
          for (const r of lastRows) {
            const id = String(r[t.idCol] || "");
            if (!id) continue;
            if (!currentMap.has(id)) {
              deletes.push({ table: t.name, id });
            }
          }
        }
      }

      // Handle UNIT_SETTINGS (special case, object not array)
      if (JSON.stringify(db.UNIT_SETTINGS) !== JSON.stringify(lastSyncedDB.UNIT_SETTINGS)) {
        // Just push the entire UNIT_SETTINGS object as an update row
        updates.push({ table: "UNIT_SETTINGS", row: db.UNIT_SETTINGS });
      }

      if (updates.length > 0 || deletes.length > 0) {
        console.log(`[Sync] Syncing ${updates.length} updates, ${deletes.length} deletes.`);
        const res = await apiPost<any>({ action: "sync_v2", changes: { updates, deletes } });
        if (!res.ok) throw new Error(res.error || "sync_v2 failed");
        if ((res as any).db_version) {
          setLocalDBVersion((res as any).db_version);
        }
      } else {
        console.log("[Sync] No differences found. Push skipped.");
      }
    }
    hasPendingPush = false; // Successfully pushed
    lastSyncedDB = serializeDBForRemote(getDB()); // Keep baseline in backend-comparable shape
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
  notifyDBListeners();
  if (!suppressRemote) scheduleRemoteSync();
}

function mergeDatabases(local: DB, remote: DB): { merged: DB; needsPush: boolean } {
  const merged: DB = { ...local };
  let needsPush = false;

  for (const t of SYNC_TABLES) {
    const localRows = (local[t.name] || []) as any[];
    const remoteRows = (remote[t.name] || []) as any[];

    const localMap = new Map(localRows.map(r => [String(r[t.idCol] || ""), r]));
    const remoteMap = new Map(remoteRows.map(r => [String(r[t.idCol] || ""), r]));

    const mergedRows: any[] = [];
    const allIds = new Set([...localMap.keys(), ...remoteMap.keys()]);

    for (const id of allIds) {
      const l = localMap.get(id);
      const r = remoteMap.get(id);

      if (l && r) {
        // Exists in both. Compare updated_date or fallback to remote
        const lDate = l.updated_date || l.created_date || "";
        const rDate = r.updated_date || r.created_date || "";
        if (lDate && rDate && lDate > rDate) {
          mergedRows.push(l);
          needsPush = true; // Local is newer, need to push
        } else {
          mergedRows.push(r);
        }
      } else if (l) {
        // Exists only locally (not yet pushed to remote)
        mergedRows.push(l);
        needsPush = true;
      } else if (r) {
        // Exists only remotely
        mergedRows.push(r);
      }
    }

    (merged as any)[t.name] = mergedRows;
  }

  // Merge UNIT_SETTINGS
  merged.UNIT_SETTINGS = {
    ...(remote.UNIT_SETTINGS || {}),
    ...(local.UNIT_SETTINGS || {})
  } as any;

  if (JSON.stringify(local.UNIT_SETTINGS) !== JSON.stringify(merged.UNIT_SETTINGS)) {
    needsPush = true;
  }

  return { merged, needsPush };
}

export async function syncFromBackend(options?: { force?: boolean; replaceLocal?: boolean }): Promise<boolean> {
  if (!backendEnabled()) return false;
  const force = options?.force === true;
  const replaceLocal = options?.replaceLocal === true;
  if (remotePullInFlight) return false;
  if (!force && hasPendingPush) {
    console.log("[Sync] Local changes pending. Attempting push before pull.");
    await pushAllToBackend();
    if (hasPendingPush) {
      console.log("[Sync] Pull skipped: pending push still not persisted.");
      return false;
    }
  }

  const local = getDB();

  // Perform a lightweight version check via ping to avoid heavy export downloads
  try {
    const pingData = await pingBackend();
    if (pingData && pingData.db_version !== undefined) {
      const localVer = getLocalDBVersion();
      const remoteVer = pingData.db_version;
      console.log(`[Sync] Version check - Local: ${localVer}, Remote: ${remoteVer}`);
      
      // If versions match, and we don't have an empty local DB, skip the pull!
      if (!force && localVer === remoteVer && !isEmptyDB(local)) {
        console.log("[Sync] DB versions match. Skip pulling remote database.");
        return true;
      }
    }
  } catch (err) {
    console.warn("[Sync] Lightweight version check failed, falling back to full export:", err);
  }

  remotePullInFlight = true;
  notifySyncListeners(true);
  try {
    const remoteResult = await exportRemoteDB();
    if (!remoteResult) {
      console.warn("[Sync] Remote DB export returned null/empty.");
      return false;
    }
    const remote = remoteResult.data;
    const remoteVersion = remoteResult.db_version;

    const normalizedRemote = normalizeDB(remote);
    const comparableRemote = serializeDBForRemote(normalizedRemote);
    
    // Set the baseline in backend-comparable shape. This is critical for computing diffs later.
    lastSyncedDB = comparableRemote;

    console.log(`[Sync] Remote data: ${normalizedRemote.USERS.length} users, ${normalizedRemote.PLANNERS.length} planners`);

    // Perform a safe merge of local and remote databases unless the caller requested a full local refresh.
    const { merged, needsPush } = replaceLocal
      ? { merged: normalizedRemote, needsPush: false }
      : mergeDatabases(local, normalizedRemote);

    // Re-check hasPendingPush after remote fetch to avoid race during network call
    if (!force && hasPendingPush) {
      console.warn("[Sync] Local became dirty during remote fetch. Aborting overwrite to prevent data loss.");
      return false;
    }

    suppressRemoteSync += 1;
    try {
      setDBInternal(merged, true);
      // Keep baseline in backend-comparable form so row diffs use the same key/value shape as the server.
      lastSyncedDB = comparableRemote;
      if (remoteVersion) {
        setLocalDBVersion(remoteVersion);
      }
      console.log("[Sync] Local DB updated and safely merged with remote.");
    } finally {
      suppressRemoteSync -= 1;
    }

    if (!replaceLocal && needsPush) {
      console.log("[Sync] Local changes detected that are not on remote. Scheduling push...");
      scheduleRemoteSync();
    }

    return true;
  } catch (err) {
    console.warn("[Sync] Sync from backend failed:", err);
    return false;
  } finally {
    remotePullInFlight = false;
    notifySyncListeners(false);
  }
}

export async function syncNow(): Promise<boolean> {
  if (!backendEnabled()) return false;
  try {
    return await syncFromBackend({ force: true, replaceLocal: true });
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
    PLANNER_APPROVAL_REQUESTS: [],
    TODOS: [],
    REMINDERS: [],
    HYMNS: [],
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
  notifyDBListeners();
  scheduleRemoteSync();
}

/**
 * Reactive hooks for database tables
 */

export function useTable<K extends keyof DB>(tableName: K) {
  const [data, setData] = useState<DB[K]>(() => getDB()[tableName]);

  useEffect(() => {
    const handler = () => {
      setData(getDB()[tableName]);
    };
    dbListeners.add(handler);
    return () => {
      dbListeners.delete(handler);
    };
  }, [tableName]);

  return { data, loading: false, error: null };
}

export function useUpsertMutation<K extends keyof DB>(tableName: K) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const mutate = (item: any) => {
    setLoading(true);
    try {
      updateDB((db) => {
        const table = db[tableName];
        if (!Array.isArray(table)) return db;

        const idField = (tableName === "USERS" ? "user_id" : 
                        tableName === "PLANNERS" ? "planner_id" :
                        tableName === "ASSIGNMENTS" ? "assignment_id" :
                        tableName === "MEMBERS" ? "member_id" :
                        tableName === "CHECKLISTS" ? "checklist_id" :
                        tableName === "NOTIFICATIONS" ? "notification_id" :
                        tableName === "SETTINGS_REQUESTS" ? "request_id" :
                        tableName === "PLANNER_APPROVAL_REQUESTS" ? "request_id" :
                        tableName === "TODOS" ? "todo_id" :
                        tableName === "REMINDERS" ? "reminder_id" :
                        tableName === "HYMNS" ? "number" : "id") as string;

        const id = item[idField];
        const existingIdx = table.findIndex((x: any) => x[idField] === id);
        
        let nextTable;
        if (existingIdx >= 0) {
          nextTable = [...table];
          nextTable[existingIdx] = { ...nextTable[existingIdx], ...item };
        } else {
          nextTable = [item, ...table];
        }

        return { ...db, [tableName]: nextTable };
      });
      setLoading(false);
    } catch (err: any) {
      console.error(`Upsert mutation failed for ${tableName}:`, err);
      setError(err instanceof Error ? err : new Error(String(err)));
      setLoading(false);
    }
  };

  return { mutate, loading, error };
}
