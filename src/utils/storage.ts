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
  Agenda,
  CalendarActivity,
  OtherChurchProgram,
  PublicHoliday,
  CalendarContact,
  CalendarReportLog,
  Bulletin,
} from "../types";
import { backendEnabled } from "./backend";
import { pullAllFromSheets, pushAllToSheets, getSheetsMetadata, isGasConfigured } from "./sheetsBackend";
import { BUNDLED_HYMNS } from "./hymnsCatalog";
import { ensureAugust2026PlannerInDB } from "./augustPlannerSeed";

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
  AGENDAS: Agenda[];
  ACTIVITIES: CalendarActivity[];
  "OTHER CHURCH PROGRAM": OtherChurchProgram[];
  "PUBLIC HOLIDAY": PublicHoliday[];
  CONTACTS: CalendarContact[];
  "REPORT LOG": CalendarReportLog[];
  BULLETINS: Bulletin[];
};

function safeParseJSON<T>(val: any, fallback: T): T {
  if (val === null || val === undefined) return fallback;
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (!trimmed) return fallback;
    try {
      const parsed = JSON.parse(trimmed);
      return parsed !== null && parsed !== undefined ? parsed : fallback;
    } catch (e) {
      return fallback;
    }
  }
  return val as T;
}

const nowISO = () => new Date().toISOString();

let remoteSyncTimer: number | null = null;
let remoteSyncInFlight = false;
let remotePullInFlight = false;
let lastPullTime = 0;
let suppressRemoteSync = 0;
let hasPendingPush = false; // Track if local changes are waiting to be sent

let cachedDB: DB | null = null;
const LAST_SYNCED_KEY = "sac_meeting_planner_last_synced_v1";
let lastSyncedDB: DB | null = null;
try {
  const raw = localStorage.getItem(LAST_SYNCED_KEY);
  if (raw) {
    lastSyncedDB = JSON.parse(raw);
  }
} catch (e) {
  console.warn("Failed to load lastSyncedDB from localStorage:", e);
}

function setLastSyncedDB(db: DB | null) {
  lastSyncedDB = db;
  if (!db) {
    try {
      localStorage.removeItem(LAST_SYNCED_KEY);
    } catch (e) {}
    return;
  }
  safeSaveToLocalStorage(LAST_SYNCED_KEY, db);
}

let syncListeners: ((syncing: boolean) => void)[] = [];
const realtimeCollectionUnsubscribers: Array<() => void> = [];

export const SYNC_TABLES: { name: keyof DB; idCol: string }[] = [
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
  { name: "AGENDAS", idCol: "agenda_id" },
  { name: "ACTIVITIES", idCol: "activity_id" },
  { name: "OTHER CHURCH PROGRAM", idCol: "program_id" },
  { name: "PUBLIC HOLIDAY", idCol: "holiday_id" },
  { name: "CONTACTS", idCol: "contact_id" },
  { name: "REPORT LOG", idCol: "log_id" },
  { name: "BULLETINS", idCol: "bulletin_id" },
];

export const COLLECTION_MAPPING: Record<keyof DB, string> = {
  UNIT_SETTINGS: "unit_settings",
  USERS: "users",
  PLANNERS: "planners",
  ASSIGNMENTS: "assignments",
  MEMBERS: "members",
  CHECKLISTS: "checklists",
  NOTIFICATIONS: "notifications",
  SETTINGS_REQUESTS: "settings_requests",
  PLANNER_APPROVAL_REQUESTS: "planner_approval_requests",
  TODOS: "todos",
  REMINDERS: "reminders",
  HYMNS: "hymns",
  AGENDAS: "agendas",
  ACTIVITIES: "activities",
  "OTHER CHURCH PROGRAM": "other_church_programs",
  "PUBLIC HOLIDAY": "public_holidays",
  CONTACTS: "contacts",
  "REPORT LOG": "report_logs",
  BULLETINS: "bulletins",
};

const REMOTE_DELETABLE_TABLES = new Set<keyof DB>([
  "MEMBERS",
  "NOTIFICATIONS",
  "TODOS",
  "ACTIVITIES",
  "OTHER CHURCH PROGRAM",
  "PUBLIC HOLIDAY",
  "CONTACTS",
  "REPORT LOG",
  "BULLETINS",
  "PLANNERS",
  "AGENDAS",
  "ASSIGNMENTS",
  "CHECKLISTS"
]);

const SYNC_POLL_INTERVAL_MS = 15 * 1000;

const dbListeners = new Set<() => void>();
function notifyDBListeners() {
  dbListeners.forEach((l) => l());
}

export function onDBChange(listener: () => void) {
  dbListeners.add(listener);
  return () => {
    dbListeners.delete(listener);
  };
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

export function cleanDateToYYYYMMDD(val: any): string {
  if (!val) return "";
  const s = String(val).trim();
  if (s.includes("T")) {
    return s.split("T")[0];
  }
  if (s.includes(" ")) {
    return s.split(" ")[0];
  }
  return s;
}

export function isCorruptActivityName(name: string | undefined | null): boolean {
  if (!name) return true;
  const s = String(name).trim().toLowerCase();
  if (!s) return true;
  if (s === "---" || s === "-" || s === "--" || s === "not set" || s === "tbd" || s === "bd" || s === "null" || s === "undefined") {
    return true;
  }
  return false;
}

function sanitizeMemberRecord(raw: any) {
  const name = asText(raw?.name).replace(/\s+/g, " ").trim();
  const ageValue = raw?.age;
  const parsedAge =
    ageValue === undefined || ageValue === null || String(ageValue).trim() === ""
      ? undefined
      : Number(ageValue);

  return {
    member_id: name || asText(raw?.member_id).replace(/\s+/g, " ").trim(),
    name,
    gender: asText(raw?.gender).trim(),
    age: Number.isFinite(parsedAge) ? parsedAge : undefined,
    phone: asText(raw?.phone).trim(),
    email: asText(raw?.email).trim(),
    birth_date: cleanDateToYYYYMMDD(raw?.birth_date) || undefined,
    organisation: asText(raw?.organisation).trim(),
    status: asText(raw?.status).trim(),
    notes: asText(raw?.notes).trim(),
    created_date: cleanDateToYYYYMMDD(raw?.created_date) || undefined,
    total_assignments: raw?.total_assignments !== undefined && raw?.total_assignments !== null && raw?.total_assignments !== "" ? Number(raw.total_assignments) : undefined,
    spoken_count: raw?.spoken_count !== undefined && raw?.spoken_count !== null && raw?.spoken_count !== "" ? Number(raw.spoken_count) : undefined,
    prayers_count: raw?.prayers_count !== undefined && raw?.prayers_count !== null && raw?.prayers_count !== "" ? Number(raw.prayers_count) : undefined,
    last_assigned_date: asText(raw?.last_assigned_date).trim() || undefined,
    readiness_score: raw?.readiness_score !== undefined && raw?.readiness_score !== null && raw?.readiness_score !== "" ? Number(raw.readiness_score) : undefined,
  };
}

function sanitizeUserRecord(raw: any) {
  const disabledVal = String(raw?.disabled ?? "").trim().toLowerCase();
  const isDisabled = disabledVal === "true" || disabledVal === "1" || disabledVal === "yes" || disabledVal === "y";

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
    signature_data_url: asText(raw?.signature_data_url || raw?.signatureDataUrl).trim() || undefined,
    notes: asText(raw?.notes).trim() || undefined,
    created_date: asText(raw?.created_date).trim() || undefined,
    last_login_date: asText(raw?.last_login_date || raw?.lastLoginDate).trim() || undefined,
    must_reset_password: raw?.must_reset_password === true || raw?.must_reset_password === "true" || raw?.must_reset_password === 1 || String(raw?.must_reset_password).toLowerCase() === "yes",
    disabled: isDisabled,
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
    total_assignments: member.total_assignments ?? "",
    spoken_count: member.spoken_count ?? "",
    prayers_count: member.prayers_count ?? "",
    last_assigned_date: member.last_assigned_date || "",
    readiness_score: member.readiness_score ?? "",
  };
}

export function removeUndefined<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== "object") return obj;
  try {
    const jsonClean = JSON.parse(JSON.stringify(obj));
    return sanitizeDeep(jsonClean) as T;
  } catch (e) {
    return sanitizeDeep(obj) as T;
  }
}

function sanitizeDeep(val: any): any {
  if (val === undefined) return null;
  if (val === null || typeof val !== "object") return val;
  if (Array.isArray(val)) {
    return val.map((item) => sanitizeDeep(item)).filter((item) => item !== undefined);
  }
  const res: Record<string, any> = {};
  for (const key of Object.keys(val)) {
    const v = val[key];
    if (v !== undefined) {
      res[key] = sanitizeDeep(v);
    }
  }
  return res;
}

function serializeDBForRemote(db: DB): DB {
  const customHymns = (db.HYMNS || []).filter((h) => h.hymn_id && !h.hymn_id.startsWith("h_"));
  return removeUndefined({
    ...db,
    HYMNS: customHymns,
    USERS: db.USERS.map((user) => serializeUserForRemote(user) as any),
    MEMBERS: db.MEMBERS.map((member) => serializeMemberForRemote(member) as any),
  });
}

function serializeRowForRemote(tableName: keyof DB | "UNIT_SETTINGS", row: any) {
  let res = row;
  if (tableName === "USERS") res = serializeUserForRemote(row);
  else if (tableName === "MEMBERS") res = serializeMemberForRemote(row);
  return removeUndefined(res);
}

function getComparableRow(tableName: keyof DB, row: any) {
  return serializeRowForRemote(tableName, row);
}

function normalizeDB(raw: any): DB {
  const USERS0 = Array.isArray(raw?.USERS) ? (raw.USERS as any[]).map((u) => sanitizeUserRecord(u) as User) : [];

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
    const parsed = safeParseJSON(v, v);
    if (Array.isArray(parsed)) return parsed.map((x) => String(x || "").trim()).filter(Boolean);
    const s = String(parsed || "").trim();
    if (!s) return [];
    return s
      .split(/[;,]/g)
      .map((x) => x.trim())
      .filter(Boolean);
  };

  const PLANNERS_RAW = Array.isArray(raw?.PLANNERS)
    ? (raw.PLANNERS as any[]).map((p) => {
        let state = p.state;
        let archive_method = p.archive_method;
        let archive_date = p.archive_date;
        const weeksParsed = safeParseJSON(p?.weeks, p?.weeks);

        return {
          ...p,
          state,
          archive_method,
          archive_date,
          weeks: Array.isArray(weeksParsed)
            ? weeksParsed.map((w: any) => ({
                ...w,
                speakers: Array.isArray(safeParseJSON(w?.speakers, w?.speakers))
                  ? safeParseJSON(w?.speakers, w?.speakers)
                  : [],
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

  const PLANNERS = PLANNERS_RAW;

  const AGENDAS = Array.isArray(raw?.AGENDAS)
    ? (raw.AGENDAS as any[]).map((a) => {
        const parseArr = (field: any, defaultArr: any[] = []) => {
          const res = safeParseJSON(field, field);
          return Array.isArray(res) ? res : defaultArr;
        };
        return {
          ...a,
          state: a.state || "DRAFT",
          speakers: parseArr(a.speakers, []),
          announcements: parseArr(a.announcements, ["", "", "", "", "", ""]),
          releases: parseArr(a.releases, []),
          calls: parseArr(a.calls, []),
          baptized_children: parseArr(a.baptized_children, ["", "", "", ""]),
          aaronic_ordinations: parseArr(a.aaronic_ordinations, []),
          aaronic_advancements: parseArr(a.aaronic_advancements, []),
          achievements: parseArr(a.achievements, ["", "", "", ""]),
          babies: parseArr(a.babies, []),
          confirmations: parseArr(a.confirmations, []),
          fellowships: parseArr(a.fellowships, ["", "", "", "", "", "", "", ""]),
        };
      })
    : [];

  const BULLETINS = Array.isArray(raw?.BULLETINS)
    ? (raw.BULLETINS as any[]).map((b) => {
        const parseArr = (field: any) => {
          const res = safeParseJSON(field, field);
          return Array.isArray(res) ? res : [];
        };
        return {
          ...b,
          activities: parseArr(b.activities),
          birthdays: parseArr(b.birthdays),
          missionaries: parseArr(b.missionaries),
          self_reliance_classes: parseArr(b.self_reliance_classes),
          welfare_reminders: parseArr(b.welfare_reminders),
          upcoming_events: parseArr(b.upcoming_events),
        };
      })
    : [];

  const rawHymns = Array.isArray(raw?.HYMNS) ? raw.HYMNS : [];
  const customHymns = rawHymns.filter((h: any) => h.hymn_id && !h.hymn_id.startsWith("h_"));
  const HYMNS = [...BUNDLED_HYMNS, ...customHymns];

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
    HYMNS,
    AGENDAS,
    ACTIVITIES: Array.isArray(raw?.ACTIVITIES)
      ? raw.ACTIVITIES.map((a: any) => ({
          ...a,
          date: cleanDateToYYYYMMDD(a.date),
        }))
      : [],
    "OTHER CHURCH PROGRAM": Array.isArray(raw?.["OTHER CHURCH PROGRAM"]) ? raw["OTHER CHURCH PROGRAM"] : [],
    "PUBLIC HOLIDAY": Array.isArray(raw?.["PUBLIC HOLIDAY"]) ? raw["PUBLIC HOLIDAY"] : [],
    CONTACTS: Array.isArray(raw?.CONTACTS) ? raw.CONTACTS : [],
    "REPORT LOG": Array.isArray(raw?.["REPORT LOG"]) ? raw["REPORT LOG"] : [],
    BULLETINS,
  };

  const deduplicated: DB = { ...base };
  for (const t of SYNC_TABLES) {
    const list = base[t.name];
    if (Array.isArray(list)) {
      const seen = new Set<string>();
      const cleanList: any[] = [];
      for (const item of list) {
        let id = String((item as any)?.[t.idCol] || "").trim().toLowerCase();
        if (t.name === "ACTIVITIES") {
          const act = item as CalendarActivity;
          if (isCorruptActivityName(act.activity)) continue;
          const cleanDate = cleanDateToYYYYMMDD(act.date);
          const cleanTitle = (act.activity || "").trim().toLowerCase();
          const cleanOrg = (act.organisation || "WARD").trim().toLowerCase();
          id = `${cleanDate}_${cleanTitle}_${cleanOrg}`;
        } else if (t.name === "MEMBERS") {
          const mem = item as Member;
          const cleanName = (mem.name || "").replace(/\s+/g, " ").trim();
          if (!cleanName) continue;
          id = cleanName.toLowerCase();
        }
        if (id && !seen.has(id)) {
          seen.add(id);
          cleanList.push(item);
        }
      }
      deduplicated[t.name] = cleanList as any;
    }
  }
  return ensureAugust2026PlannerInDB(deduplicated);
}

export function isEmptyDB(db: DB): boolean {
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
    db.HYMNS.length === 0 &&
    db.AGENDAS.length === 0 &&
    db.ACTIVITIES.length === 0 &&
    db["OTHER CHURCH PROGRAM"].length === 0 &&
    db["PUBLIC HOLIDAY"].length === 0 &&
    db.CONTACTS.length === 0 &&
    db["REPORT LOG"].length === 0 &&
    db.BULLETINS.length === 0
  );
}

const VERSION_KEY = "sac_meeting_planner_db_version_v1";

export function getLocalDBVersion(): number {
  const v = localStorage.getItem(VERSION_KEY);
  return v ? parseInt(v, 10) : 0;
}

export function setLocalDBVersion(v: number) {
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

type DBMetadata = {
  versions: Record<string, number>;
  last_updated: string;
  db_reset_version?: number;
};

const METADATA_KEY = "sac_meeting_planner_db_metadata_v2";
const LAST_SYNC_TIME_KEY = "sac_meeting_planner_last_sync_time_v2";
let metadataListenerUnsubscribe: (() => void) | null = null;

export async function touchRemoteMetadata(changedTable?: keyof DB) {
  scheduleRemoteSync();
}

let currentPushPromise: Promise<void> | null = null;

async function pushAllToBackend(): Promise<void> {
  if (!backendEnabled() || suppressRemoteSync > 0) return;
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    hasPendingPush = true;
    return;
  }
  if (currentPushPromise) {
    await currentPushPromise;
    return;
  }

  currentPushPromise = (async () => {
    remoteSyncInFlight = true;
    hasPendingPush = false;
    notifySyncListeners(true);
    try {
      const dbData = serializeDBForRemote(getDB());
      console.log("[Sync] Pushing database updates to Google Sheets...");
      const res = await pushAllToSheets(dbData);
      
      if (res.success) {
        const nextSyncTime = new Date().toISOString();
        localStorage.setItem(LAST_SYNC_TIME_KEY, nextSyncTime);
        if (res.metadata) {
          localStorage.setItem(METADATA_KEY, JSON.stringify(res.metadata));
        }
        setLastSyncedDB(serializeDBForRemote(getDB()));
        console.log("[Sync] Google Sheets sync successful.");
      } else {
        hasPendingPush = true;
      }
    } catch (err: any) {
      console.warn("[Sync] Google Sheets push failed:", err);
      hasPendingPush = true;
    } finally {
      remoteSyncInFlight = false;
      notifySyncListeners(false);
      currentPushPromise = null;
      if (hasPendingPush) {
        scheduleRemoteSync();
      }
    }
  })();

  return currentPushPromise;
}

function trimDBForStorage(db: DB): DB {
  const customHymns = (db.HYMNS || []).filter((h) => h.hymn_id && !h.hymn_id.startsWith("h_"));
  return {
    ...db,
    HYMNS: customHymns,
  };
}

function safeSaveToLocalStorage(key: string, db: DB) {
  const trimmed = trimDBForStorage(db);
  try {
    localStorage.setItem(key, JSON.stringify(trimmed));
  } catch (err: any) {
    if (err?.name === "QuotaExceededError" || err?.code === 22 || String(err).includes("quota")) {
      console.warn(`[Storage] LocalStorage quota exceeded for ${key}. Pruning old logs, notifications & reminders...`);
      const prunedDB: DB = {
        ...trimmed,
        NOTIFICATIONS: (trimmed.NOTIFICATIONS || []).slice(0, 30),
        "REPORT LOG": (trimmed["REPORT LOG"] || []).slice(0, 20),
        REMINDERS: (trimmed.REMINDERS || []).slice(0, 30),
        TODOS: (trimmed.TODOS || []).slice(0, 30),
      };

      try {
        localStorage.setItem(key, JSON.stringify(prunedDB));
        return;
      } catch (err2) {
        console.warn(`[Storage] Secondary pruning required for ${key}...`);
        const slimDB: DB = {
          ...prunedDB,
          USERS: (prunedDB.USERS || []).map((u) => ({ ...u, signature_data_url: undefined })),
          NOTIFICATIONS: (prunedDB.NOTIFICATIONS || []).slice(0, 10),
          "REPORT LOG": [],
        };
        try {
          localStorage.setItem(key, JSON.stringify(slimDB));
        } catch (err3) {
          console.error(`[Storage] Fatal: Unable to write ${key} to localStorage despite pruning.`, err3);
        }
      }
    } else {
      console.error(`[Storage] Failed to save ${key} to localStorage:`, err);
    }
  }
}

function setDBInternal(next: DB, suppressRemote?: boolean) {
  cachedDB = next;
  safeSaveToLocalStorage(APP_KEY, next);
  notifyDBListeners();
  if (!suppressRemote) scheduleRemoteSync();
}

function isLocalModified(tableName: keyof DB, id: string, localRow: any): boolean {
  if (!lastSyncedDB) return true;
  const lastRows = (lastSyncedDB[tableName] || []) as any[];
  const idCol = SYNC_TABLES.find((t) => t.name === tableName)?.idCol || "id";
  const old = lastRows.find((r) => String(r[idCol] || "") === id);
  if (!old) return true;
  const nextComparable = getComparableRow(tableName, localRow);
  const oldComparable = getComparableRow(tableName, old);
  return JSON.stringify(oldComparable) !== JSON.stringify(nextComparable);
}

function isRemoteModified(tableName: keyof DB, id: string, remoteRow: any): boolean {
  if (!lastSyncedDB) return false;
  const lastRows = (lastSyncedDB[tableName] || []) as any[];
  const idCol = SYNC_TABLES.find((t) => t.name === tableName)?.idCol || "id";
  const old = lastRows.find((r) => String(r[idCol] || "") === id);
  if (!old) return true;
  const remoteComparable = getComparableRow(tableName, remoteRow);
  const oldComparable = getComparableRow(tableName, old);
  return JSON.stringify(oldComparable) !== JSON.stringify(remoteComparable);
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
        const lDate = l.updated_date || l.created_date || "";
        const rDate = r.updated_date || r.created_date || "";
        if (lDate && rDate && lDate > rDate && isLocalModified(t.name, id, l)) {
          mergedRows.push(l);
          needsPush = true;
        } else if (lDate && rDate && rDate > lDate) {
          mergedRows.push(r);
        } else {
          if (isLocalModified(t.name, id, l)) {
            mergedRows.push(l);
            needsPush = true;
          } else {
            mergedRows.push(r);
          }
        }
      } else if (l) {
        // Exists locally but not on remote (new item created locally)
        mergedRows.push(l);
        needsPush = true;
      } else if (r) {
        // Exists on remote but not locally
        // Check if item was present in lastSyncedDB (meaning it was deleted locally)
        const wasInLastSync = lastSyncedDB && (lastSyncedDB[t.name] || []).some((lastR: any) => String(lastR[t.idCol] || "") === id);
        if (wasInLastSync) {
          // Local user deleted this item; do not resurrect it from remote, push deletion to remote
          needsPush = true;
        } else {
          mergedRows.push(r);
        }
      }
    }

    // Business key deduplication for ACTIVITIES and MEMBERS to prevent duplicate IDs from coexisting
    if (t.name === "ACTIVITIES") {
      const seenKey = new Set<string>();
      const cleanList: any[] = [];
      for (const item of mergedRows) {
        if (isCorruptActivityName((item as CalendarActivity).activity)) continue;
        const cleanDate = cleanDateToYYYYMMDD((item as CalendarActivity).date);
        const cleanTitle = ((item as CalendarActivity).activity || "").trim().toLowerCase();
        const cleanOrg = ((item as CalendarActivity).organisation || "WARD").trim().toLowerCase();
        const bKey = `${cleanDate}_${cleanTitle}_${cleanOrg}`;
        if (bKey && !seenKey.has(bKey)) {
          seenKey.add(bKey);
          cleanList.push(item);
        }
      }
      (merged as any).ACTIVITIES = cleanList;
    } else if (t.name === "MEMBERS") {
      const seenKey = new Set<string>();
      const cleanList: any[] = [];
      for (const item of mergedRows) {
        const cleanName = ((item as Member).name || "").replace(/\s+/g, " ").trim();
        if (!cleanName) continue;
        const bKey = cleanName.toLowerCase();
        if (bKey && !seenKey.has(bKey)) {
          seenKey.add(bKey);
          cleanList.push(item);
        }
      }
      (merged as any).MEMBERS = cleanList;
    } else {
      (merged as any)[t.name] = mergedRows;
    }
  }

  merged.UNIT_SETTINGS = {
    ...(remote.UNIT_SETTINGS || {}),
    ...(local.UNIT_SETTINGS || {})
  } as any;

  if (JSON.stringify(local.UNIT_SETTINGS) !== JSON.stringify(merged.UNIT_SETTINGS)) {
    needsPush = true;
  }

  return { merged, needsPush };
}

let sheetsPollingTimer: number | null = null;

export function initializeFirebaseSync() {
  initializeSheetsSync();
}

export function initializeSheetsSync() {
  if (!backendEnabled()) return;
  if (sheetsPollingTimer) return;

  console.log("[Sync] Initializing Google Sheets polling sync...");
  
  sheetsPollingTimer = window.setInterval(async () => {
    if (remoteSyncInFlight || remotePullInFlight) return;
    const remoteMeta = await getSheetsMetadata();
    if (remoteMeta && remoteMeta.last_updated) {
      const localLastSyncTime = localStorage.getItem(LAST_SYNC_TIME_KEY) || "";
      if (remoteMeta.last_updated > localLastSyncTime) {
        console.log("[Sync] Remote Google Sheets changes detected. Triggering pull...");
        void syncFromBackend({ force: false });
      }
    }
  }, 30 * 1000);
}

export function updateLocalTableFromFirebase(tableName: keyof DB, remoteRows: any[]) {
  updateDB((local) => {
    const idCol = SYNC_TABLES.find((t) => t.name === tableName)?.idCol || "id";
    const localRows = (local[tableName] || []) as any[];
    const localMap = new Map(localRows.map(r => [String(r[idCol] || ""), r]));
    
    const mergedRows = remoteRows.map((remoteRow) => {
      const id = String(remoteRow[idCol] || "");
      const localRow = localMap.get(id);
      if (localRow) {
        const lDate = localRow.updated_date || localRow.created_date || "";
        const rDate = remoteRow.updated_date || remoteRow.created_date || "";
        if (lDate && rDate && lDate > rDate && isLocalModified(tableName, id, localRow)) {
          return localRow;
        }
      }
      return remoteRow;
    });
    
    const remoteIds = new Set(remoteRows.map(r => String(r[idCol] || "")));
    for (const localRow of localRows) {
      const id = String(localRow[idCol] || "");
      if (!remoteIds.has(id)) {
        const wasInLastSync = lastSyncedDB && (lastSyncedDB[tableName] || []).some((lastR: any) => String(lastR[idCol] || "") === id);
        if (!wasInLastSync || isLocalModified(tableName, id, localRow)) {
          mergedRows.push(localRow);
        }
      }
    }
    
    return {
      ...local,
      [tableName]: mergedRows
    };
  }, true);
}

export async function syncFromBackend(options?: { force?: boolean; replaceLocal?: boolean }): Promise<boolean> {
  if (!backendEnabled()) return false;
  if (typeof navigator !== "undefined" && !navigator.onLine) return false;
  const force = options?.force === true;
  const replaceLocal = options?.replaceLocal === true;

  if (remotePullInFlight) return false;
  remotePullInFlight = true;
  notifySyncListeners(true);

  try {
    if (!force && hasPendingPush) {
      console.log("[Sync] Local changes pending. Attempting push before pull.");
      await pushAllToBackend();
    }

    const local = getDB();

    console.log("[Sync] Pulling updates from Google Sheets...");
    const remoteRes = await pullAllFromSheets();
    if (!remoteRes || !remoteRes.db) {
      console.warn("[Sync] Google Sheets pull returned empty or failed.");
      return false;
    }

    const remoteSnap = remoteRes.db;
    const remoteMeta = remoteRes.metadata || {};

    const normalizedRemote = normalizeDB(remoteSnap);
    const comparableRemote = serializeDBForRemote(normalizedRemote);

    const { merged, needsPush } = replaceLocal
      ? { merged: normalizedRemote, needsPush: false }
      : mergeDatabases(local, normalizedRemote);

    suppressRemoteSync += 1;
    try {
      setDBInternal(merged, true);
      setLastSyncedDB(serializeDBForRemote(merged));
      lastPullTime = Date.now();
      
      const nextSyncTime = remoteMeta.last_updated || new Date().toISOString();
      localStorage.setItem(LAST_SYNC_TIME_KEY, nextSyncTime);
      localStorage.setItem(METADATA_KEY, JSON.stringify(remoteMeta));

      console.log("[Sync] Local DB successfully hydrated from Google Sheets.");
    } finally {
      suppressRemoteSync -= 1;
    }

    initializeSheetsSync();

    if (!replaceLocal && needsPush) {
      scheduleRemoteSync();
    }

    return true;
  } catch (err) {
    console.warn("[Sync] Google Sheets hydration failed:", err);
    return false;
  } finally {
    remotePullInFlight = false;
    notifySyncListeners(false);
  }
}

export async function syncNow(): Promise<boolean> {
  if (!backendEnabled()) return false;
  try {
    await forcePushChanges();
    return await syncFromBackend({ force: true, replaceLocal: false });
  } catch (err) {
    console.warn("Manual sync failed", err);
    return false;
  }
}

export function getDB(): DB {
  if (cachedDB) return cachedDB;

  const existing = safeParse<any>(localStorage.getItem(APP_KEY));
  if (existing) {
    const normalized = removeUndefined(normalizeDB(existing));

    const needsPersist =
      !Array.isArray((existing as any).NOTIFICATIONS) ||
      !Array.isArray((existing as any).SETTINGS_REQUESTS) ||
      !Array.isArray((existing as any).TODOS) ||
      !Array.isArray((existing as any).REMINDERS) ||
      !Array.isArray((existing as any).BULLETINS) ||
      (Array.isArray((existing as any).USERS) && (existing as any).USERS.some((u: any) => !u?.username));

    if (needsPersist) {
      safeSaveToLocalStorage(APP_KEY, normalized);
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
    HYMNS: BUNDLED_HYMNS,
    AGENDAS: [],
    ACTIVITIES: [],
    "OTHER CHURCH PROGRAM": [],
    "PUBLIC HOLIDAY": [],
    CONTACTS: [],
    "REPORT LOG": [],
    BULLETINS: [],
  };
  safeSaveToLocalStorage(APP_KEY, fresh);
  cachedDB = fresh;
  return fresh;
}

export function setDB(next: DB) {
  setDBInternal(next);
}

export function updateDB(mutator: (db: DB) => DB, suppressSync = false) {
  const db = getDB();
  const next = mutator(db);
  setDBInternal(next, suppressSync);
  return next;
}

export const ids = {
  uid(prefix: string) {
    return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
  },
};

export const time = {
  now: nowISO,
  nowISO,
};

export function resetDB() {
  cachedDB = null;
  localStorage.removeItem(APP_KEY);
  notifyDBListeners();
  scheduleRemoteSync();
}

export function useTable<K extends keyof DB>(tableName: K) {
  const [data, setData] = useState<DB[K]>(() => {
    const val = getDB()[tableName];
    if (tableName === "UNIT_SETTINGS") return val;
    return Array.isArray(val) ? val : ([] as any);
  });

  useEffect(() => {
    const handler = () => {
      const val = getDB()[tableName];
      if (tableName === "UNIT_SETTINGS") {
        setData(val);
      } else {
        setData(Array.isArray(val) ? val : ([] as any));
      }
    };
    dbListeners.add(handler);
    return () => {
      dbListeners.delete(handler);
    };
  }, [tableName]);

  return { data, loading: false, error: null };
}

export function useDB(): DB {
  const [db, setDb] = useState<DB>(() => getDB());

  useEffect(() => {
    const handler = () => {
      setDb(getDB());
    };
    dbListeners.add(handler);
    return () => {
      dbListeners.delete(handler);
    };
  }, []);

  return db;
}

export function useUpsertMutation<K extends keyof DB>(tableName: K) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const mutate = (item: any) => {
    setLoading(true);
    try {
      updateDB((db) => {
        let table = db[tableName] as any;
        if (!Array.isArray(table)) {
          if (tableName === "UNIT_SETTINGS") return db;
          table = [];
          (db as any)[tableName] = table;
        }

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
                        tableName === "HYMNS" ? "number" :
                        tableName === "AGENDAS" ? "agenda_id" : "id") as string;

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

export async function triggerDatabaseReset(options?: { mode?: "merge" | "replace" }) {
  if (!backendEnabled()) return;
  const mode = options?.mode || "replace";
  
  try {
    console.log(`[Reset] Pushing clean local DB state to Google Sheets (mode: ${mode})...`);
    const dbData = serializeDBForRemote(getDB());
    const res = await pushAllToSheets(dbData, { mode });
    if (!res.success) {
      throw new Error("Unable to push cleaned database to Google Sheets backend.");
    }
    setLastSyncedDB(dbData);
    console.log("[Reset] Clean database pushed successfully to Google Sheets.");
  } catch (err) {
    console.error("[Reset] Database reset failed:", err);
    throw err;
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    console.log("[Sync] Network connectivity restored. Pushing pending local changes...");
    if (hasPendingPush) {
      void pushAllToBackend();
    }
  });
}
