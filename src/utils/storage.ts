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
} from "../types";
import { db } from "./firebase";
import { backendEnabled } from "./backend";
import { 
  collection, 
  doc, 
  getDocs, 
  getDoc,
  setDoc, 
  deleteDoc, 
  onSnapshot,
  query,
  where
} from "firebase/firestore";
import { uploadSignature } from "./firebaseStorage";
import { BUNDLED_HYMNS } from "./hymnsCatalog";

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
};

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
  try {
    if (db) {
      localStorage.setItem(LAST_SYNCED_KEY, JSON.stringify(db));
    } else {
      localStorage.removeItem(LAST_SYNCED_KEY);
    }
  } catch (e) {
    console.warn("Failed to save lastSyncedDB to localStorage:", e);
  }
}

let syncListeners: ((syncing: boolean) => void)[] = [];

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
  "PLANNERS",
  "AGENDAS",
  "ASSIGNMENTS",
  "CHECKLISTS"
]);

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
    total_assignments: raw?.total_assignments !== undefined && raw?.total_assignments !== null && raw?.total_assignments !== "" ? Number(raw.total_assignments) : undefined,
    spoken_count: raw?.spoken_count !== undefined && raw?.spoken_count !== null && raw?.spoken_count !== "" ? Number(raw.spoken_count) : undefined,
    prayers_count: raw?.prayers_count !== undefined && raw?.prayers_count !== null && raw?.prayers_count !== "" ? Number(raw.prayers_count) : undefined,
    last_assigned_date: asText(raw?.last_assigned_date).trim() || undefined,
    readiness_score: raw?.readiness_score !== undefined && raw?.readiness_score !== null && raw?.readiness_score !== "" ? Number(raw.readiness_score) : undefined,
  };
}

function sanitizeUserRecord(raw: any) {
  return {
    user_id: asText(raw?.user_id).trim(),
    name: asText(raw?.name).trim(),
    preferred_name: asText(raw?.preferred_name).trim() || undefined,
    username: asText(raw?.username).trim() || undefined,
    email: asText(raw?.email).trim().replace(/\s+/g, "."),
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
    must_reset_password: raw?.must_reset_password === true || raw?.must_reset_password === "true" || raw?.must_reset_password === 1,
    disabled: raw?.disabled === true || raw?.disabled === "true" || raw?.disabled === 1,
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
    if (Array.isArray(v)) return v.map((x) => String(x || "").trim()).filter(Boolean);
    const s = String(v || "").trim();
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

  const PLANNERS = PLANNERS_RAW;

  const AGENDAS = Array.isArray(raw?.AGENDAS)
    ? (raw.AGENDAS as any[]).map(a => ({
        ...a,
        state: a.state || "DRAFT",
        speakers: Array.isArray(a.speakers) ? a.speakers : [],
        announcements: Array.isArray(a.announcements) ? a.announcements : ["", "", "", "", "", ""],
        releases: Array.isArray(a.releases) ? a.releases : [],
        calls: Array.isArray(a.calls) ? a.calls : [],
        baptized_children: Array.isArray(a.baptized_children) ? a.baptized_children : ["", "", "", ""],
        aaronic_ordinations: Array.isArray(a.aaronic_ordinations) ? a.aaronic_ordinations : [],
        aaronic_advancements: Array.isArray(a.aaronic_advancements) ? a.aaronic_advancements : [],
        achievements: Array.isArray(a.achievements) ? a.achievements : ["", "", "", ""],
        babies: Array.isArray(a.babies) ? a.babies : [],
        confirmations: Array.isArray(a.confirmations) ? a.confirmations : [],
        fellowships: Array.isArray(a.fellowships) ? a.fellowships : ["", "", "", "", "", "", "", ""],
      }))
    : [];

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
    AGENDAS,
    ACTIVITIES: Array.isArray(raw?.ACTIVITIES) ? raw.ACTIVITIES : [],
    "OTHER CHURCH PROGRAM": Array.isArray(raw?.["OTHER CHURCH PROGRAM"]) ? raw["OTHER CHURCH PROGRAM"] : [],
    "PUBLIC HOLIDAY": Array.isArray(raw?.["PUBLIC HOLIDAY"]) ? raw["PUBLIC HOLIDAY"] : [],
    CONTACTS: Array.isArray(raw?.CONTACTS) ? raw.CONTACTS : [],
    "REPORT LOG": Array.isArray(raw?.["REPORT LOG"]) ? raw["REPORT LOG"] : [],
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
    db.HYMNS.length === 0 &&
    db.AGENDAS.length === 0 &&
    db.ACTIVITIES.length === 0 &&
    db["OTHER CHURCH PROGRAM"].length === 0 &&
    db["PUBLIC HOLIDAY"].length === 0 &&
    db.CONTACTS.length === 0 &&
    db["REPORT LOG"].length === 0
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

type DBMetadata = {
  versions: Record<string, number>;
  last_updated: string;
};

const METADATA_KEY = "sac_meeting_planner_db_metadata_v2";
const LAST_SYNC_TIME_KEY = "sac_meeting_planner_last_sync_time_v2";
let metadataListenerUnsubscribe: (() => void) | null = null;

async function pushAllToBackend() {
  if (!backendEnabled() || suppressRemoteSync > 0) return;
  if (remoteSyncInFlight) return;
  remoteSyncInFlight = true;
  notifySyncListeners(true);
  try {
    const dbData = serializeDBForRemote(getDB());
    
    // Load local metadata
    const localMetadataRaw = localStorage.getItem(METADATA_KEY);
    const localMetadata: DBMetadata = localMetadataRaw 
      ? JSON.parse(localMetadataRaw) 
      : { versions: {}, last_updated: "" };

    const changedTables = new Set<string>();

    // We compute differences and write them directly to Firestore
    if (!lastSyncedDB) {
      console.log(`[Sync] Baseline missing. Pushing full database...`);
      for (const t of SYNC_TABLES) {
        if (t.name === "HYMNS") continue;
        const colName = COLLECTION_MAPPING[t.name];
        const rows = (dbData[t.name] || []) as any[];
        for (const r of rows) {
          const id = String(r[t.idCol] || "");
          if (!id) continue;
          
          if (t.name === "USERS" && r.signature_data_url?.startsWith("data:")) {
            try { r.signature_data_url = await uploadSignature(id, r.signature_data_url); } catch {}
          }
          await setDoc(doc(db, colName, id), r);
        }
        changedTables.add(t.name);
      }
      if (dbData.UNIT_SETTINGS) {
        await setDoc(doc(db, "unit_settings", "global"), dbData.UNIT_SETTINGS);
        changedTables.add("UNIT_SETTINGS");
      }
    } else {
      console.log(`[Sync] Calculating row differences for Firestore push...`);
      const updates: any[] = [];
      const deletes: any[] = [];
      
      for (const t of SYNC_TABLES) {
        if (t.name === "HYMNS") continue;
        const currentRows = (dbData[t.name] || []) as any[];
        const lastRows = (lastSyncedDB[t.name] || []) as any[];
        
        const currentMap = new Map(currentRows.map(r => [String(r[t.idCol] || ""), r]));
        const lastMap = new Map(lastRows.map(r => [String(r[t.idCol] || ""), r]));

        // Find updates
        for (const r of currentRows) {
          const id = String(r[t.idCol] || "");
          if (!id) continue;
          const old = lastMap.get(id);
          const nextComparable = getComparableRow(t.name, r);
          const oldComparable = old ? getComparableRow(t.name, old) : null;
          if (!oldComparable || JSON.stringify(oldComparable) !== JSON.stringify(nextComparable)) {
            updates.push({ table: t.name, row: nextComparable });
            changedTables.add(t.name);
          }
        }

        // Find deletes
        if (REMOTE_DELETABLE_TABLES.has(t.name)) {
          for (const r of lastRows) {
            const id = String(r[t.idCol] || "");
            if (!id) continue;
            if (!currentMap.has(id)) {
              deletes.push({ table: t.name, id });
              changedTables.add(t.name);
            }
          }
        }
      }

      // Sync writes in Firestore
      for (const update of updates) {
        const colName = COLLECTION_MAPPING[update.table as keyof DB];
        const idCol = SYNC_TABLES.find(t => t.name === update.table)?.idCol || "id";
        const docId = String(update.row[idCol]);
        
        if (update.table === "USERS" && update.row.signature_data_url?.startsWith("data:")) {
          try {
            update.row.signature_data_url = await uploadSignature(docId, update.row.signature_data_url);
          } catch (err) {
            console.warn("Signature upload failed during sync:", err);
          }
        }
        await setDoc(doc(db, colName, docId), update.row);
      }

      for (const del of deletes) {
        const colName = COLLECTION_MAPPING[del.table as keyof DB];
        await deleteDoc(doc(db, colName, del.id));
      }

      if (JSON.stringify(dbData.UNIT_SETTINGS) !== JSON.stringify(lastSyncedDB.UNIT_SETTINGS)) {
        await setDoc(doc(db, "unit_settings", "global"), dbData.UNIT_SETTINGS || {});
        changedTables.add("UNIT_SETTINGS");
      }
    }

    // Update metadata versions
    if (changedTables.size > 0) {
      const nextSyncTime = new Date().toISOString();
      const updatedVersions = { ...localMetadata.versions };
      changedTables.forEach(tableName => {
        updatedVersions[tableName] = (updatedVersions[tableName] || 0) + 1;
      });

      const nextMetadata: DBMetadata = {
        versions: updatedVersions,
        last_updated: nextSyncTime
      };

      await setDoc(doc(db, "metadata", "global"), nextMetadata);
      localStorage.setItem(METADATA_KEY, JSON.stringify(nextMetadata));
      localStorage.setItem(LAST_SYNC_TIME_KEY, nextSyncTime);
    }
    
    hasPendingPush = false;
    setLastSyncedDB(serializeDBForRemote(getDB()));
    console.log("[Sync] Firestore sync successful.");
  } catch (err) {
    console.warn("[Sync] Firestore push failed:", err);
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

function isLocalModified(tableName: keyof DB, id: string, localRow: any): boolean {
  if (!lastSyncedDB) return false;
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
        if (lDate && rDate && lDate !== rDate) {
          if (lDate > rDate) {
            mergedRows.push(l);
            needsPush = true;
          } else {
            mergedRows.push(r);
          }
        } else {
          if (isLocalModified(t.name, id, l)) {
            const isRemoteMod = isRemoteModified(t.name, id, r);
            if (isRemoteMod) {
              mergedRows.push({ ...r, ...l });
              needsPush = true;
            } else {
              mergedRows.push(l);
              needsPush = true;
            }
          } else {
            mergedRows.push(r);
          }
        }
      } else if (l) {
        mergedRows.push(l);
        needsPush = true;
      } else if (r) {
        mergedRows.push(r);
      }
    }

    (merged as any)[t.name] = mergedRows;
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

export function initializeFirebaseSync() {
  if (!backendEnabled()) return;
  
  if (metadataListenerUnsubscribe) return;
  console.log("[Sync] Subscribing to global metadata changes...");

  metadataListenerUnsubscribe = onSnapshot(doc(db, "metadata", "global"), (docSnap) => {
    if (remoteSyncInFlight || hasPendingPush) return;
    if (docSnap.exists()) {
      const remoteMeta = docSnap.data() as DBMetadata;
      const localMetadataRaw = localStorage.getItem(METADATA_KEY);
      const localMeta: DBMetadata = localMetadataRaw 
        ? JSON.parse(localMetadataRaw) 
        : { versions: {}, last_updated: "" };

      if (remoteMeta.last_updated && remoteMeta.last_updated > (localMeta.last_updated || "")) {
        console.log("[Sync] Metadata change detected. Triggering incremental pull...");
        void syncFromBackend({ force: false });
      }
    }
  });

  onSnapshot(doc(db, "unit_settings", "global"), (docSnap) => {
    if (remoteSyncInFlight || hasPendingPush) return;
    if (docSnap.exists()) {
      updateLocalSettingsFromFirebase(docSnap.data() as UnitSettings);
    }
  });
}

function updateLocalTableFromFirebase(tableName: keyof DB, remoteRows: any[]) {
  updateDB((local) => {
    const idCol = SYNC_TABLES.find((t) => t.name === tableName)?.idCol || "id";
    const localRows = (local[tableName] || []) as any[];
    const localMap = new Map(localRows.map(r => [String(r[idCol] || ""), r]));
    
    const mergedRows = remoteRows.map((remoteRow) => {
      const id = String(remoteRow[idCol] || "");
      const localRow = localMap.get(id);
      if (localRow && isLocalModified(tableName, id, localRow)) {
        return localRow;
      }
      return remoteRow;
    });
    
    // Maintain local rows that are not in remote yet (newly created and not pushed yet)
    const remoteIds = new Set(remoteRows.map(r => String(r[idCol] || "")));
    for (const localRow of localRows) {
      const id = String(localRow[idCol] || "");
      if (!remoteIds.has(id) && isLocalModified(tableName, id, localRow)) {
        mergedRows.push(localRow);
      }
    }
    
    return {
      ...local,
      [tableName]: mergedRows
    };
  }, true);
}

function updateLocalSettingsFromFirebase(settings: UnitSettings) {
  updateDB((local) => {
    return {
      ...local,
      UNIT_SETTINGS: settings
    };
  }, true);
}

export async function syncFromBackend(options?: { force?: boolean; replaceLocal?: boolean }): Promise<boolean> {
  if (!backendEnabled()) return false;
  const force = options?.force === true;
  const replaceLocal = options?.replaceLocal === true;

  if (!force && Date.now() - lastPullTime < 5 * 60 * 1000) {
    console.log("[Sync] Throttling background pull (last pull was less than 5m ago).");
    return true;
  }

  if (remotePullInFlight) return false;
  remotePullInFlight = true;
  notifySyncListeners(true);

  try {
    if (!force && hasPendingPush) {
      console.log("[Sync] Local changes pending. Attempting push before pull.");
      await pushAllToBackend();
      if (hasPendingPush) return false;
    }

    const local = getDB();
    const localLastSyncTime = localStorage.getItem(LAST_SYNC_TIME_KEY) || "";

    let remoteMetadata: DBMetadata | null = null;
    try {
      const metaSnap = await getDoc(doc(db, "metadata", "global"));
      if (metaSnap.exists()) {
        remoteMetadata = metaSnap.data() as DBMetadata;
      }
    } catch (e) {
      console.warn("[Sync] Failed to fetch remote metadata, falling back to full check:", e);
    }

    const localMetadataRaw = localStorage.getItem(METADATA_KEY);
    const localMetadata: DBMetadata = localMetadataRaw 
      ? JSON.parse(localMetadataRaw) 
      : { versions: {}, last_updated: "" };

    if (!force && remoteMetadata && localLastSyncTime && remoteMetadata.last_updated <= localLastSyncTime) {
      console.log("[Sync] No remote changes detected (up to date). Skipping pull.");
      lastPullTime = Date.now();
      initializeFirebaseSync();
      return true;
    }

    console.log("[Sync] Pulling updates from Firestore...");
    const remoteSnap: Partial<DB> = {};

    for (const t of SYNC_TABLES) {
      if (t.name === "HYMNS") {
        remoteSnap.HYMNS = local.HYMNS && local.HYMNS.length > 0 ? local.HYMNS : BUNDLED_HYMNS;
        continue;
      }

      const colName = COLLECTION_MAPPING[t.name];
      const remoteVer = remoteMetadata?.versions?.[t.name] || 0;
      const localVer = localMetadata.versions?.[t.name] || 0;

      if (!force && remoteVer > 0 && remoteVer === localVer && Array.isArray(local[t.name]) && local[t.name].length > 0) {
        remoteSnap[t.name] = local[t.name] as any;
        continue;
      }

      let docs: any[] = [];
      if (!force && localLastSyncTime && remoteVer > localVer) {
        console.log(`[Sync] Fetching incremental updates for ${t.name} since ${localLastSyncTime}...`);
        try {
          const qUpdate = query(collection(db, colName), where("updated_date", ">", localLastSyncTime));
          const snapUpdate = await getDocs(qUpdate);
          const updatedDocs = snapUpdate.docs.map(d => d.data());

          const idCol = t.idCol;
          const localRows = (local[t.name] || []) as any[];
          const localMap = new Map(localRows.map(r => [String(r[idCol] || ""), r]));
          
          for (const docData of updatedDocs) {
            localMap.set(String(docData[idCol] || ""), docData);
          }
          
          docs = Array.from(localMap.values());
        } catch (e) {
          console.warn(`[Sync] Incremental query failed for ${t.name}, falling back to full fetch:`, e);
          const snap = await getDocs(collection(db, colName));
          docs = snap.docs.map(docSnap => docSnap.data());
        }
      } else {
        const snap = await getDocs(collection(db, colName));
        docs = snap.docs.map(docSnap => docSnap.data());
      }

      (remoteSnap as any)[t.name] = docs;
    }

    const settingsSnap = await getDoc(doc(db, "unit_settings", "global"));
    remoteSnap.UNIT_SETTINGS = settingsSnap.exists() ? (settingsSnap.data() as UnitSettings) : null;

    const normalizedRemote = normalizeDB(remoteSnap);
    const comparableRemote = serializeDBForRemote(normalizedRemote);
    
    setLastSyncedDB(comparableRemote);

    const { merged, needsPush } = replaceLocal
      ? { merged: normalizedRemote, needsPush: false }
      : mergeDatabases(local, normalizedRemote);

    suppressRemoteSync += 1;
    try {
      setDBInternal(merged, true);
      setLastSyncedDB(comparableRemote);
      lastPullTime = Date.now();
      
      const nextSyncTime = new Date().toISOString();
      localStorage.setItem(LAST_SYNC_TIME_KEY, nextSyncTime);
      if (remoteMetadata) {
        localStorage.setItem(METADATA_KEY, JSON.stringify(remoteMetadata));
      } else {
        const initialMetadata: DBMetadata = {
          versions: SYNC_TABLES.reduce((acc, t) => ({ ...acc, [t.name]: 1 }), {}),
          last_updated: nextSyncTime
        };
        localStorage.setItem(METADATA_KEY, JSON.stringify(initialMetadata));
      }

      console.log("[Sync] Local DB successfully hydrated from Firestore.");
    } finally {
      suppressRemoteSync -= 1;
    }

    initializeFirebaseSync();

    if (!replaceLocal && needsPush) {
      scheduleRemoteSync();
    }

    return true;
  } catch (err) {
    console.warn("[Sync] Hydration failed:", err);
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
    HYMNS: BUNDLED_HYMNS,
    AGENDAS: [],
    ACTIVITIES: [],
    "OTHER CHURCH PROGRAM": [],
    "PUBLIC HOLIDAY": [],
    CONTACTS: [],
    "REPORT LOG": [],
  };
  localStorage.setItem(APP_KEY, JSON.stringify(fresh));
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
