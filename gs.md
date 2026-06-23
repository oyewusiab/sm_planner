/**
 * Sacrament Meeting Planner - Google Apps Script Backend
 * Handles sheet management, synchronization, auto-archiving, and retrieval.
 *
 * Scheduled task: Auto-archive completed planners after 30 days.
 * Should be set to run daily via Apps Script time-based trigger.
 */
function scheduledAutoArchivePlanners() {
  const planners = getAllRows_("PLANNERS");
  const now = new Date();
  let count = 0;
  planners.forEach(planner => {
    if (planner.state === "SUBMITTED") {
      const year = parseInt(planner.year, 10);
      const month = parseInt(planner.month, 10);
      if (!isNaN(year) && !isNaN(month)) {
        // Automatically archive 1 month after the planner's month ends
        // e.g. for March (month=3), threshold is May 1st
        const archiveThreshold = new Date(year, month + 1, 1);
        if (now >= archiveThreshold) {
          planner.state = "ARCHIVED";
          planner.archive_method = "auto";
          planner.archive_date = now.toISOString();
          upsertRow_("PLANNERS", planner, "planner_id");
          count++;
        }
      }
    }
  });
  return `Auto-archived ${count} planners.`;
}

/**
 * Scheduled task: Permanently delete archived planners after retention period.
 * - Manually archived: delete after 30 days
 * - Auto-archived: delete after 365 days
 * Should be set to run daily via Apps Script time-based trigger.
 */
function scheduledDeleteArchivedPlanners() {
  const planners = getAllRows_("PLANNERS");
  const now = new Date();
  let deleted = 0;
  planners.forEach(planner => {
    if (planner.state === "ARCHIVED") {
      const method = planner.archive_method || "manual";
      const dateStr = planner.archive_date || planner.updated_date || planner.created_date;
      if (!dateStr) return;
      const archiveDate = new Date(dateStr);
      let days = (now - archiveDate) / (1000 * 60 * 60 * 24);
      if ((method === "manual" && days >= 30) || (method === "auto" && days >= 365)) {
        deleteRowById_("PLANNERS", "planner_id", planner.planner_id);
        deleted++;
      }
    }
  });
  return `Deleted ${deleted} archived planners.`;
}

/**
 * Scheduled task: Auto-archive completed agendas after 30 days.
 * Should be set to run daily via Apps Script time-based trigger.
 */
function scheduledAutoArchiveAgendas() {
  const agendas = getAllRows_("AGENDAS");
  const now = new Date();
  let count = 0;
  agendas.forEach(agenda => {
    if (agenda.state === "SUBMITTED") {
      // Auto-archive 30 days after the agenda's date
      if (agenda.date) {
        const agendaDate = new Date(agenda.date);
        const archiveThreshold = new Date(agendaDate);
        archiveThreshold.setDate(archiveThreshold.getDate() + 30);
        if (now >= archiveThreshold) {
          agenda.state = "ARCHIVED";
          agenda.archive_method = "auto";
          agenda.archive_date = now.toISOString();
          upsertRow_("AGENDAS", agenda, "agenda_id");
          count++;
        }
      }
    }
  });
  return `Auto-archived ${count} agendas.`;
}

/**
 * Scheduled task: Permanently delete archived agendas after retention period.
 * - Manually archived: delete after 30 days
 * - Auto-archived: delete after 365 days
 * Should be set to run daily via Apps Script time-based trigger.
 */
function scheduledDeleteArchivedAgendas() {
  const agendas = getAllRows_("AGENDAS");
  const now = new Date();
  let deleted = 0;
  agendas.forEach(agenda => {
    if (agenda.state === "ARCHIVED") {
      const method = agenda.archive_method || "manual";
      const dateStr = agenda.archive_date || agenda.updated_date || agenda.created_date;
      if (!dateStr) return;
      const archiveDate = new Date(dateStr);
      let days = (now - archiveDate) / (1000 * 60 * 60 * 24);
      if ((method === "manual" && days >= 30) || (method === "auto" && days >= 365)) {
        deleteRowById_("AGENDAS", "agenda_id", agenda.agenda_id);
        deleted++;
      }
    }
  });
  return `Deleted ${deleted} archived agendas.`;
}
/**
 * Sacrament Planner - Google Sheets backend
 * Web App API for CRUD + full DB export/import
 *
 * Configure SPREADSHEET_ID and API_KEY before deploying.
 */
const CONFIG = {
  SPREADSHEET_ID: "1RGG0HbR2eYx0zENFftSuZpZhGyd0nwu2IE2ihzlL57g",
  API_KEY: "ThisIsMySecretKey123!@", // required in ?key= or JSON body {key: "..."}
};

function getSpreadsheet_(id) {
  const ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return null;
  ss.getSheetByName = function(name) {
    const sheets = this.getSheets();
    const lowerName = name.toLowerCase();
    for (let i = 0; i < sheets.length; i++) {
      if (sheets[i].getName().toLowerCase() === lowerName) {
        return sheets[i];
      }
    }
    return null;
  };
  return ss;
}

// Sheet schemas (header row 1)
const SCHEMA = {
  PLANNERS: [
    "planner_id",
    "month",
    "year",
    "state",
    "conducting_officer",
    "weeks",
    "unit_name",
    "created_by",
    "created_date",
    "updated_date",
    "music_status",
    "archive_method",
    "archive_date",
  ],
  USERS: [
    "user_id",
    "name",
    "preferred_name",
    "username",
    "email",
    "password_hash",
    "role",
    "organisation",
    "calling",
    "phone",
    "whatsapp",
    "gender",
    "address",
    "lga",
    "state",
    "country",
    "emergency_contact_name",
    "emergency_contact_phone",
    "signature_data_url",
    "notes",
    "created_date",
    "last_login_date",
    "must_reset_password",
    "disabled",
  ],
  MEMBERS: [
    "name",
    "gender",
    "age",
    "phone",
    "email",
    "organisation",
    "status",
    "notes",
    "total_assignments",
    "spoken_count",
    "prayers_count",
    "last_assigned_date",
    "readiness_score",
  ],
  ASSIGNMENTS: [
    "assignment_id",
    "planner_id",
    "week_id",
    "date",
    "person",
    "role",
    "topic",
    "minutes",
    "venue",
    "meeting_time",
    "created_date",
  ],
  CHECKLISTS: [
    "checklist_id",
    "planner_id",
    "week_id",
    "week_label",
    "task",
    "responsible",
    "status",
    "updated_by",
    "updated_date",
  ],
  NOTIFICATIONS: [
    "notification_id",
    "to_user_id",
    "type",
    "title",
    "body",
    "meta",
    "read",
    "created_date",
  ],
  TODOS: [
    "todo_id",
    "title",
    "details",
    "due_date",
    "priority",
    "status",
    "assigned_to_user_id",
    "created_by_user_id",
    "planner_id",
    "week_id",
    "created_date",
    "updated_date",
    "completed_date",
  ],
  SETTINGS_REQUESTS: [
    "request_id",
    "requested_by",
    "status",
    "patch",
    "reason",
    "decided_by",
    "decided_date",
    "created_date",
  ],
  REMINDERS: [
    "reminder_id",
    "planner_id",
    "week_id",
    "assignment_id",
    "to_person",
    "to_user_id",
    "channel",
    "title",
    "body",
    "scheduled_for_date",
    "status",
    "created_by_user_id",
    "created_date",
    "sent_date",
  ],
  UNIT_SETTINGS: ["Key", "Value"],
  HYMNS: ["number", "title", "type", "theme", "updated_date"],
  AGENDAS: [
    "agenda_id",
    "planner_id",
    "week_id",
    "created_by",
    "created_date",
    "updated_date",
    "state",
    "ward_branch",
    "stake_district",
    "date",
    "type_of_meeting",
    "other_meeting_specify",
    "presiding",
    "conducting",
    "music_director",
    "choir_director",
    "organist",
    "start_time",
    "prelude_music",
    "greetings_welcome",
    "acknowledgements",
    "ward_branch_business",
    "stake_district_business",
    "naming_blessing",
    "confirmation_bestowal",
    "opening_hymn",
    "opening_hymn_number",
    "opening_prayer",
    "sacrament_hymn",
    "sacrament_hymn_number",
    "special_music",
    "speakers",
    "closing_hymn",
    "closing_hymn_number",
    "closing_prayer",
    "postlude_music",
    "announcements",
    "releases",
    "calls",
    "baptized_children",
    "aaronic_ordinations",
    "aaronic_advancements",
    "achievements",
    "babies",
    "confirmations",
    "fellowships",
    "archive_method",
    "archive_date"
  ],
  "ACTIVITIES": ["activity_id", "date", "activity", "organisation", "status", "email_sent", "those_involved", "report_submitted", "time", "last_reminder"],
  "OTHER CHURCH PROGRAM": ["program_id", "date", "program", "organisation"],
  "PUBLIC HOLIDAY": ["holiday_id", "date", "holiday", "theme"],
  "CONTACTS": ["contact_id", "name", "calling", "organisation", "upcoming", "report", "email"],
  "REPORT LOG": ["log_id", "date", "type", "recipient", "status", "timestamp"]
};

const PRIMARY_KEYS = {
  PLANNERS: "planner_id",
  USERS: "user_id",
  MEMBERS: "name",
  ASSIGNMENTS: "assignment_id",
  CHECKLISTS: "checklist_id",
  NOTIFICATIONS: "notification_id",
  TODOS: "todo_id",
  SETTINGS_REQUESTS: "request_id",
  REMINDERS: "reminder_id",
  UNIT_SETTINGS: "Key",
  HYMNS: "number",
  AGENDAS: "agenda_id",
  "ACTIVITIES": "activity_id",
  "OTHER CHURCH PROGRAM": "program_id",
  "PUBLIC HOLIDAY": "holiday_id",
  "CONTACTS": "contact_id",
  "REPORT LOG": "log_id"
};

// Columns that store JSON strings
const JSON_FIELDS = {
  PLANNERS: ["weeks"],
  NOTIFICATIONS: ["meta"],
  SETTINGS_REQUESTS: ["patch"],
  AGENDAS: [
    "announcements",
    "releases",
    "calls",
    "baptized_children",
    "aaronic_ordinations",
    "aaronic_advancements",
    "achievements",
    "babies",
    "confirmations",
    "fellowships",
    "speakers"
  ],
};

const NUMBER_FIELDS = {
  PLANNERS: ["month", "year"],
  MEMBERS: ["age"],
  ASSIGNMENTS: ["minutes"],
};

const BOOLEAN_FIELDS = {
  CHECKLISTS: ["status"],
  NOTIFICATIONS: ["read"],
  USERS: ["must_reset_password", "disabled"],
};

const UNIT_JSON_KEYS = ["prefs", "venues"];

function doGet(e) {
  try {
    return withLock(() => route_(e, "GET"));
  } catch (err) {
    return jsonError_(String(err), 500);
  }
}

function doPost(e) {
  try {
    return withLock(() => route_(e, "POST"));
  } catch (err) {
    return jsonError_(String(err), 500);
  }
}

function doOptions(e) {
  try {
    return jsonResponse_({ ok: true, ts: new Date().toISOString() });
  } catch (err) {
    return jsonError_(String(err), 500);
  }
}

function withCORS(fn) {
  try {
    return fn();
  } catch (err) {
    return jsonError_(String(err), 500);
  }
}

function setup() {
  ensureSchema_();
  return "OK";
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("SM Planner")
    .addItem("Initialize / Repair Sheets", "setup")
    .addItem("Hash User Passwords", "hashUserPasswords")
    .addItem("Run Checklist Reminders", "scheduledChecklistReminders")
    .addSeparator()
    .addItem("Refresh Calendar & Dashboard", "refreshCalendar")
    .addItem("Setup Calendar Triggers", "createFridayTrigger")
    .addToUi();
}

function route_(e, method) {
  const payload = parsePayload_(e);
  // Merges URL query parameters into payload if they exist, so that GET requests can access them seamlessly
  if (e && e.parameter) {
    for (const key in e.parameter) {
      if (!(key in payload)) {
        payload[key] = e.parameter[key];
      }
    }
  }

  const key = payload.key || "";
  if (!authorize_(key)) {
    return jsonError_("unauthorized", 401);
  }

  const action = (payload.action || "").toString();
  if (!action) return jsonError_("missing_action", 400);

  try {
    switch (action) {
      case "ping":
        return jsonResponse_({ ok: true, data: { message: "pong", db_version: getDbVersion_() }, ts: new Date().toISOString() });
      case "init":
        ensureSchema_();
        return jsonResponse_({ ok: true, data: { message: "schema_ready" }, ts: new Date().toISOString() });
      case "schema":
        ensureSchema_();
        return jsonResponse_({ ok: true, data: SCHEMA, ts: new Date().toISOString() });
      case "list":
        return handleList_(payload);
      case "get":
        return handleGet_(payload);
      case "upsert":
        return handleUpsert_(payload);
      case "bulkUpsert":
        return handleBulkUpsert_(payload);
      case "delete":
        return handleDelete_(payload);
      case "export":
        return handleExport_();
      case "import":
        return handleImport_(payload);
      case "syncHymns":
        return jsonResponse_({ ok: true, data: syncLdsHymns(), ts: new Date().toISOString() });
      case "sync_v2":
        return handleSyncV2_(payload);
      case "listSheets":
        return jsonResponse_({ ok: true, data: SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID).getSheets().map(s => s.getName()), ts: new Date().toISOString() });
      default:
        return jsonError_("unknown_action", 400);
    }
  } catch (err) {
    return jsonError_(String(err), 500);
  }
}

function handleList_(payload) {
  ensureSchema_();
  const table = normalizeTable_(payload.table);
  if (!table) return jsonError_("unknown_table", 400);
  if (table === "UNIT_SETTINGS") {
    return jsonResponse_({ ok: true, data: getUnitSettings_(), ts: new Date().toISOString() });
  }
  const rows = getAllRows_(table);
  return jsonResponse_({ ok: true, data: rows, ts: new Date().toISOString() });
}

function handleGet_(payload) {
  ensureSchema_();
  const table = normalizeTable_(payload.table);
  if (!table) return jsonError_("unknown_table", 400);
  const idCol = PRIMARY_KEYS[table];
  const idVal = (payload.id || payload.value || "").toString();
  if (!idVal) return jsonError_("missing_id", 400);
  const row = findRowById_(table, idCol, idVal);
  if (!row) return jsonError_("not_found", 404);
  return jsonResponse_({ ok: true, data: row, ts: new Date().toISOString() });
}

function handleUpsert_(payload) {
  ensureSchema_();
  const table = normalizeTable_(payload.table);
  if (!table) return jsonError_("unknown_table", 400);
  const row = payload.row;
  if (!row || typeof row !== "object") return jsonError_("missing_row", 400);

  incrementDbVersion_();

  if (table === "UNIT_SETTINGS") {
    upsertUnitSettings_(row);
    return jsonResponse_({ ok: true, data: { updated: true }, ts: new Date().toISOString() });
  }
  const idCol = PRIMARY_KEYS[table];
  const idVal = String(row[idCol] || "");
  if (!idVal) return jsonError_("missing_primary_key", 400);
  const updated = upsertRow_(table, row, idCol);
  if (table === "PLANNERS" || table === "ASSIGNMENTS" || table === "MEMBERS") {
    recalculateMemberAnalytics_();
  }
  if (["ACTIVITIES", "OTHER CHURCH PROGRAM", "PUBLIC HOLIDAY", "CONTACTS"].indexOf(table) >= 0) {
    try { refreshCalendar(); } catch (e) { console.warn("refreshCalendar failed:", e); }
  }
  return jsonResponse_({ ok: true, data: updated, ts: new Date().toISOString() });
}

function handleBulkUpsert_(payload) {
  ensureSchema_();
  const table = normalizeTable_(payload.table);
  if (!table) return jsonError_("unknown_table", 400);
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  if (rows.length === 0) return jsonError_("missing_rows", 400);

  incrementDbVersion_();

  if (table === "UNIT_SETTINGS") {
    // Accept object or array of {Key,Value}
    if (typeof rows === "object" && !Array.isArray(rows)) {
      upsertUnitSettings_(rows);
    } else {
      const obj = {};
      for (const r of rows) obj[String(r.Key || "")] = r.Value;
      upsertUnitSettings_(obj);
    }
    return jsonResponse_({ ok: true, data: { updated: true, count: rows.length }, ts: new Date().toISOString() });
  }
  const idCol = PRIMARY_KEYS[table];
  const valid = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || typeof row !== "object") continue;
    if (!row[idCol]) continue;
    valid.push(row);
  }
  const mergedCount = mergeTable_(table, valid);
  if (table === "PLANNERS" || table === "ASSIGNMENTS" || table === "MEMBERS") {
    recalculateMemberAnalytics_();
  }
  if (["ACTIVITIES", "OTHER CHURCH PROGRAM", "PUBLIC HOLIDAY", "CONTACTS"].indexOf(table) >= 0) {
    try { refreshCalendar(); } catch (e) { console.warn("refreshCalendar failed:", e); }
  }
  return jsonResponse_({ ok: true, data: { updated: mergedCount }, ts: new Date().toISOString() });
}

function handleDelete_(payload) {
  ensureSchema_();
  const table = normalizeTable_(payload.table);
  if (!table) return jsonError_("unknown_table", 400);
  const idCol = PRIMARY_KEYS[table];
  const idVal = (payload.id || payload.value || "").toString();
  if (!idVal) return jsonError_("missing_id", 400);

  incrementDbVersion_();

  if (table === "UNIT_SETTINGS") {
    deleteUnitSetting_(idVal);
    return jsonResponse_({ ok: true, data: { deleted: true }, ts: new Date().toISOString() });
  }
  const deleted = deleteRowById_(table, idCol, idVal);
  if (!deleted) return jsonError_("not_found", 404);
  if (table === "PLANNERS" || table === "ASSIGNMENTS" || table === "MEMBERS") {
    recalculateMemberAnalytics_();
  }
  if (["ACTIVITIES", "OTHER CHURCH PROGRAM", "PUBLIC HOLIDAY", "CONTACTS"].indexOf(table) >= 0) {
    try { refreshCalendar(); } catch (e) { console.warn("refreshCalendar failed:", e); }
  }
  return jsonResponse_({ ok: true, data: { deleted: true }, ts: new Date().toISOString() });
}

function handleExport_() {
  ensureSchema_();
  const db = {
    UNIT_SETTINGS: getUnitSettings_(),
    USERS: getAllRows_("USERS"),
    PLANNERS: getAllRows_("PLANNERS"),
    ASSIGNMENTS: getAllRows_("ASSIGNMENTS"),
    MEMBERS: getAllRows_("MEMBERS"),
    CHECKLISTS: getAllRows_("CHECKLISTS"),
    NOTIFICATIONS: getAllRows_("NOTIFICATIONS"),
    SETTINGS_REQUESTS: getAllRows_("SETTINGS_REQUESTS"),
    TODOS: getAllRows_("TODOS"),
    REMINDERS: getAllRows_("REMINDERS"),
    HYMNS: getAllRows_("HYMNS"),
    AGENDAS: getAllRows_("AGENDAS"),
    ACTIVITIES: getAllRows_("ACTIVITIES"),
    "OTHER CHURCH PROGRAM": getAllRows_("OTHER CHURCH PROGRAM"),
    "PUBLIC HOLIDAY": getAllRows_("PUBLIC HOLIDAY"),
    CONTACTS: getAllRows_("CONTACTS"),
    "REPORT LOG": getAllRows_("REPORT LOG"),
  };
  return jsonResponse_({ ok: true, data: db, db_version: getDbVersion_(), ts: new Date().toISOString() });
}

function handleImport_(payload) {
  ensureSchema_();
  const db = payload.db;
  const mode = (payload.mode || "replace").toString(); // replace | merge
  if (!db || typeof db !== "object") return jsonError_("missing_db", 400);

  incrementDbVersion_();

  const tables = [
    "USERS",
    "PLANNERS",
    "ASSIGNMENTS",
    "MEMBERS",
    "CHECKLISTS",
    "NOTIFICATIONS",
    "SETTINGS_REQUESTS",
    "TODOS",
    "REMINDERS",
    "AGENDAS",
    "ACTIVITIES",
    "OTHER CHURCH PROGRAM",
    "PUBLIC HOLIDAY",
    "CONTACTS",
    "REPORT LOG",
  ];

  if (mode === "replace") {
    for (const t of tables) overwriteTable_(t, Array.isArray(db[t]) ? db[t] : []);
  } else {
    for (const t of tables) {
      const rows = Array.isArray(db[t]) ? db[t] : [];
      mergeTable_(t, rows);
    }
  }

  if (db.UNIT_SETTINGS) {
    if (typeof db.UNIT_SETTINGS === "object") upsertUnitSettings_(db.UNIT_SETTINGS);
  }

  recalculateMemberAnalytics_();

  return jsonResponse_({ ok: true, data: { imported: true, mode: mode }, db_version: getDbVersion_(), ts: new Date().toISOString() });
}

/**
 * Handle V2 Batch Synchronization
 * Processes multiple updates and deletes across different tables in a single request.
 */
function handleSyncV2_(payload) {
  ensureSchema_();
  const changes = payload.changes;
  if (!changes || typeof changes !== "object") return jsonError_("missing_changes", 400);

  const updates = Array.isArray(changes.updates) ? changes.updates : [];
  const deletes = Array.isArray(changes.deletes) ? changes.deletes : [];

  const results = {
    updated: 0,
    deleted: 0,
    tables: []
  };

  // Group updates by table
  const updateMap = {};
  for (const item of updates) {
    if (!item.table || !item.row) continue;
    const t = normalizeTable_(item.table);
    if (!t) continue;
    if (!updateMap[t]) updateMap[t] = [];
    updateMap[t].push(item.row);
  }

  // Group deletes by table
  const deleteMap = {};
  for (const item of deletes) {
    if (!item.table || !item.id) continue;
    const t = normalizeTable_(item.table);
    if (!t) continue;
    if (!deleteMap[t]) deleteMap[t] = [];
    deleteMap[t].push(String(item.id));
  }

  // Process Deletes Table by Table
  for (const table in deleteMap) {
    const ids = deleteMap[table];
    const idCol = PRIMARY_KEYS[table];
    let count = 0;
    for (const idVal of ids) {
      if (deleteRowById_(table, idCol, idVal)) {
        count++;
      }
    }
    results.deleted += count;
    if (count > 0) results.tables.push(`${table}:del:${count}`);
  }

  // Process Updates Table by Table using the optimized mergeTable_
  for (const table in updateMap) {
    const rows = updateMap[table];
    if (table === "UNIT_SETTINGS") {
      const obj = {};
      for (const r of rows) {
        if (typeof r === "object") Object.assign(obj, r);
      }
      upsertUnitSettings_(obj);
      results.updated += rows.length;
      results.tables.push(`${table}:upd:${rows.length}`);
    } else {
      const count = mergeTable_(table, rows);
      results.updated += count;
      results.tables.push(`${table}:upd:${count}`);
    }
  }

  // Recalculate member analytics if any changes to PLANNERS, ASSIGNMENTS, or MEMBERS
  let hasMod = false;
  let hasCalendarMod = false;
  for (const item of updates) {
    if (item.table === "PLANNERS" || item.table === "ASSIGNMENTS" || item.table === "MEMBERS") hasMod = true;
    if (["ACTIVITIES", "OTHER CHURCH PROGRAM", "PUBLIC HOLIDAY", "CONTACTS"].indexOf(item.table) >= 0) hasCalendarMod = true;
  }
  for (const item of deletes) {
    if (item.table === "PLANNERS" || item.table === "ASSIGNMENTS" || item.table === "MEMBERS") hasMod = true;
    if (["ACTIVITIES", "OTHER CHURCH PROGRAM", "PUBLIC HOLIDAY", "CONTACTS"].indexOf(item.table) >= 0) hasCalendarMod = true;
  }
  if (hasMod) {
    recalculateMemberAnalytics_();
  }
  if (hasCalendarMod) {
    try { refreshCalendar(); } catch (e) { console.warn("refreshCalendar failed:", e); }
  }

  incrementDbVersion_();

  return jsonResponse_({ ok: true, data: results, db_version: getDbVersion_(), ts: new Date().toISOString() });
}

function normalizeHeader_(h) {
  return String(h || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function ensureSchemaResilient_(rawHeader, schemaHeader) {
  return normalizeHeader_(rawHeader) === normalizeHeader_(schemaHeader);
}

function ensureSchema_() {
  const ss = getSpreadsheet_(CONFIG.SPREADSHEET_ID);
  Object.keys(SCHEMA).forEach((name) => {
    if (name === "REPORT LOG") {
      let sh = ss.getSheetByName(name);
      if (!sh) sh = ss.insertSheet(name);
      return; // Bypass schema check for report log because of custom horizontal layout
    }
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);

    // Special transition: if sheet is MEMBERS and has member_id column, delete it to avoid column shifting
    if (name === "MEMBERS") {
      const currentHeaders = sh.getDataRange().getValues()[0] || [];
      const cleanHeaders = currentHeaders.map(h => normalizeHeader_(h));
      const colIdx = cleanHeaders.indexOf(normalizeHeader_("member_id"));
      if (colIdx >= 0) {
        console.log("[Migration] Deleting member_id column from MEMBERS sheet.");
        sh.deleteColumn(colIdx + 1); // 1-based index
      }
    }

    const headers = SCHEMA[name];
    const firstRow = sh.getRange(1, 1, 1, headers.length).getValues()[0];
    let needsWrite = false;
    for (let i = 0; i < headers.length; i++) {
      const raw = String(firstRow[i] || "");
      const schema = headers[i];
      if (!ensureSchemaResilient_(raw, schema)) {
        needsWrite = true;
        break;
      }
    }
    if (needsWrite) {
      const allData = sh.getDataRange().getValues();
      if (allData.length > 1) {
        const oldHeaders = allData[0];
        const rows = [];
        for (let r = 1; r < allData.length; r++) {
          rows.push(rowToObj_(name, oldHeaders, allData[r]));
        }
        sh.clearContents();
        sh.getRange(1, 1, 1, headers.length).setValues([headers]);
        const out = rows.map(rowObj => objToRow_(name, headers, rowObj));
        sh.getRange(2, 1, out.length, headers.length).setValues(out);
      } else {
        sh.clearContents();
        sh.getRange(1, 1, 1, headers.length).setValues([headers]);
      }
    }
    if (sh.getFrozenRows() < 1) sh.setFrozenRows(1);
  });
}

function getAllRows_(table) {
  const sh = getSheet_(table);
  const data = sh.getDataRange().getValues();
  if (data.length <= 1) return [];
  
  if (table === "REPORT LOG") {
    return parseReportLogs_(data);
  }
  
  const headers = data[0];

  // Find the primary key column index in raw headers
  const idCol = PRIMARY_KEYS[table];
  const idx = headers.map(h => normalizeHeader_(h)).indexOf(normalizeHeader_(idCol));

  const out = [];
  let needsWriteback = false;

  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    if (row.every((v) => String(v || "").trim() === "")) continue;

    // Auto-generate missing primary keys (e.g. for manually pasted rows)
    if (idx >= 0 && String(row[idx] || "").trim() === "") {
      if (table === "MEMBERS") {
        continue; // Skip blank member rows to prevent generating fake members
      }
      const prefix = table.slice(0, 3).toLowerCase();
      const randomId = prefix + "_" + Math.random().toString(36).substring(2, 11) + "_" + Date.now().toString(36);
      row[idx] = randomId;
      needsWriteback = true;
    }

    out.push(rowToObj_(table, headers, row));
  }

  if (needsWriteback) {
    // Write back all auto-generated IDs in a single extremely fast operation
    sh.getRange(1, 1, data.length, headers.length).setValues(data);
  }

  return out;
}

function findRowById_(table, idCol, idVal) {
  const sh = getSheet_(table);
  const data = sh.getDataRange().getValues();
  if (data.length <= 1) return null;
  const rawHeaders = data[0];
  const headers = rawHeaders.map(h => normalizeHeader_(h));
  const idx = headers.indexOf(normalizeHeader_(idCol));
  if (idx === -1) return null;
  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    if (String(row[idx]) === idVal) {
      return rowToObj_(table, rawHeaders, row);
    }
  }
  return null;
}

function upsertRow_(table, obj, idCol) {
  const sh = getSheet_(table);
  const data = sh.getDataRange().getValues();
  const rawHeaders = data.length ? data[0] : SCHEMA[table];
  const headers = rawHeaders.map(h => normalizeHeader_(h));
  const idIdx = headers.indexOf(normalizeHeader_(idCol));
  const idVal = String(obj[idCol]);

  let rowIndex = -1;
  if (data.length > 1) {
    for (let r = 1; r < data.length; r++) {
      if (String(data[r][idIdx]) === idVal) {
        rowIndex = r + 1; // 1-based
        break;
      }
    }
  }

  const row = objToRow_(table, rawHeaders, obj);
  if (rowIndex === -1) {
    sh.appendRow(row);
    // Trigger email notification for new notifications
    if (table === "NOTIFICATIONS") {
      try { sendEmail_(obj); } catch (e) { console.warn("Email failed:", e); }
    }
  } else {
    sh.getRange(rowIndex, 1, 1, rawHeaders.length).setValues([row]);
  }

  return obj;
}

function deleteRowById_(table, idCol, idVal) {
  const sh = getSheet_(table);
  const data = sh.getDataRange().getValues();
  if (data.length <= 1) return false;
  const rawHeaders = data[0];
  const headers = rawHeaders.map(h => normalizeHeader_(h));
  const idx = headers.indexOf(normalizeHeader_(idCol));
  if (idx === -1) return false;
  for (let r = 1; r < data.length; r++) {
    if (String(data[r][idx]) === idVal) {
      sh.deleteRow(r + 1);
      return true;
    }
  }
  return false;
}

function overwriteTable_(table, rows) {
  if (table === "REPORT LOG") return; // Read-only from sync perspective
  const sh = getSheet_(table);
  const headers = SCHEMA[table];
  sh.clearContents();
  sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (!rows || rows.length === 0) return;
  const out = rows.map((r) => objToRow_(table, headers, r));
  sh.getRange(2, 1, out.length, headers.length).setValues(out);
}

/**
 * Fast merge: read table once, merge in memory by primary key, write once.
 * Returns number of incoming rows that were valid for merge.
 */
function mergeTable_(table, rows) {
  if (table === "REPORT LOG") return 0; // Read-only from sync perspective
  const sh = getSheet_(table);
  const rawHeaders = SCHEMA[table];
  const idCol = PRIMARY_KEYS[table];
  const idIdx = rawHeaders.indexOf(idCol);
  if (idIdx < 0) throw new Error("missing_primary_key_column_" + table);

  const existingData = sh.getDataRange().getValues();
  const existingMap = {};
  const orderedIds = [];

  const sheetHeaders = existingData.length ? existingData[0] : rawHeaders;
  const normalizedSheetHeaders = sheetHeaders.map(h => normalizeHeader_(h));
  const sheetIdIdx = normalizedSheetHeaders.indexOf(normalizeHeader_(idCol));

  for (let r = 1; r < existingData.length; r++) {
    const row = existingData[r];
    const idVal = sheetIdIdx >= 0 ? String(row[sheetIdIdx] || "").trim() : "";
    if (!idVal) continue;
    const obj = rowToObj_(table, sheetHeaders, row);
    existingMap[idVal] = obj;
    orderedIds.push(idVal);
  }

  let validCount = 0;
  for (let i = 0; i < rows.length; i++) {
    const incoming = rows[i];
    if (!incoming || typeof incoming !== "object") continue;
    const idVal = String(incoming[idCol] || "").trim();
    if (!idVal) continue;
    validCount++;
    if (!existingMap[idVal]) orderedIds.push(idVal);
    existingMap[idVal] = Object.assign({}, existingMap[idVal] || {}, incoming);
  }

  sh.clearContents();
  sh.getRange(1, 1, 1, rawHeaders.length).setValues([rawHeaders]);
  if (orderedIds.length === 0) return validCount;

  const out = orderedIds.map((id) => objToRow_(table, rawHeaders, existingMap[id]));
  sh.getRange(2, 1, out.length, rawHeaders.length).setValues(out);
  return validCount;
}

function getUnitSettings_() {
  const sh = getSheet_("UNIT_SETTINGS");
  const data = sh.getDataRange().getValues();
  const out = {};
  for (let r = 1; r < data.length; r++) {
    const key = String(data[r][0] || "").trim();
    const raw = data[r][1];
    if (!key) continue;
    out[key] = parseUnitSettingValue_(key, raw);
  }
  return out;
}

function upsertUnitSettings_(obj) {
  const sh = getSheet_("UNIT_SETTINGS");
  const headers = SCHEMA.UNIT_SETTINGS;
  const existing = getUnitSettings_();
  const merged = Object.assign({}, existing, obj || {});
  sh.clearContents();
  sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  const rows = Object.keys(merged).map((k) => [k, formatUnitSettingValue_(k, merged[k])]);
  if (rows.length) sh.getRange(2, 1, rows.length, 2).setValues(rows);
}

function deleteUnitSetting_(key) {
  const sh = getSheet_("UNIT_SETTINGS");
  const data = sh.getDataRange().getValues();
  for (let r = 1; r < data.length; r++) {
    if (String(data[r][0]) === key) {
      sh.deleteRow(r + 1);
      break;
    }
  }
}

function rowToObj_(table, headers, row) {
  const obj = {};
  const schemaHeaders = SCHEMA[table] || [];
  for (let c = 0; c < headers.length; c++) {
    const rawKey = String(headers[c] || "").trim();
    const normRawKey = normalizeHeader_(rawKey);
    // Find matching key in SCHEMA using normalizeHeader_
    const key = schemaHeaders.find(h => normalizeHeader_(h) === normRawKey) || rawKey;

    let val = row[c];
    if (JSON_FIELDS[table] && JSON_FIELDS[table].indexOf(key) >= 0) {
      if (typeof val === "string" && val.trim()) {
        try {
          val = JSON.parse(val);
        } catch (err) {
          // keep as string if invalid JSON
        }
      }
    }
    if (NUMBER_FIELDS[table] && NUMBER_FIELDS[table].indexOf(key) >= 0) {
      val = parseNumber_(val);
    }
    if (BOOLEAN_FIELDS[table] && BOOLEAN_FIELDS[table].indexOf(key) >= 0) {
      val = parseBoolean_(val);
    }
    obj[key] = val;
  }
  return obj;
}

function objToRow_(table, headers, obj) {
  const row = [];
  const schemaHeaders = SCHEMA[table] || [];
  for (let c = 0; c < headers.length; c++) {
    const rawKey = String(headers[c] || "").trim();
    const normRawKey = normalizeHeader_(rawKey);
    // Find matching key in SCHEMA using normalizeHeader_, or fallback
    const key = schemaHeaders.find(h => normalizeHeader_(h) === normRawKey) || rawKey;

    let val = obj ? (obj[key] !== undefined ? obj[key] : obj[rawKey]) : "";
    
    // Fallback: match on obj keys using normalizeHeader_ if still undefined
    if (obj && val === undefined) {
      const objKey = Object.keys(obj).find(k => normalizeHeader_(k) === normRawKey);
      if (objKey) {
        val = obj[objKey];
      }
    }

    if (JSON_FIELDS[table] && JSON_FIELDS[table].indexOf(key) >= 0) {
      if (val && typeof val !== "string") {
        val = JSON.stringify(val);
      }
    }
    row.push(val == null ? "" : val);
  }
  return row;
}

function normalizeTable_(name) {
  if (!name) return "";
  const t = String(name).toUpperCase().trim();
  return SCHEMA[t] ? t : "";
}

function getSheet_(table) {
  const ss = getSpreadsheet_(CONFIG.SPREADSHEET_ID);
  const sh = ss.getSheetByName(table);
  if (!sh) throw new Error("missing_sheet_" + table);
  return sh;
}

function parsePayload_(e) {
  if (!e || !e.postData || !e.postData.contents) return {};
  try {
    return JSON.parse(e.postData.contents);
  } catch (err) {
    return {};
  }
}

function authorize_(key) {
  if (!CONFIG.API_KEY || CONFIG.API_KEY === "ThisIsMySecretKey123!@") return true;
  return String(key || "") === String(CONFIG.API_KEY);
}

function incrementDbVersion_() {
  try {
    const props = PropertiesService.getScriptProperties();
    const current = parseInt(props.getProperty("DB_VERSION") || "0", 10);
    const next = current + 1;
    props.setProperty("DB_VERSION", String(next));
    return next;
  } catch (e) {
    console.warn("Failed to increment DB_VERSION:", e);
    return Date.now();
  }
}

function getDbVersion_() {
  try {
    const props = PropertiesService.getScriptProperties();
    return parseInt(props.getProperty("DB_VERSION") || "1", 10);
  } catch (e) {
    return Date.now();
  }
}

function jsonResponse_(payload) {
  var output = ContentService.createTextOutput(JSON.stringify(payload));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}

function jsonError_(message, code) {
  return jsonResponse_({ 
    ok: false, 
    error: message, 
    code: code || 500, 
    ts: new Date().toISOString() 
  });
}

function withLock(fn) {
  const lock = LockService.getScriptLock();
  const acquired = lock.tryLock(7000);
  if (!acquired) throw new Error("busy_try_again");
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function parseNumber_(val) {
  if (val === "" || val == null) return val;
  const n = Number(val);
  return isNaN(n) ? val : n;
}

function parseBoolean_(val) {
  if (val === true || val === false) return val;
  if (val === 1 || val === "1") return true;
  if (val === 0 || val === "0") return false;
  if (typeof val === "string") {
    const v = val.trim().toLowerCase();
    if (v === "true" || v === "yes" || v === "y") return true;
    if (v === "false" || v === "no" || v === "n") return false;
  }
  return val;
}

function parseUnitSettingValue_(key, raw) {
  if (UNIT_JSON_KEYS.indexOf(key) >= 0) {
    if (typeof raw === "string" && raw.trim()) {
      try {
        return JSON.parse(raw);
      } catch (err) {
        return {};
      }
    }
    if (typeof raw === "object" && raw) return raw;
    return {};
  }
  return raw == null ? "" : raw;
}

function formatUnitSettingValue_(key, val) {
  if (UNIT_JSON_KEYS.indexOf(key) >= 0) {
    if (val && typeof val !== "string") {
      return JSON.stringify(val);
    }
  }
  return val == null ? "" : String(val);
}

function hashUserPasswords() {
  const ss = getSpreadsheet_(CONFIG.SPREADSHEET_ID);
  const sh = ss.getSheetByName("USERS");
  if (!sh) throw new Error("USERS sheet not found");

  const data = sh.getDataRange().getValues();
  if (data.length < 2) return "No user rows";

  const headers = data[0];
  const idx = headers.indexOf("password_hash");
  if (idx === -1) throw new Error("password_hash column not found");

  const isHex64 = (s) => typeof s === "string" && /^[a-f0-9]{64}$/i.test(s.trim());

  let changed = 0;
  for (let r = 1; r < data.length; r++) {
    const raw = String(data[r][idx] || "").trim();
    if (!raw) continue;
    if (isHex64(raw)) continue; // already hashed

    const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw, Utilities.Charset.UTF_8);
    const hex = bytes.map((b) => ("0" + (b & 0xff).toString(16)).slice(-2)).join("");
    data[r][idx] = hex;
    changed++;
  }

  if (changed > 0) {
    sh.getRange(2, 1, data.length - 1, headers.length).setValues(data.slice(1));
  }

  return `Hashed ${changed} password(s).`;
}

/**
 * Scheduled task: Notify users of incomplete checklist items.
 * Recommended trigger: Every Thursday 5pm, Every Saturday 3pm.
 */
function scheduledChecklistReminders() {
  const db = getFullDB_();
  // Find planners that are in SUBMITTED state (currently active)
  const activePlanners = db.PLANNERS.filter(p => p.state === "SUBMITTED");
  if (activePlanners.length === 0) return "No active planners found.";

  const notifications = [];
  const now = new Date().toISOString();

  activePlanners.forEach(planner => {
    // Find checklist items for this planner that are incomplete
    const incomplete = db.CHECKLISTS.filter(c => c.planner_id === planner.planner_id && !c.status);
    if (incomplete.length === 0) return;

    // Group by week
    const weeksWithIncomplete = [...new Set(incomplete.map(c => c.week_id))];
    
    // Notify all users except MUSIC role
    const usersToNotify = db.USERS.filter(u => u.role !== "MUSIC" && !u.disabled);

    weeksWithIncomplete.forEach(week_id => {
      const weekTasks = incomplete.filter(c => c.week_id === week_id);
      const weekLabel = weekTasks[0]?.week_label || "Active Week";

      usersToNotify.forEach(user => {
        notifications.push({
          notification_id: "notif_" + Math.random().toString(36).substr(2, 9),
          to_user_id: user.user_id,
          type: "REMINDER",
          created_date: now,
          read: false,
          title: "Checklist Reminder",
          body: `There are ${weekTasks.length} items incomplete in the checklist for ${weekLabel}.`,
          meta: JSON.stringify({ planner_id: planner.planner_id, week_id: week_id })
        });
      });
    });
  });

  if (notifications.length > 0) {
    const sheet = getSheet_("NOTIFICATIONS");
    const headers = SCHEMA.NOTIFICATIONS;
    notifications.forEach(n => {
      sheet.appendRow(objToRow_("NOTIFICATIONS", headers, n));
      // Send email for scheduled reminders too
      try { sendEmail_(n); } catch (e) { console.warn("Reminder email failed:", e); }
    });
    return `Sent ${notifications.length} reminder(s).`;
  }
  return "All checklist items complete.";
}

/**
 * Helper to send email via MailApp.
 * Uses the email address linked to the user_id in the USERS table.
 */
function sendEmail_(notif) {
  if (!notif.to_user_id || !notif.title) return;
  
  const users = getAllRows_("USERS");
  const user = users.find(u => u.user_id === notif.to_user_id);
  if (!user || !user.email) return;

  const body = `${notif.body}\n\n---\nSacrament Meeting Planner\nThis is an automated notification. Please log in to the platform to take action.`;
  
  try {
    MailApp.sendEmail({
      to: user.email,
      subject: `[Sacrament Planner] ${notif.title}`,
      body: body
    });
    console.log(`[Email] Sent to ${user.email}: ${notif.title}`);
  } catch (e) {
    if (String(e).indexOf("permission") !== -1) {
      console.warn("Email permission missing. Please authorize in Apps Script editor.");
    } else {
      console.warn("Email failed:", e);
    }
  }
}

function getFullDB_() {
  const out = {};
  Object.keys(SCHEMA).forEach(t => {
    if (t === "UNIT_SETTINGS") out[t] = getUnitSettings_();
    else out[t] = getAllRows_(t);
  });
  return out;
}

function syncLdsHymns() {
  const sacramentHymns = [
    { number: 169, title: "As Now We Take the Sacrament", theme: "Sacrament" },
    { number: 170, title: "God, Our Father, Hear Us Pray", theme: "Sacrament" },
    { number: 171, title: "With Humble Heart", theme: "Sacrament" },
    { number: 172, title: "In Humility, Our Savior", theme: "Sacrament" },
    { number: 173, title: "While of These Emblems We Partake", theme: "Sacrament" },
    { number: 174, title: "While of These Emblems We Partake", theme: "Sacrament" },
    { number: 175, title: "O God, the Eternal Father", theme: "Sacrament" },
    { number: 176, title: "Tis Sweet to Sing the Matchless Love", theme: "Sacrament" },
    { number: 177, title: "Tis Sweet to Sing the Matchless Love", theme: "Sacrament" },
    { number: 178, title: "O Lord of Hosanna", theme: "Sacrament" },
    { number: 179, title: "Again, Our Dear Redeeming Lord", theme: "Sacrament" },
    { number: 180, title: "Father in Heaven, We Do Believe", theme: "Sacrament" },
    { number: 181, title: "Jesus of Nazareth, Savior and King", theme: "Sacrament" },
    { number: 182, title: "We'll Sing All Hail to Jesus' Name", theme: "Sacrament" },
    { number: 183, title: "In Remembrance of Thy Suffering", theme: "Sacrament" },
    { number: 184, title: "Upon the Cross of Calvary", theme: "Sacrament" },
    { number: 185, title: "Reverently and Meekly Now", theme: "Sacrament" },
    { number: 186, title: "Again We Meet around the Board", theme: "Sacrament" },
    { number: 187, title: "God Loved Us, So He Sent His Son", theme: "Sacrament" },
    { number: 188, title: "Thy Will, O Lord, Be Done", theme: "Sacrament" },
    { number: 189, title: "O Thou, Before the World Began", theme: "Sacrament" },
    { number: 190, title: "In Memory of the Crucified", theme: "Sacrament" },
    { number: 191, title: "Behold the Great Redeemer Die", theme: "Sacrament" },
    { number: 192, title: "He Died! The Great Redeemer Died", theme: "Sacrament" },
    { number: 193, title: "I Stand All Amazed", theme: "Sacrament" },
    { number: 194, title: "There Is a Green Hill Far Away", theme: "Sacrament" },
    { number: 195, title: "How Great the Wisdom and the Love", theme: "Sacrament" },
    { number: 196, title: "Jesus, Once of Humble Birth", theme: "Sacrament" },
  ];

  const classics = [
    { number: 1, title: "The Morning Breaks", theme: "Restoration" },
    { number: 2, title: "The Spirit of God", theme: "Restoration" },
    { number: 3, title: "Now Let Us Rejoice", theme: "Restoration" },
    { number: 4, title: "Truth Eternal", theme: "Restoration" },
    { number: 5, title: "High on the Mountain Top", theme: "Restoration" },
    { number: 6, title: "Redeemer of Israel", theme: "Savior" },
    { number: 7, title: "Israel, Israel, God Is Calling", theme: "Restoration" },
    { number: 8, title: "Awake and Arise", theme: "Restoration" },
    { number: 9, title: "Come, Rejoice", theme: "Restoration" },
    { number: 10, title: "Come, Sing to the Lord", theme: "Praise" },
    { number: 19, title: "We Thank Thee, O God, for a Prophet", theme: "Prophets" },
    { number: 20, title: "God of Power, God of Right", theme: "Prophets" },
    { number: 21, title: "Come, Listen to a Prophet's Voice", theme: "Prophets" },
    { number: 22, title: "We Listen to a Prophet's Voice", theme: "Prophets" },
    { number: 23, title: "We Ever Pray for Thee", theme: "Prophets" },
    { number: 26, title: "Joseph Smith's First Prayer", theme: "Joseph Smith" },
    { number: 27, title: "Praise to the Man", theme: "Joseph Smith" },
    { number: 29, title: "A Poor Wayfaring Man of Grief", theme: "Savior" },
    { number: 30, title: "Come, Come, Ye Saints", theme: "Pioneers" },
    { number: 58, title: "Come, Ye Children of the Lord", theme: "Praise" },
    { number: 59, title: "Lord, We Come Before Thee Now", theme: "Praise" },
    { number: 60, title: "Who's on the Lord's Side?", theme: "Commitment" },
    { number: 61, title: "Raise Your Voices to the Lord", theme: "Praise" },
    { number: 62, title: "All Creatures of Our God and King", theme: "Praise" },
    { number: 63, title: "Great King of Heaven", theme: "Praise" },
    { number: 64, title: "On This Day of Joy and Gladness", theme: "Sabbath" },
    { number: 65, title: "Come, All Ye Saints Who Dwell on Earth", theme: "Praise" },
    { number: 66, title: "Rejoice, the Lord Is King!", theme: "Praise" },
    { number: 67, title: "Glory to God on High", theme: "Praise" },
    { number: 68, title: "A Mighty Fortress Is Our God", theme: "Faith" },
    { number: 69, title: "All Glory, Laud, and Honor", theme: "Praise" },
    { number: 70, title: "Sing Praise to Him", theme: "Praise" },
    { number: 81, title: "Press Forward, Saints", theme: "Commitment" },
    { number: 82, title: "For All the Saints", theme: "Commitment" },
    { number: 83, title: "Guide Us, O Thou Great Jehovah", theme: "Guidance" },
    { number: 84, title: "Faith of Our Fathers", theme: "Faith" },
    { number: 85, title: "How Firm a Foundation", theme: "Faith" },
    { number: 86, title: "How Gentle God's Commands", theme: "Comfort" },
    { number: 87, title: "God Is Love", theme: "Love" },
    { number: 88, title: "Great Is Thy Faithfulness", theme: "Praise" },
    { number: 89, title: "The Lord Is My Shepherd", theme: "Comfort" },
    { number: 90, title: "From All That Dwell below the Skies", theme: "Praise" },
    { number: 91, title: "Father, Thy Children to Thee Now Raise", theme: "Praise" },
    { number: 92, title: "For the Beauty of the Earth", theme: "Gratitude" },
    { number: 93, title: "Prayer of Thanksgiving", theme: "Gratitude" },
    { number: 94, title: "Come, Ye Thankful People", theme: "Gratitude" },
    { number: 95, title: "Now Thank We All Our God", theme: "Gratitude" },
    { number: 96, title: "Dearest Children, God Is Near You", theme: "Love" },
    { number: 97, title: "Lead, Kindly Light", theme: "Guidance" },
    { number: 98, title: "I Need Thee Every Hour", theme: "Prayer" },
    { number: 99, title: "Nearer, Dear Savior, to Thee", theme: "Prayer" },
    { number: 100, title: "Nearer, My God, to Thee", theme: "Prayer" },
    { number: 101, title: "Guide Me to Thee", theme: "Prayer" },
    { number: 102, title: "Jesus, Lover of My Soul", theme: "Savior" },
    { number: 103, title: "Precious Savior, Dear Redeeming Lord", theme: "Savior" },
    { number: 104, title: "Jesus, Savior, Pilot Me", theme: "Guidance" },
    { number: 105, title: "Master, the Tempest Is Raging", theme: "Faith" },
    { number: 106, title: "Sweet Is the Peace the Gospel Brings", theme: "Peace" },
    { number: 107, title: "Lord, Accept Our True Devotion", theme: "Prayer" },
    { number: 108, title: "The Lord Is My Light", theme: "Guidance" },
    { number: 109, title: "Lord, I Would Follow Thee", theme: "Commitment" },
    { number: 110, title: "Keep the Commandments", theme: "Obedience" },
    { number: 111, title: "Rock of Ages", theme: "Savior" },
    { number: 112, title: "Savior, Redeemer of My Soul", theme: "Savior" },
    { number: 113, title: "Our Savior's Love", theme: "Love" },
    { number: 114, title: "Come unto Him", theme: "Savior" },
    { number: 115, title: "Come, Ye Disconsolate", theme: "Comfort" },
    { number: 116, title: "Come, Follow Me", theme: "Savior" },
    { number: 117, title: "Come unto Jesus", theme: "Savior" },
    { number: 118, title: "Ye Simple Souls Who Stray", theme: "Warning" },
    { number: 119, title: "Come, We That Love the Lord", theme: "Praise" },
    { number: 120, title: "Lean on My Ample Arm", theme: "Comfort" },
    { number: 121, title: "I'm a Pilgrim, I'm a Stranger", theme: "Faith" },
    { number: 122, title: "Though Deepening Trials", theme: "Faith" },
    { number: 123, title: "Oh, May My Soul Commune with Thee", theme: "Prayer" },
    { number: 124, title: "Be Still, My Soul", theme: "Peace" },
    { number: 125, title: "How Gentle God's Commands", theme: "Comfort" },
    { number: 126, title: "How Long, O Lord Most Holy and True", theme: "Praise" },
    { number: 127, title: "Does the Journey Seem Long?", theme: "Comfort" },
    { number: 128, title: "When Faith Endures", theme: "Faith" },
    { number: 129, title: "Where Can I Turn for Peace?", theme: "Peace" },
    { number: 130, title: "Be Thou Humble", theme: "Humility" },
    { number: 131, title: "More Holiness Give Me", theme: "Prayer" },
    { number: 132, title: "God Is in His Holy Temple", theme: "Praise" },
    { number: 133, title: "Father in Heaven", theme: "Prayer" },
    { number: 134, title: "I Believe in Christ", theme: "Savior" },
    { number: 135, title: "My Redeemer Lives", theme: "Savior" },
    { number: 136, title: "I Know That My Redeemer Lives", theme: "Savior" },
    { number: 137, title: "Testimony", theme: "Testimony" },
    { number: 138, title: "Bless Our Fast, We Pray", theme: "Fast" },
    { number: 139, title: "In Fasting We Approach Thee", theme: "Fast" },
    { number: 140, title: "Did You Think to Pray?", theme: "Prayer" },
    { number: 141, title: "Jesus, the Very Thought of Thee", theme: "Savior" },
    { number: 142, title: "Sweet Hour of Prayer", theme: "Prayer" },
    { number: 143, title: "Let the Holy Spirit Guide", theme: "Guidance" },
    { number: 144, title: "Secret Prayer", theme: "Prayer" },
    { number: 145, title: "Prayer Is the Soul's Sincere Desire", theme: "Prayer" },
    { number: 146, title: "Gently Raise the Sacred Strain", theme: "Sabbath" },
    { number: 147, title: "Sweet Is the Work", theme: "Sabbath" },
    { number: 148, title: "Sabbath Day", theme: "Sabbath" },
    { number: 149, title: "As the Dew from Heaven Distilling", theme: "Praise" },
    { number: 150, title: "O Thou Kind and Gracious Father", theme: "Prayer" },
    { number: 151, title: "We Meet, Dear Lord", theme: "Sabbath" },
    { number: 152, title: "God Be with You Till We Meet Again", theme: "Parting" },
    { number: 153, title: "Lord, We Ask Thee Ere We Part", theme: "Parting" },
    { number: 154, title: "Father, This Hour Has Been One of Joy", theme: "Parting" },
    { number: 155, title: "We Have Partaken of Thy Love", theme: "Parting" },
    { number: 156, title: "Sing We Now at Parting", theme: "Parting" },
    { number: 157, title: "Thy Holy Word", theme: "Scriptures" },
    { number: 158, title: "Before Thee, Lord, I Bow My Head", theme: "Prayer" },
    { number: 159, title: "Now the Day Is Over", theme: "Parting" },
    { number: 160, title: "Softly Now the Light of Day", theme: "Parting" },
    { number: 161, title: "The Day Dawn Is Breaking", theme: "Restoration" },
    { number: 162, title: "Lord, We Come Before Thee Now", theme: "Praise" },
    { number: 163, title: "Lord, Dismiss Us with Thy Blessing", theme: "Parting" },
    { number: 164, title: "Great God, to Thee My Evening Song", theme: "Parting" },
    { number: 165, title: "Abide with Me", theme: "Prayer" },
    { number: 166, title: "Abide with Me; Tis Eventide", theme: "Savior" },
    { number: 167, title: "Come, Let Us Pray", theme: "Prayer" },
    { number: 168, title: "As the Shadows Fall", theme: "Parting" },
    { number: 197, title: "O Savior, Thou Who Wearest a Crown", theme: "Easter" },
    { number: 198, title: "That Easter Morn", theme: "Easter" },
    { number: 199, title: "He Is Risen!", theme: "Easter" },
    { number: 200, title: "Christ the Lord Is Risen Today", theme: "Easter" },
    { number: 201, title: "Joy to the World", theme: "Christmas" },
    { number: 202, title: "Oh, Come, All Ye Faithful", theme: "Christmas" },
    { number: 203, title: "Angels We Have Heard on High", theme: "Christmas" },
    { number: 204, title: "Silent Night", theme: "Christmas" },
    { number: 205, title: "Once in Royal David's City", theme: "Christmas" },
    { number: 206, title: "Away in a Manger", theme: "Christmas" },
    { number: 207, title: "It Came upon the Midnight Clear", theme: "Christmas" },
    { number: 208, title: "O Little Town of Bethlehem", theme: "Christmas" },
    { number: 209, title: "Hark! The Herald Angels Sing", theme: "Christmas" },
    { number: 210, title: "With Wondering Awe", theme: "Christmas" },
    { number: 211, title: "While Shepherds Watched Their Flocks", theme: "Christmas" },
    { number: 212, title: "Far, Far Away on Judea's Plains", theme: "Christmas" },
    { number: 213, title: "The First Noel", theme: "Christmas" },
    { number: 214, title: "I Heard the Bells on Christmas Day", theme: "Christmas" },
    { number: 215, title: "Ring Out, Wild Bells", theme: "New Year" },
    { number: 216, title: "We Are Sowing", theme: "Work" },
    { number: 217, title: "Come, Let Us Anew", theme: "New Year" },
    { number: 218, title: "We Give Thee But Thine Own", theme: "Gratitude" },
    { number: 219, title: "Because I Have Been Given Much", theme: "Service" },
    { number: 220, title: "Lord, I Would Follow Thee", theme: "Commitment" },
    { number: 221, title: "Dear to the Heart of the Shepherd", theme: "Savior" },
    { number: 222, title: "Hear Thou Our Hymn, O Lord", theme: "Prayer" },
    { number: 223, title: "Have I Done Any Good?", theme: "Service" },
    { number: 224, title: "I Have Work to Do", theme: "Work" },
    { number: 225, title: "We Are Marching On to Glory", theme: "Work" },
    { number: 226, title: "Improve the Shining Moments", theme: "Work" },
    { number: 227, title: "There Is Sunshine in My Soul Today", theme: "Joy" },
    { number: 228, title: "You Can Make the Pathway Bright", theme: "Joy" },
    { number: 229, title: "Today, While the Sun Shines", theme: "Work" },
    { number: 230, title: "Scatter Sunshine", theme: "Joy" },
    { number: 231, title: "Father, Cheer Our Spirits", theme: "Prayer" },
    { number: 232, title: "Let Us Oft Speak Kind Words", theme: "Love" },
    { number: 233, title: "Nay, Speak No Ill", theme: "Love" },
    { number: 234, title: "Jesus, Mighty King in Zion", theme: "Baptism" },
    { number: 235, title: "How Gentle God's Commands", theme: "Comfort" },
    { number: 236, title: "Lord, Accept into Thy Kingdom", theme: "Baptism" },
    { number: 237, title: "Do What Is Right", theme: "Commitment" },
    { number: 238, title: "Behold Thy Sons and Daughters, Lord", theme: "Baptism" },
    { number: 239, title: "Choose the Right", theme: "Agency" },
    { number: 240, title: "Know This, That Every Soul Is Free", theme: "Agency" },
    { number: 241, title: "Count Your Blessings", theme: "Gratitude" },
    { number: 242, title: "Praise God, from Whom All Blessings Flow", theme: "Praise" },
    { number: 243, title: "Let Us All Press On", theme: "Commitment" },
    { number: 244, title: "Come, Along, Let's Join the Youth", theme: "Commitment" },
    { number: 245, title: "This House We Dedicate to Thee", theme: "Dedication" },
    { number: 246, title: "Onward, Christian Soldiers", theme: "Commitment" },
    { number: 247, title: "We Love Thy House, O God", theme: "Dedication" },
    { number: 248, title: "Up, Awake, Ye Defenders of Zion", theme: "Commitment" },
    { number: 249, title: "Called to Serve", theme: "Mission" },
    { number: 250, title: "We Are All Enlisted", theme: "Commitment" },
    { number: 251, title: "Behold! A Royal Army", theme: "Commitment" },
    { number: 252, title: "Put Your Shoulder to the Wheel", theme: "Work" },
    { number: 253, title: "Hope of Israel", theme: "Youth" },
    { number: 254, title: "True to the Faith", theme: "Youth" },
    { number: 255, title: "Carry On", theme: "Youth" },
    { number: 256, title: "As Zion's Youth in Latter Days", theme: "Youth" },
    { number: 257, title: "Rejoice! A Glorious Sound Is Heard", theme: "Restoration" },
    { number: 258, title: "O Thou Rock of Our Salvation", theme: "Savior" },
    { number: 259, title: "Holy Temples on Mount Zion", theme: "Temples" },
    { number: 260, title: "Who Are These Arrayed in White?", theme: "Temples" },
    { number: 261, title: "Thy People When They Bend the Knee", theme: "Temples" },
    { number: 262, title: "Go, Ye Messengers of Glory", theme: "Mission" },
    { number: 263, title: "Go, Ye Messengers of Heaven", theme: "Mission" },
    { number: 264, title: "Hark, All Ye Nations!", theme: "Mission" },
    { number: 265, title: "Arise, O God, and Shine", theme: "Mission" },
    { number: 266, title: "The Time Is Far Spent", theme: "Mission" },
    { number: 267, title: "How Wondrous and Great", theme: "Praise" },
    { number: 268, title: "Come, All Whose Souls are Lighted", theme: "Mission" },
    { number: 269, title: "What Was Witnessed in the Heavens?", theme: "Mission" },
    { number: 270, title: "I'll Go Where You Want Me to Go", theme: "Commitment" },
    { number: 271, title: "Oh, Holy Words of Truth and Love", theme: "Scriptures" },
    { number: 272, title: "Oh Say, What Is Truth?", theme: "Truth" },
    { number: 273, title: "Truth Reflects upon Our Senses", theme: "Truth" },
    { number: 274, title: "The Iron Rod", theme: "Scriptures" },
    { number: 275, title: "Men Are That They Might Have Joy", theme: "Joy" },
    { number: 276, title: "Come Away to the Sunday School", theme: "Sabbath" },
    { number: 277, title: "As I Search the Holy Scriptures", theme: "Scriptures" },
    { number: 278, title: "Thanks for the Sabbath School", theme: "Sabbath" },
    { number: 279, title: "Thy Holy Word", theme: "Scriptures" },
    { number: 280, title: "Welcome, Welcome, Sabbath Morning", theme: "Sabbath" },
    { number: 281, title: "Help Me Teach with Inspiration", theme: "Service" },
    { number: 282, title: "We Meet Again in Sabbath School", theme: "Sabbath" },
    { number: 283, title: "The Glorious Gospel Light Has Shone", theme: "Restoration" },
    { number: 284, title: "If You Could Hie to Kolob", theme: "Eternity" },
    { number: 285, title: "God Moves in a Mysterious Way", theme: "Faith" },
    { number: 286, title: "Oh, What Songs of the Heart", theme: "Eternity" },
    { number: 287, title: "Rise, Ye Saints, and Temples Enter", theme: "Temples" },
    { number: 288, title: "How Beautiful Thy Temples, Lord", theme: "Temples" },
    { number: 289, title: "Holy Temples on Mount Zion", theme: "Temples" },
    { number: 290, title: "Rejoice, Ye Saints of Latter Days", theme: "Restoration" },
    { number: 291, title: "Turn Your Hearts", theme: "Family History" },
    { number: 292, title: "O My Father", theme: "God the Father" },
    { number: 293, title: "Each Life That Touches Ours for Good", theme: "Love" },
    { number: 294, title: "Love at Home", theme: "Family" },
    { number: 295, title: "O Love That Glorifies the Son", theme: "Love" },
    { number: 296, title: "Our Father, by Whose Name", theme: "Family" },
    { number: 297, title: "From Homes of Saints Glad Songs Arise", theme: "Family" },
    { number: 298, title: "Home Can Be a Heaven on Earth", theme: "Family" },
    { number: 299, title: "Children of Our Heavenly Father", theme: "Children" },
    { number: 300, title: "Families Can Be Together Forever", theme: "Family" },
    { number: 301, title: "I Am a Child of God", theme: "Children" },
    { number: 302, title: "I Know My Father Lives", theme: "Children" },
    { number: 303, title: "Keep the Commandments", theme: "Children" },
    { number: 304, title: "Teach Me to Walk in the Light", theme: "Children" },
    { number: 305, title: "The Light Divine", theme: "Savior" },
    { number: 306, title: "Lead Me, Guide Me", theme: "Guidance" },
    { number: 307, title: "In Our Lovely Deseret", theme: "Obedience" },
    { number: 308, title: "Love One Another", theme: "Love" },
    { number: 309, title: "As Sisters in Zion", theme: "Women" },
    { number: 310, title: "A Key Was Turned in Latter Days", theme: "Women" },
    { number: 311, title: "We Meet Again as Sisters", theme: "Women" },
    { number: 312, title: "We Ever Pray for Thee", theme: "Prophets" },
    { number: 313, title: "God Is Love", theme: "Love" },
    { number: 314, title: "How Gentle God's Commands", theme: "Comfort" },
    { number: 315, title: "Jesus, the Very Thought of Thee", theme: "Savior" },
    { number: 316, title: "The Lord Is My Shepherd", theme: "Comfort" },
    { number: 317, title: "Sweet Is the Work", theme: "Sabbath" },
    { number: 318, title: "Love at Home", theme: "Family" },
    { number: 319, title: "Ye Elders of Israel", theme: "Men" },
    { number: 320, title: "The Priesthood of Our Lord", theme: "Men" },
    { number: 321, title: "Ye Who Are Called to Declare Glad Tidings", theme: "Men" },
    { number: 322, title: "Come, All Ye Sons of God", theme: "Men" },
    { number: 323, title: "Rise Up, O Men of God", theme: "Men" },
    { number: 324, title: "Rise Up, O Men of God", theme: "Men" },
    { number: 325, title: "See the Mighty Priesthood Gathered", theme: "Men" },
    { number: 326, title: "Come, Come, Ye Saints", theme: "Men" },
    { number: 327, title: "Go, Ye Messengers of Glory", theme: "Men" },
    { number: 328, title: "An Angel from on High", theme: "Men" },
    { number: 329, title: "Thy Servants Are Prepared", theme: "Men" },
    { number: 330, title: "See, the Mighty Angel Flying", theme: "Men" },
    { number: 331, title: "Oh Say, What Is Truth?", theme: "Men" },
    { number: 332, title: "The Iron Rod", theme: "Men" },
    { number: 333, title: "High on the Mountain Top", theme: "Men" },
    { number: 334, title: "I Need Thee Every Hour", theme: "Men" },
    { number: 335, title: "Brightly Beams Our Father's Mercy", theme: "Men" },
    { number: 336, title: "School Thy Feelings", theme: "Men" },
    { number: 337, title: "O Home Beloved", theme: "Men" },
    { number: 338, title: "America the Beautiful", theme: "Patriotic" },
    { number: 339, title: "My Country, Tis of Thee", theme: "Patriotic" },
    { number: 340, title: "The Star-Spangled Banner", theme: "Patriotic" },
    { number: 341, title: "God Bless Our Native Land", theme: "Patriotic" },
  ];

  const newSongs = [
    { number: 1001, title: "Come, Thou Fount of Every Blessing", theme: "Praise" },
    { number: 1002, title: "When the Savior Comes Again", theme: "Savior" },
    { number: 1003, title: "It Is Well with My Soul", theme: "Peace" },
    { number: 1004, title: "I Will Walk with Jesus", theme: "Children, Savior" },
    { number: 1005, title: "His Eye Is on the Sparrow", theme: "Comfort" },
    { number: 1006, title: "Think a Sacred Song", theme: "Virtue" },
    { number: 1007, title: "As Bread Is Broken", theme: "Sacrament" },
    { number: 1008, title: "Bread of Life, Living Water", theme: "Sacrament" },
    { number: 1009, title: "Gethsemane", theme: "Savior" },
    { number: 1010, title: "Amazing Grace", theme: "Grace" },
  ];

  const all = [
    ...sacramentHymns.map(h => ({ ...h, type: "Sacrament" })),
    ...classics.map(h => ({ ...h, type: "Classic" })),
    ...newSongs.map(h => ({ ...h, type: "New" })),
  ];

  const now = new Date().toISOString();
  all.forEach(h => {
    h.updated_date = now;
    upsertRow_("HYMNS", h, "number");
  });

  return `Synced ${all.length} hymns including sacrament collection and new global releases.`;
}

function recalculateMemberAnalytics_() {
  const ss = getSpreadsheet_(CONFIG.SPREADSHEET_ID);
  const memSheet = ss.getSheetByName("MEMBERS");
  if (!memSheet) return;
  
  ensureSchema_();
  
  const memData = memSheet.getDataRange().getValues();
  if (memData.length <= 1) return;
  
  const memHeaders = memData[0].map(h => normalizeHeader_(h));
  
  const nameIdx = memHeaders.indexOf(normalizeHeader_("name"));
  const statusIdx = memHeaders.indexOf(normalizeHeader_("status"));
  const totalIdx = memHeaders.indexOf(normalizeHeader_("total_assignments"));
  const spokenIdx = memHeaders.indexOf(normalizeHeader_("spoken_count"));
  const prayersIdx = memHeaders.indexOf(normalizeHeader_("prayers_count"));
  const lastDateIdx = memHeaders.indexOf(normalizeHeader_("last_assigned_date"));
  const readinessIdx = memHeaders.indexOf(normalizeHeader_("readiness_score"));
  
  if (nameIdx < 0) return;
  
  let assignments = [];
  const assSheet = ss.getSheetByName("ASSIGNMENTS");
  if (assSheet) {
    const assData = assSheet.getDataRange().getValues();
    if (assData.length > 1) {
      const assHeaders = assData[0].map(h => normalizeHeader_(h));
      const personIdx = assHeaders.indexOf(normalizeHeader_("person"));
      const roleIdx = assHeaders.indexOf(normalizeHeader_("role"));
      const dateIdx = assHeaders.indexOf(normalizeHeader_("date"));
      const topicIdx = assHeaders.indexOf(normalizeHeader_("topic"));
      for (let r = 1; r < assData.length; r++) {
        const row = assData[r];
        assignments.push({
          person: personIdx >= 0 ? String(row[personIdx] || "").trim() : "",
          role: roleIdx >= 0 ? String(row[roleIdx] || "").trim() : "",
          date: dateIdx >= 0 ? String(row[dateIdx] || "").trim() : "",
          topic: topicIdx >= 0 ? String(row[topicIdx] || "").trim() : "",
        });
      }
    }
  }
  
  let planners = [];
  const planSheet = ss.getSheetByName("PLANNERS");
  if (planSheet) {
    const planData = planSheet.getDataRange().getValues();
    if (planData.length > 1) {
      const planHeaders = planData[0].map(h => normalizeHeader_(h));
      const stateIdx = planHeaders.indexOf(normalizeHeader_("state"));
      const weeksIdx = planHeaders.indexOf(normalizeHeader_("weeks"));
      for (let r = 1; r < planData.length; r++) {
        const row = planData[r];
        const state = stateIdx >= 0 ? String(row[stateIdx] || "").trim() : "";
        if (state === "DRAFT") continue;
        let weeks = [];
        const rawWeeks = weeksIdx >= 0 ? String(row[weeksIdx] || "").trim() : "";
        if (rawWeeks) {
          try { weeks = JSON.parse(rawWeeks); } catch (e) {}
        }
        planners.push({ weeks });
      }
    }
  }
  
  const plannerAssignments = [];
  for (const p of planners) {
    for (const w of p.weeks) {
      const wDate = w.date || "";
      if (!wDate) continue;
      
      const items = [
        { name: w.conducting_officer, role: "conducting" },
        { name: w.presiding, role: "presiding" },
        ...(w.speakers || []).map(s => ({ name: s.name, role: "speaker", topic: s.topic })),
        { name: w.prayers?.invocation, role: "invocation" },
        { name: w.prayers?.benediction, role: "benediction" },
        { name: w.music?.director, role: "director" },
        { name: w.music?.accompanist, role: "accompanist" },
        ...(w.sacrament?.preparing || []).map(n => ({ name: n, role: "preparing" })),
        ...(w.sacrament?.blessing || []).map(n => ({ name: n, role: "blessing" })),
        ...(w.sacrament?.passing || []).map(n => ({ name: n, role: "passing" })),
      ];
      for (const it of items) {
        if (it.name) {
          plannerAssignments.push({
            person: it.name,
            role: it.role,
            date: wDate,
            topic: it.topic || ""
          });
        }
      }
    }
  }
  
  const allAssignments = [...assignments, ...plannerAssignments];
  
  function normName(name) {
    if (!name) return "";
    return name.toLowerCase()
      .replace(/^(bishop|brother|sister|elder|president|stake|ward|br|sr)\s+/g, "")
      .replace(/[^a-z0-9\s]/g, "")
      .trim();
  }
  
  function fuzzyMatch(nameA, nameB) {
    const cleanA = normName(nameA);
    const cleanB = normName(nameB);
    if (!cleanA || !cleanB) return false;
    if (cleanA === cleanB) return true;
    
    const partsA = cleanA.split(/\s+/).filter(Boolean);
    const partsB = cleanB.split(/\s+/).filter(Boolean);
    if (partsA.length === 0 || partsB.length === 0) return false;
    
    // Exact match of first and last name
    if (partsA.length >= 2 && partsB.length >= 2) {
      const firstA = partsA[0];
      const lastA = partsA[partsA.length - 1];
      const firstB = partsB[0];
      const lastB = partsB[partsB.length - 1];
      if (firstA === firstB && lastA === lastB) return true;
    }
    
    // Single word matching word boundaries
    if (partsA.length === 1) {
      return partsB.indexOf(partsA[0]) >= 0;
    }
    if (partsB.length === 1) {
      return partsA.indexOf(partsB[0]) >= 0;
    }
    
    return false;
  }
  
  const now = new Date();
  
  for (let r = 1; r < memData.length; r++) {
    const memberName = String(memData[r][nameIdx] || "").trim();
    const status = statusIdx >= 0 ? String(memData[r][statusIdx] || "").trim().toUpperCase() : "ACTIVE";
    
    let total = 0;
    let spoken = 0;
    let prayers = 0;
    let lastDate = "";
    
    for (const a of allAssignments) {
      if (fuzzyMatch(memberName, a.person)) {
        total++;
        const role = a.role.toLowerCase();
        if (role.indexOf("speaker") >= 0) spoken++;
        if (role.indexOf("invocation") >= 0 || role.indexOf("benediction") >= 0 || role.indexOf("prayer") >= 0) prayers++;
        if (a.date && (!lastDate || a.date > lastDate)) {
          lastDate = a.date;
        }
      }
    }
    
    let readiness = 0;
    if (status === "ACTIVE") {
      readiness += 40;
      let monthsSince = 99;
      if (lastDate) {
        try {
          monthsSince = Math.floor((now.getTime() - new Date(lastDate).getTime()) / (1000 * 60 * 60 * 24 * 30));
        } catch(e) {}
      }
      if (monthsSince >= 3) readiness += 30;
      if (spoken < 2) readiness += 20;
      readiness += 10;
    }
    
    if (totalIdx >= 0) memData[r][totalIdx] = total;
    if (spokenIdx >= 0) memData[r][spokenIdx] = spoken;
    if (prayersIdx >= 0) memData[r][prayersIdx] = prayers;
    if (lastDateIdx >= 0) memData[r][lastDateIdx] = lastDate;
    if (readinessIdx >= 0) memData[r][readinessIdx] = readiness;
  }
  
  const numRows = memData.length - 1;
  const numCols = memHeaders.length;
  memSheet.getRange(2, 1, numRows, numCols).setValues(memData.slice(1));
}

/*******************************************************************************
 * 
 * Obantoko Ward Calendar System Integration
 * Appends all functions for Calendar Dashboards, Calendar Matrix and Notification Engine.
 * 
 ******************************************************************************/

function refreshCalendar() { 
  markCalendarActivities(); 
  generateNext14DaysMiniTable();
  generateNext60DaysActivities();
  sendPendingReportEmails();   
  generateCompletionWidget();   
  sendReportFollowUpReminders();   
}

function toDateObject(value) {
  if (value instanceof Date) return value;
  if (!value) return null;
  const parsed = new Date(value);
  if (!isNaN(parsed.getTime())) return parsed;
  return null;
}

function markCalendarActivities() {
  const ss = getSpreadsheet_();

  const activitySheet = ss.getSheetByName("ACTIVITIES");
  const holidaySheet = ss.getSheetByName("PUBLIC HOLIDAY");
  const churchProgSheet = ss.getSheetByName("OTHER CHURCH PROGRAM");
  const calendarSheet = ss.getSheetByName("2026 CALENDAR");

  if (!activitySheet || !holidaySheet || !churchProgSheet || !calendarSheet) {
    console.warn("One or more calendar sheets missing. Skipping cell marking.");
    return;
  }

  // COLORS
  const COLOR_ACTIVITY = "#64e851";
  const COLOR_HOLIDAY = "#f4cccc";
  const COLOR_CHURCH_PROGRAM = "#d9ead3";
  const COLOR_OVERLAP_ACTIVITY_HOLIDAY = "#f5ac1a";
  const COLOR_OVERLAP_ACTIVITY_CHURCH = "#f90202";
  const COLOR_OVERLAP_ALL_THREE = "#980000";

  // ===== READ ACTIVITIES =====
  const lastRowAct = activitySheet.getLastRow();
  const actMap = {};
  if (lastRowAct > 1) {
    // Read columns B to D: Date (B), Activity (C), Org (D)
    const actData = activitySheet.getRange(2, 2, lastRowAct - 1, 3).getValues();
    actData.forEach(r => {
      const d = toDateObject(r[0]);
      if (d) {
        const key = d.toDateString();
        if (!actMap[key]) actMap[key] = [];
        actMap[key].push(`${r[1]} — ${r[2]}`);
      }
    });
  }

  // ===== READ PUBLIC HOLIDAYS =====
  const lastRowHol = holidaySheet.getLastRow();
  const holMap = {};
  if (lastRowHol > 1) {
    // Read columns B to D: Date (B), Holiday (C), Theme (D)
    const holData = holidaySheet.getRange(2, 2, lastRowHol - 1, 3).getValues();
    holData.forEach(r => {
      const d = toDateObject(r[0]);
      if (d) {
        const key = d.toDateString();
        if (!holMap[key]) holMap[key] = [];
        holMap[key].push(`${r[1]} (Theme: ${r[2]})`);
      }
    });
  }

  // ===== READ OTHER CHURCH PROGRAMS =====
  const lastRowCh = churchProgSheet.getLastRow();
  const chMap = {};
  if (lastRowCh > 1) {
    // Read columns B to D: Date (B), Program (C), Org (D)
    const chData = churchProgSheet.getRange(2, 2, lastRowCh - 1, 3).getValues();
    chData.forEach(r => {
      const d = toDateObject(r[0]);
      if (d) {
        const key = d.toDateString();
        if (!chMap[key]) chMap[key] = [];
        chMap[key].push(`${r[1]} — ${r[2]}`);
      }
    });
  }

  // RESET CALENDAR
  const calRange = calendarSheet.getDataRange();
  const calValues = calRange.getValues();
  calRange.clearNote().setBackground(null);

  // PROCESS CALENDAR
  for (let r = 0; r < calValues.length; r++) {
    for (let c = 0; c < calValues[0].length; c++) {
      const day = calValues[r][c];

      if (typeof day === "number" && day >= 1 && day <= 31) {
        const monthIndex = c - 1;
        if (monthIndex >= 0 && monthIndex <= 11) {
          const d = new Date(2026, monthIndex, day);
          const key = d.toDateString();

          const hasAct = !!actMap[key];
          const hasHol = !!holMap[key];
          const hasCh = !!chMap[key];

          if (!hasAct && !hasHol && !hasCh) continue;

          const parts = [];

          if (hasHol) {
            parts.push(`PUBLIC HOLIDAY (${holMap[key].length}):`);
            holMap[key].forEach(i => parts.push(`• ${i}`));
          }

          if (hasCh) {
            parts.push("");
            parts.push(`OTHER CHURCH PROGRAM (${chMap[key].length}):`);
            chMap[key].forEach(i => parts.push(`• ${i}`));
          }

          if (hasAct) {
            parts.push("");
            parts.push(`ACTIVITIES (${actMap[key].length}):`);
            actMap[key].forEach(i => parts.push(`• ${i}`));
          }

          // DECIDE COLOR
          let color = COLOR_ACTIVITY;
          if (hasAct && hasHol && hasCh) color = COLOR_OVERLAP_ALL_THREE;
          else if (hasAct && hasHol) color = COLOR_OVERLAP_ACTIVITY_HOLIDAY;
          else if (hasAct && hasCh) color = COLOR_OVERLAP_ACTIVITY_CHURCH;
          else if (hasHol) color = COLOR_HOLIDAY;
          else if (hasCh) color = COLOR_CHURCH_PROGRAM;

          const bullets = parts.filter(p => p.startsWith("• ")).length;
          const header = `📅 ${bullets} item(s) on this date:\n\n`;

          const cell = calendarSheet.getRange(r + 1, c + 1);
          cell.setBackground(color);
          cell.setNote(header + parts.join("\n"));
        }
      }
    }
  }
  
  drawLegend(calendarSheet);

  // TIMESTAMP
  const stamp = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), "yyyy-MM-dd HH:mm:ss");
  calendarSheet.getRange("Q2").setValue("Last updated: " + stamp);
}

function drawLegend(calendarSheet) {
  // Clear old legend area
  calendarSheet.getRange("P4:Q25").clear().setBackground(null).setBorder(false, false, false, false, false, false);

  // LEGEND TITLE BAR (P4:Q4 merged)
  calendarSheet.getRange("P4:Q4")
    .merge()
    .setValue("LEGEND")
    .setFontWeight("bold")
    .setFontSize(12)
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle")
    .setBackground("#d9d9d9")
    .setBorder(true, true, true, true, true, true);

  // Legend items
  const legend = [
    ["#64e851", "🟩 Ward Activities"],
    ["#f4cccc", "📅 Public Holiday"],
    ["#d9ead3", "⛪ Other Church Program"],
    ["#f5ac1a", "🟧 Activity + Public Holiday Overlapping"],
    ["#f90202", "🔴 Activity + Other Church Program Overlapping"],
    ["#980000", "🟥 ALL THREE Overlapping"]
  ];

  // Write legend rows starting at P5
  for (let i = 0; i < legend.length; i++) {
    let row = 5 + i;

    // Color box in column P
    calendarSheet.getRange(row, 16) // Column P
      .setBackground(legend[i][0])
      .setValue("")
      .setBorder(true, true, true, true, true, true);

    // Description text in column Q
    calendarSheet.getRange(row, 17) // Column Q
      .setValue(legend[i][1])
      .setFontWeight("bold")
      .setVerticalAlignment("middle")
      .setWrap(false)
      .setBorder(true, true, true, true, true, true);
  }

  // Adjust column widths
  calendarSheet.setColumnWidth(16, 88);   // Column P wider (color boxes)
  calendarSheet.setColumnWidth(17, 320);  // Column Q wider, readable

  // Adjust row heights for clean alignment using sheet method
  const startRow = 5;
  const numRows = legend.length;
  const rowHeight = 20;
  calendarSheet.setRowHeights(startRow, numRows, rowHeight);
}

function generateNext60DaysActivities() {
  const ss = getSpreadsheet_();
  const activitiesSheet = ss.getSheetByName("ACTIVITIES");
  const dashboard = ss.getSheetByName("CALENDAR DASHBOARD");

  if (!activitiesSheet || !dashboard) return;

  const titleRange = dashboard.getRange("E2:H2");
  const headerRange = dashboard.getRange("E3:H3");
  const startRow = 4;

  dashboard.getRange("E2:H300").clear().setBackground(null).setBorder(false, false, false, false, false, false);

  // TITLE BAR
  titleRange.merge();
  titleRange
    .setValue("UPCOMING ACTIVITIES (NEXT 60 DAYS)")
    .setFontFamily("Times New Roman")
    .setFontSize(12)
    .setFontWeight("bold")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle")
    .setBackground("#cfe2f3")
    .setBorder(true, true, true, true, true, true, "#274e13", SpreadsheetApp.BorderStyle.SOLID_MEDIUM);

  // HEADER ROW
  headerRange
    .setValues([["DATE", "ACTIVITIES", "ORGANIZATION", "COUNTDOWN"]])
    .setFontFamily("Times New Roman")
    .setFontWeight("bold")
    .setFontSize(10)
    .setHorizontalAlignment("center")
    .setBorder(true, true, true, true, true, true, "#274e13", SpreadsheetApp.BorderStyle.SOLID_MEDIUM);

  // Read columns B to E: Date (B), Activity (C), Org (D), Status (E)
  const lastRow = activitiesSheet.getLastRow();
  if (lastRow <= 1) return;
  const dataRange = activitiesSheet.getRange(2, 2, lastRow - 1, 4).getValues();

  const today = new Date();
  const ahead60 = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 60);

  let filtered = [];

  dataRange.forEach(row => {
    let date = row[0];
    let activity = row[1];
    let org = row[2];
    let status = row[3]; 

    if (!(date instanceof Date)) return;

    // remove completed activities
    if (status === true) return;

    // remove overdue activities
    if (date < today) return;

    if (date >= today && date <= ahead60) {
      let daysRemaining = Math.ceil((date - today) / (1000 * 60 * 60 * 24));

      filtered.push([
        date,
        (activity || "").toString().toUpperCase(),
        (org || "").toString().toUpperCase(),
        daysRemaining
      ]);
    }
  });

  // Sort ASC
  filtered.sort((a, b) => a[0] - b[0]);

  if (filtered.length > 0) {
    let writeData = filtered.map(row => [
      row[0],
      row[1],
      row[2],
      row[3] + " DAYS LEFT"
    ]);

    const outputRange = dashboard.getRange(startRow, 5, writeData.length, 4);

    outputRange
      .setValues(writeData)
      .setFontFamily("Times New Roman")
      .setFontSize(10)
      .setVerticalAlignment("middle")
      .setHorizontalAlignment("left")
      .setBorder(true, true, true, true, true, true, "#274e13", SpreadsheetApp.BorderStyle.SOLID);

    dashboard.setColumnWidth(5, 75);
    dashboard.setColumnWidth(6, 400);
    dashboard.setColumnWidth(7, 100);
    dashboard.setColumnWidth(8, 100);

    dashboard.getRange(startRow, 5, filtered.length, 1).setNumberFormat("dd-mmm-yyyy");

    for (let i = 0; i < filtered.length; i++) {
      let daysRemaining = filtered[i][3];
      let rowRange = dashboard.getRange(startRow + i, 5, 1, 4);

      if (daysRemaining < 10) rowRange.setBackground("#f4cccc");
      else if (daysRemaining <= 20) rowRange.setBackground("#f6b26b");
      else rowRange.setBackground("#b6d7a8");
    }

    const fullTableRange = dashboard.getRange(startRow, 5, filtered.length, 4);
    fullTableRange.setBorder(
      true, true, true, true, true, true,
      "#274e13",
      SpreadsheetApp.BorderStyle.SOLID_MEDIUM
    );
  }
}

function generateNext14DaysMiniTable() {
  const ss = getSpreadsheet_();
  const dashboard = ss.getSheetByName("CALENDAR DASHBOARD");
  const activitiesSheet = ss.getSheetByName("ACTIVITIES");
  const churchSheet = ss.getSheetByName("OTHER CHURCH PROGRAM");

  if (!dashboard || !activitiesSheet || !churchSheet) return;

  const titleRange = dashboard.getRange("A2:C2");
  const headerRange = dashboard.getRange("A3:C3");
  const startRow = 4;

  dashboard.getRange("A2:C200").clear().setBackground(null).setBorder(false, false, false, false, false, false);

  titleRange.merge();
  titleRange
    .setValue("NEXT 14 DAYS ACTIVITIES")
    .setFontFamily("Times New Roman")
    .setFontSize(11)
    .setFontWeight("bold")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle")
    .setBackground("#cfe2f3")
    .setBorder(true, true, true, true, true, true);

  headerRange
    .setValues([["DATE", "ITEM", "ORGANIZATION"]])
    .setFontFamily("Times New Roman")
    .setFontWeight("bold")
    .setFontSize(10)
    .setHorizontalAlignment("center")
    .setBorder(true, true, true, true, true, true);

  const today = new Date();
  const ahead14 = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 14);

  let miniList = [];

  // --- ACTIVITIES (Date, Activity, Org, Status starting at column 2)
  const actLastRow = activitiesSheet.getLastRow();
  if (actLastRow > 1) {
    const actData = activitiesSheet.getRange(2, 2, actLastRow - 1, 4).getValues();
    actData.forEach(row => {
      let date = row[0];
      let item = row[1];
      let org = row[2];
      let status = row[3]; 

      if (!(date instanceof Date)) return;

      if (status === true) return; // exclude completed
      if (date < today) return; // exclude overdue

      if (date >= today && date <= ahead14) {
        let finalOrg = (org || "").toString().toUpperCase();
        if (finalOrg !== "WARD") finalOrg = "WARD " + finalOrg;

        miniList.push([date, (item || "").toString().toUpperCase(), finalOrg, "ACTIVITY"]);
      }
    });
  }

  // --- OTHER CHURCH PROGRAM (Date, Program, Org starting at column 2)
  const churchLastRow = churchSheet.getLastRow();
  if (churchLastRow > 1) {
    const churchData = churchSheet.getRange(2, 2, churchLastRow - 1, 3).getValues();
    churchData.forEach(row => {
      let date = row[0];
      let item = row[1];
      let org = row[2];

      if (date instanceof Date && date >= today && date <= ahead14) {
        miniList.push([
          date,
          (item || "").toString().toUpperCase(),
          (org || "").toString().toUpperCase(),
          "CHURCH"
        ]);
      }
    });
  }

  miniList.sort((a, b) => a[0] - b[0]);

  if (miniList.length === 0) {
    const msgRange = dashboard.getRange("A4:C6");
    msgRange.merge();
    msgRange
      .setValue("NO ACTIVITIES AVAILABLE FOR THE NEXT 14 DAYS")
      .setFontFamily("Times New Roman")
      .setFontSize(12)
      .setFontWeight("bold")
      .setHorizontalAlignment("center")
      .setVerticalAlignment("middle")
      .setBorder(true, true, true, true, true, true);
    return;
  }

  let writeData = miniList.map(row => [row[0], row[1], row[2]]);

  const outputRange = dashboard.getRange(startRow, 1, writeData.length, 3);
  outputRange
    .setValues(writeData)
    .setFontFamily("Times New Roman")
    .setFontSize(10)
    .setVerticalAlignment("middle")
    .setHorizontalAlignment("left")
    .setBorder(true, true, true, true, true, true);

  dashboard.getRange(startRow, 1, writeData.length, 1).setNumberFormat("dd-mmm-yyyy");

  for (let i = 0; i < miniList.length; i++) {
    let source = miniList[i][3];
    let rowRange = dashboard.getRange(startRow + i, 1, 1, 3);

    if (source === "ACTIVITY") rowRange.setBackground("#64e851");
    else rowRange.setBackground("#6d9eeb");
  }

  const fullTable = dashboard.getRange(startRow, 1, writeData.length, 3);
  fullTable.setBorder(true, true, true, true, true, true, "#000000", SpreadsheetApp.BorderStyle.SOLID_MEDIUM);

  dashboard.setColumnWidth(1, 90);
  dashboard.setColumnWidth(2, 300);
  dashboard.setColumnWidth(3, 160);
}

function generateCompletionWidget() {
  const ss = getSpreadsheet_();
  const dash = ss.getSheetByName("CALENDAR DASHBOARD");
  const sheet = ss.getSheetByName("ACTIVITIES");

  if (!sheet || !dash) {
    console.error("Missing sheet: ACTIVITIES or CALENDAR DASHBOARD");
    return;
  }

  // Read columns B to H (Date (B), Activity (C), Org (D), Status (E), EmailStatus (F), ForWhom (G), ReportSubmitted (H))
  const lastRow = sheet.getLastRow();
  if (lastRow < 3) return;

  const data = sheet.getRange(2, 2, lastRow - 1, 7).getValues();

  let total = 0;
  let completed = 0;
  let pending = 0;
  let notDone = 0;
  let reportsSubmitted = 0;
  let overdueReports = 0;

  let dueActivities = 0;   

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  data.forEach(row => {
    const date = row[0];
    const activityName = row[1];
    const status = row[3];
    const reportStatusRaw = row[6];

    if (!activityName) return; 

    total++;

    let isDue = false;

    if (date instanceof Date) {
      const activityDate = new Date(date);
      activityDate.setHours(0, 0, 0, 0);

      isDue = (activityDate <= today);
    }

    if (isDue) dueActivities++;

    if (status === true) {
      completed++;

      const reportStatus = (reportStatusRaw || "").toString().trim().toUpperCase();

      if (reportStatus === "YES") reportsSubmitted++;
      else if (reportStatus === "NO") overdueReports++;

      return; 
    }

    if (date instanceof Date) {
      let activityDate = new Date(date);
      activityDate.setHours(0, 0, 0, 0);

      if (activityDate < today) notDone++;
      else pending++;
    }
  });

  const rate = (dueActivities > 0) ? (completed / dueActivities) * 100 : 0;

  // Write to dashboard
  dash.getRange("J2").setValue("ACTIVITY COMPLETION SUMMARY");
  dash.getRange("J3").setValue("Total Activities");
  dash.getRange("J4").setValue("Completed");
  dash.getRange("J5").setValue("Pending");
  dash.getRange("J6").setValue("Not Done");
  dash.getRange("J7").setValue("Completion Rate");
  dash.getRange("J8").setValue("Reports Submitted");
  dash.getRange("J9").setValue("Overdue Reports");

  dash.getRange("K3").setValue(total);
  dash.getRange("K4").setValue(completed);
  dash.getRange("K5").setValue(pending);
  dash.getRange("K6").setValue(notDone);
  dash.getRange("K7").setValue(rate.toFixed(1) + "%");
  dash.getRange("K8").setValue(reportsSubmitted);
  dash.getRange("K9").setValue(overdueReports);
}

function parseListField(text) {
  if (!text) return [];
  return text.toString()
    .split(";")
    .map(s => s.trim())
    .filter(s => s.length);
}

function normalizeOrgName(s) {
  if (!s) return "";
  return s.toString().trim().toUpperCase();
}

function formatDateShort(d) {
  if (!(d instanceof Date)) return "";   
  return Utilities.formatDate(
    d,
    SpreadsheetApp.getActive().getSpreadsheetTimeZone(),
    "dd-MMM-yyyy"
  );
}

function getActivitiesFromSheet() {
  const ss = getSpreadsheet_();
  const sh = ss.getSheetByName("ACTIVITIES");
  const last = sh.getLastRow();
  if (last < 2) return [];
  // Columns starting at column 2 (B): Date, Activity, Organisation, Status
  const rows = sh.getRange(2, 2, last - 1, 4).getValues();
  return rows.map(r => ({
    date: r[0] instanceof Date ? r[0] : null,
    activity: (r[1] || "").toString(),
    org: normalizeOrgName(r[2]),
    status: r[3] === true
  }));
}

function getOtherChurchPrograms() {
  const ss = getSpreadsheet_();
  const sh = ss.getSheetByName("OTHER CHURCH PROGRAM");
  const last = sh.getLastRow();
  if (last < 2) return [];
  // Columns starting at column 2 (B): Date, Program, Organisation
  const rows = sh.getRange(2, 2, last - 1, 3).getValues();
  return rows.map(r => ({
    date: r[0] instanceof Date ? r[0] : null,
    activity: (r[1] || "").toString(),
    org: normalizeOrgName(r[2]),
    status: false  
  }));
}

function getUpcomingActivities(days) {
  const today = new Date();
  const end = new Date(); end.setDate(today.getDate() + days);
  const acts = getActivitiesFromSheet().filter(a => a.date && a.date >= today && a.date <= end && a.status !== true);
  const ch = getOtherChurchPrograms().filter(a => a.date && a.date >= today && a.date <= end);
  return acts.concat(ch);
}

function getContacts() {
  const ss = getSpreadsheet_();
  const sh = ss.getSheetByName("CONTACTS");
  const last = sh.getLastRow();
  if (last < 2) return [];

  // Read columns B to G (columns 2 to 7): Name, Calling, Org, Upcoming, Report, Email
  const rows = sh.getRange(2, 2, last - 1, 6).getValues();

  return rows
    .map(r => ({
      name: (r[0] || "").toString(),
      calling: (r[1] || "").toString(),
      organisation: normalizeOrgName(r[2]),
      upcoming: parseListField(r[3]).map(s => s.toUpperCase()),
      report: parseListField(r[4]).map(s => s.toUpperCase()),
      email: (r[5] || "").trim()
    }))
    .filter(c =>
      c.name !== "" &&
      c.email !== "" &&
      c.upcoming !== undefined &&
      c.report !== undefined
    );
}

function filterActivitiesForContact(contact, days) {
  const requested = contact.upcoming.map(s => s.toUpperCase());
  const allActs = getUpcomingActivities(days);

  if (requested.some(r => r === "ALL ACTIVITIES")) {
    return allActs;
  }

  const allowedOrgs = requested.map(s => s.trim().toUpperCase());
  return allActs.filter(a => {
    if (!a.org) return false;
    return allowedOrgs.some(allowed => {
      if (allowed === "WARD") return a.org === "WARD";
      return a.org === allowed;
    });
  });
}

function buildHtmlTableForActivities(list) {
  if (!list || list.length === 0) return "<p>No items.</p>";
  let html = '<table style="border-collapse:collapse; width:100%; font-family: Arial, sans-serif;">';
  html += '<thead><tr style="background:#cfe2f3;"><th style="border:1px solid #ddd;padding:6px;text-align:left;">Date</th><th style="border:1px solid #ddd;padding:6px;text-align:left;">Activity</th><th style="border:1px solid #ddd;padding:6px;text-align:left;">Organization</th></tr></thead><tbody>';
  list.forEach(it => {
    const date = it.date ? formatDateShort(it.date) : "";
    html += `<tr><td style="border:1px solid #ddd;padding:6px;">${date}</td><td style="border:1px solid #ddd;padding:6px;">${escapeHtml(it.activity)}</td><td style="border:1px solid #ddd;padding:6px;">${escapeHtml(it.org)}</td></tr>`;
  });
  html += '</tbody></table>';
  return html;
}

function escapeHtml(text) {
  if (text == null) return "";
  return text.toString()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function sendHtmlEmail(toEmail, subject, htmlBody) {
  MailApp.sendEmail({
    to: toEmail,
    subject: subject,
    htmlBody: htmlBody
  });
}

function sendWeeklyUpcomingEmails() {
  const ss = getSpreadsheet_();
  const contacts = getContacts();
  if (!contacts.length) return;

  contacts.forEach(contact => {
    try {
      const next14 = filterActivitiesForContact(contact, 14);
      const next60 = filterActivitiesForContact(contact, 60);

      if (next14.length === 0 && next60.length === 0) return;

      let html = `<div style="font-family: Arial, sans-serif; color:#1a1a1a;">
        <h2 style="color:#274e13;">Upcoming Activities — ${contact.name}</h2>
        <p>Dear ${escapeHtml(contact.name)},</p>
        <p>Below are the upcoming activities relevant to your role.</p>`;

      if (next14.length) {
        html += `<h3 style="color:#274e13;">Next 14 days</h3>`;
        html += buildHtmlTableForActivities(next14);
        html += `<br/>`;
      } else {
        html += `<p><strong>No upcoming ward event for the next 14 days.</strong></p>`;
      }

      if (next60.length) {
        html += `<h3 style="color:#274e13;">Next 60 days</h3>`;
        html += buildHtmlTableForActivities(next60);
        html += `<br/>`;
      } else {
        html += `<p><em>No items in the next 60 days.</em></p>`;
      }

      html += `<p style="color:#666;">If an item requires special attention, please coordinate with the responsible leader.</p>`;
      html += `<p style="font-size:12px;color:#888;">Sent by Obantoko Ward Calendar System</p>`;
      html += `</div>`;

      const subject = `Upcoming Activities — ${contact.name} (Next 14 & 60 days)`;

      let sendStatus = "SUCCESS";
      const timestamp = Utilities.formatDate(
        new Date(),
        ss.getSpreadsheetTimeZone(),
        "dd-MMM-yyyy hh:mm a"
      );

      try {
        sendHtmlEmail(contact.email, subject, html);
      } catch (err) {
        sendStatus = "FAILED";
        console.error("Error sending weekly email to", contact.email, err);
      }

      logWeeklyUpcomingEmail(contact.name, sendStatus, timestamp);

    } catch (err) {
      console.error("Error processing contact:", contact.name, err);
    }
  });
}

function handleActivityCompletion(activityRowObj) {
  const ss = getSpreadsheet_();
  const contacts = getContacts();

  const org = activityRowObj.org;
  const activityName = activityRowObj.activity;
  const dateStr = activityRowObj.date ? formatDateShort(activityRowObj.date) : "";

  contacts.forEach(contact => {
    contact.report.forEach(tokenRaw => {
      const token = tokenRaw.toUpperCase();
      const isFollowUp = token.includes("(FU)");
      const plainToken = token.replace(/\(FU\)/gi, "").trim();

      if (plainToken !== "ALL ACTIVITIES" && plainToken !== org) return;

      let html = `<div style="font-family: Arial, sans-serif;">`;
      html += `<h3 style="color:#980000;">ACTIVITY COMPLETED — ${escapeHtml(activityName)}</h3>`;
      html += `<p>Date: ${escapeHtml(dateStr)}</p>`;
      html += `<p>Organization: ${escapeHtml(org)}</p>`;
      html += `<p>Dear ${escapeHtml(contact.name)},</p>`;

      if (isFollowUp) {
        html += `<p>This is a <strong>follow-up notice</strong> to inform you that this activity has been successfully completed. We kindly request that you follow up with the responsible leader(s) to ensure that all related reports and documentation are submitted promptly. Your cooperation in keeping records accurate and up-to-date is greatly appreciated.</p>`;
      } else {
        html += `<p>This activity has been successfully completed. We kindly ask that you <strong>submit your report</strong> as soon as possible. Timely submission helps maintain accurate records and allows the Ward leadership to review progress and plan future activities efficiently. Thank you for your prompt attention to this matter.</p>`;
      }

      html += `<hr><p style="font-size:12px;color:#666;">If received in error, contact the Ward Clerk.</p></div>`;

      const subj = isFollowUp
        ? `FOLLOW-UP: ${activityName} (${dateStr})`
        : `REPORT REQUEST: ${activityName} (${dateStr})`;

      let sendStatus = "SUCCESS";
      try {
        sendHtmlEmail(contact.email, subj, html);
      } catch (err) {
        sendStatus = "FAILED";
        console.error("Email failed for", contact.email, err);
      }

      logToReportLog(
        isFollowUp ? "Follow-Up Notice" : "Report Request",
        [{
          name: contact.name,
          status: sendStatus
        }]
      );
    });
  });
}

function onStatusEdit(e) {
  const sh = e.range.getSheet();
  const row = e.range.getRow();
  const col = e.range.getColumn();
  const sheetName = sh.getName();

  if (sheetName !== "ACTIVITIES") return;
  if (col !== 5) return; // STATUS is Column E (5)
  if (row < 3) return; // Ignore headers

  const value = e.range.getValue();
  if (value !== true) return;

  // Read Column B to E (2 to 5) to get Date, Activity, Org, Status
  const rowVals = sh.getRange(row, 2, 1, 4).getValues()[0];
  const date = rowVals[0];
  const activity = rowVals[1];
  const org = rowVals[2];

  if (!(date instanceof Date)) return;

  handleActivityCompletion({
    date: date,
    activity: activity,
    org: normalizeOrgName(org),
    rowNumber: row
  });
}

function onEditInstallable(e) {
  onStatusEdit(e);
}

function createFridayTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => {
    if (t.getHandlerFunction() === "sendWeeklyUpcomingEmails") ScriptApp.deleteTrigger(t);
  });

  ScriptApp.newTrigger("sendWeeklyUpcomingEmails")
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.FRIDAY)
    .atHour(9)
    .create();

  const hasOnEditInstallable = triggers.some(t => t.getHandlerFunction() === "onEditInstallable");
  if (!hasOnEditInstallable) {
    ScriptApp.newTrigger("onEditInstallable").forSpreadsheet(SpreadsheetApp.getActive()).onEdit().create();
  }
}

function testSendWeeklyEmails() {
  sendWeeklyUpcomingEmails();
}

function testReportEmailForRow() {
  const rowNumber = 7;   
  const ss = getSpreadsheet_();
  const sh = ss.getSheetByName("ACTIVITIES");

  if (!sh) throw new Error("ERROR: Sheet 'ACTIVITIES' not found.");

  const lastRow = sh.getLastRow();
  if (rowNumber > lastRow) throw new Error("ERROR: Row number is beyond available data.");

  // Read starting at Column 2 (B) for 4 columns: Date, Activity, Org, Status
  const rowVals = sh.getRange(rowNumber, 2, 1, 4).getValues()[0];
  const date = rowVals[0];
  const activity = rowVals[1];
  const org = rowVals[2];
  const status = rowVals[3];

  if (!(date instanceof Date)) throw new Error("ERROR: Row " + rowNumber + " does not contain a valid date.");
  if (!activity) throw new Error("ERROR: Row " + rowNumber + " has no activity name.");
  if (!org) throw new Error("ERROR: Row " + rowNumber + " has no organisation.");
  if (status !== true) throw new Error("ERROR: STATUS is not checked (TRUE).");

  handleActivityCompletion({
    date: date,
    activity: activity.toString(),
    org: normalizeOrgName(org),
    rowNumber: rowNumber
  });
}

function sendPendingReportEmails() {
  const ss = getSpreadsheet_();
  const sh = ss.getSheetByName("ACTIVITIES");
  if (!sh) return;

  const last = sh.getLastRow();
  if (last < 3) return;

  // Read starting at Column 2 (B) for 5 columns: Date (B), Activity (C), Org (D), Status (E), EmailSent (F)
  const data = sh.getRange(2, 2, last - 1, 5).getValues();  

  for (let i = 0; i < data.length; i++) {
    const rowNum = i + 2;
    const date = data[i][0];
    const activity = data[i][1];
    const org = normalizeOrgName(data[i][2]);
    const status = data[i][3];
    const emailSent = data[i][4];

    if (!(date instanceof Date)) continue;
    if (!activity || !org) continue;

    if (status === true && emailSent !== true) {
      handleActivityCompletion({
        date: date,
        activity: activity,
        org: org,
        rowNumber: rowNum
      });

      // Update Column F (6)
      sh.getRange(rowNum, 6).setValue(true);
    }
  }
}

function formatWhatsappActivityUniversal(activityObj, index) {
  const dateStr = activityObj.date;
  const rawName = activityObj.activity || "";
  const org = (activityObj.org || "").toUpperCase();
  const forWhom = (activityObj.forWhom || "").toString();

  const wardActivityName = rawName.toUpperCase().startsWith("WARD") ? rawName : "WARD " + rawName;

  let audience = "all members"; 

  if (/YOUTH|YM|YW/i.test(forWhom) || /YOUTH/i.test(org)) audience = "all youths";
  if (/RELIEF/i.test(forWhom) || /RELIEF/i.test(org)) audience = "all Relief Society sisters";
  if (/ELDER/i.test(forWhom) || /ELDER/i.test(org)) audience = "all Elders Quorum members";
  if (/PRIMARY/i.test(forWhom) || /PRIMARY/i.test(org)) audience = "all Primary children and leaders";
  if (/YOUNG WOMEN|YW/i.test(forWhom)) audience = "all Young Women";
  if (/YOUNG MEN|YM/i.test(forWhom)) audience = "all Young Men";

  return (
    `${index}️⃣ *${wardActivityName}*\n` +
    `${capitalize(audience)} are invited to the *${wardActivityName}* coming up on *${dateStr}* at *The Obantoko Ward*.\n` +
    `Time: __________________\n`
  );
}

function capitalize(txt) {
  return txt.charAt(0).toUpperCase() + txt.slice(1);
}

function formatActivityWhatsapp(item, timezone) {
  const today = new Date();
  const sunday = new Date(today);
  sunday.setDate(today.getDate() + ((7 - today.getDay()) % 7)); 
  sunday.setHours(0,0,0,0);

  const activityDate = new Date(item.dateObj);
  activityDate.setHours(0,0,0,0);

  const diffDays = Math.round((activityDate - sunday) / (1000*60*60*24));

  let phrasing = "";

  if (diffDays >= 0 && diffDays <= 6) {
    const weekday = Utilities.formatDate(activityDate, timezone, "EEEE");
    phrasing = `coming up this ${weekday.toLowerCase()}, *${item.date}*`;
  } else if (diffDays >= 7 && diffDays <= 13) {
    const weekday = Utilities.formatDate(activityDate, timezone, "EEEE");
    phrasing = `coming up next week ${weekday.toLowerCase()}, *${item.date}*`;
  } else {
    const weekday = Utilities.formatDate(activityDate, timezone, "EEEE");
    phrasing = `coming up on ${weekday.toLowerCase()}, *${item.date}*`;
  }

  return (
    `• All ${item.forWhom.toLowerCase()} are invited to the *Ward ${item.activity}* ` +
    `${phrasing} at *The Obantoko Ward*.\n` +
    `Time: __________________\n`
  );
}

function normalizeGroupName(raw) {
  if (!raw) return "all members";
  const txt = raw.toString().trim().toLowerCase();

  const map = {
    "all members": "all members",
    "members": "all members",
    "all youths": "all youths",
    "youths": "all youths",
    "youth": "all youths",
    "all primary children": "all primary children",
    "primary": "all primary children",
    "primary children": "all primary children",
    "relief society": "relief society sisters",
    "relief society sisters": "relief society sisters",
    "elders quorum": "elders quorum brethren",
    "elders": "elders quorum brethren",
    "friends": "all members and friends",
    "all members and friends": "all members and friends"
  };

  return map[txt] || raw.toString().trim().toLowerCase();
}

function describeDate(dateObj, timezone) {
  const today = new Date();
  const sunday = new Date(today);
  sunday.setDate(today.getDate() + ((7 - today.getDay()) % 7)); 
  sunday.setHours(0,0,0,0);

  const d = new Date(dateObj);
  d.setHours(0,0,0,0);

  const diffDays = Math.round((d - sunday) / (1000*60*60*24));
  const weekday = Utilities.formatDate(d, timezone, "EEEE").toLowerCase();
  const cleanDate = Utilities.formatDate(d, timezone, "dd-MMM-yyyy");

  if (diffDays >= 0 && diffDays <= 6) {
    return `coming up this ${weekday}, *${cleanDate}*`;
  }
  if (diffDays >= 7 && diffDays <= 13) {
    return `coming up next week ${weekday}, *${cleanDate}*`;
  }
  return `coming up on ${weekday}, *${cleanDate}*`;
}

function formatActivityBlock(item, timezone) {
  const dateObj = item.dateObj;
  const rawActivity = (item.activity || "").toString().trim();
  const rawAudience = (item.forWhom || "").toString().trim();
  const timeText = item.time ? item.time.toString().trim() : "";

  let activityTitle = rawActivity.toUpperCase();
  if (!activityTitle.startsWith("WARD ")) {
    activityTitle = "WARD " + activityTitle;
  }

  let audience = rawAudience.replace(/^ALL\s+/i, "").trim().toLowerCase();
  if (!audience) audience = "members";

  const today = new Date();
  today.setHours(0,0,0,0);

  const eventDate = new Date(dateObj);
  eventDate.setHours(0,0,0,0);

  const diffDays = Math.round((eventDate - today) / (1000*60*60*24));
  const weekday = eventDate.toLocaleDateString("en-GB", { weekday: "long" });
  const formattedDate = Utilities.formatDate(eventDate, timezone, "dd-MMM-yyyy");

  let datePhrase;
  if (diffDays >= 0 && diffDays <= 6) {
    datePhrase = `coming up this ${weekday.toLowerCase()}, *${formattedDate}*`;
  } else if (diffDays >= 7 && diffDays <= 13) {
    datePhrase = `coming up next week ${weekday.toLowerCase()}, *${formattedDate}*`;
  } else {
    datePhrase = `coming up on ${weekday.toLowerCase()}, *${formattedDate}*`;
  }

  const timeLine = timeText ? `Time: ${timeText}` : `Time: __________________`;

  return (
`*${activityTitle}*
• All ${audience} are invited to the *${activityTitle}* ${datePhrase} at the *Obantoko Ward*.
${timeLine}\n\n`
  );
}

function sendBishopricWhatsappNotification() {
  const ss = getSpreadsheet_();
  const actSh = ss.getSheetByName("ACTIVITIES");
  const conSh = ss.getSheetByName("CONTACTS");
  const timezone = ss.getSpreadsheetTimeZone();

  if (!actSh || !conSh) {
    throw new Error("Missing ACTIVITIES or CONTACTS sheet.");
  }

  // Read starting at Column 2 (B) for 6 columns: Name (B), Calling (C), Org (D), Upcoming (E), Report (F), Email (G)
  const contacts = conSh
    .getRange(2, 2, conSh.getLastRow() - 1, 6)
    .getValues()
    .map(r => ({
      name: r[0],
      org: r[2],
      email: r[5]
    }))
    .filter(c => (c.org || "").toString().toUpperCase() === "BISHOPRIC");

  if (contacts.length === 0) return;

  // Read starting at Column 2 (B) for 8 columns: Date (B), Activity (C), Org (D), Status (E), EmailSent (F), ForWhom (G), ReportSubmitted (H), Time (I)
  const rows = actSh.getRange(3, 2, actSh.getLastRow() - 2, 8).getValues();

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const DAYS_AHEAD = 50;
  const upcoming = [];

  rows.forEach(r => {
    const date = r[0];
    const activity = r[1];
    const forWhom = r[5];
    const time = r[7];

    if (!(date instanceof Date) || !activity) return;

    const eventDate = new Date(date);
    eventDate.setHours(0, 0, 0, 0);

    const diffDays = Math.floor((eventDate - today) / (1000 * 60 * 60 * 24));

    if (diffDays >= 0 && diffDays <= DAYS_AHEAD) {
      upcoming.push({
        dateObj: eventDate,
        activity: activity.toString().trim(),
        forWhom: (forWhom || "").toString().trim(),
        time: (time || "").toString().trim()
      });
    }
  });

  let body = `WHATSAPP NOTIFICATION\n\n*WARD ACTIVITIES*\n\n`;

  if (upcoming.length === 0) {
    body += `No upcoming ward activities in the next ${DAYS_AHEAD} days.\n\n`;
  } else {
    upcoming.forEach(item => {
      body += buildWhatsappBlock(item, timezone);
    });
  }

  body += `Please verify, update, and post this (with the Stake announcement) in the Ward Members WhatsApp group immediately after the Sacrament meeting tomorrow.`;

  let overallStatus = "SUCCESS";

  contacts.forEach(c => {
    try {
      sendHtmlEmail(
        c.email,
        "WhatsApp Weekly Ward Activities — Bishopric",
        `<pre style="font-family:Arial; font-size:14px; white-space:pre-wrap;">${body}</pre>`
      );
    } catch (err) {
      overallStatus = "FAILED";
      console.error("WhatsApp notification failed for:", c.email, err);
    }
  });

  logToReportLog(
    "Bishopric WhatsApp Notification",
    [{
      name: "Bishopric",
      status: overallStatus
    }]
  );
}

function buildWhatsappBlock(item, timezone) {
  let title = item.activity.toUpperCase();
  title = title.replace(/^WARD\s+/i, "");
  title = "WARD " + title;

  let audience = item.forWhom.replace(/^ALL\s+/i, "").trim().toLowerCase();
  if (!audience) audience = "members";

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const eventDate = item.dateObj;
  const diff = Math.floor((eventDate - today) / (1000 * 60 * 60 * 24));

  const weekday = eventDate.toLocaleDateString("en-GB", { weekday: "long" });
  const dateText = Utilities.formatDate(eventDate, timezone, "dd-MMM-yyyy");

  let datePhrase;
  if (diff >= 0 && diff <= 6) {
    datePhrase = `coming up this ${weekday}, *${dateText}*`;
  } else if (diff >= 7 && diff <= 13) {
    datePhrase = `coming up next week ${weekday}, *${dateText}*`;
  } else {
    datePhrase = `coming up on ${weekday}, *${dateText}*`;
  }

  const timeText = item.time ? item.time : "TBD";

  return (
`*${title}*
• All ${audience} are invited to the *${title}* ${datePhrase} at the *Obantoko Ward*.
Time: ${timeText}\n\n`
  );
}

function logWeeklyUpcomingEmail(contactName, status, timestamp) {
  const ss = getSpreadsheet_();
  const sh = ss.getSheetByName("REPORT LOG");
  if (!sh) return;

  const today = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), "dd-MMM-yyyy");
  let lastRow = sh.getLastRow();

  let rowToUse = 0;
  if (lastRow >= 1) {
    const lastDate = sh.getRange(lastRow, 1).getValue();
    try {
      const lastDateStr = Utilities.formatDate(new Date(lastDate), ss.getSpreadsheetTimeZone(), "dd-MMM-yyyy");
      if (lastDateStr === today) {
        rowToUse = lastRow;   
      }
    } catch(e) {}
  }

  if (rowToUse === 0) {
    rowToUse = lastRow + 1;
    sh.getRange(rowToUse, 1).setValue(today);
  }

  let col = 2;
  while (sh.getRange(rowToUse, col).getValue() !== "") {
    col++;
  }

  const entry =
    contactName + "\n" +
    "Status: " + status + "\n" +
    "Timestamp: " + timestamp;

  sh.getRange(rowToUse, col).setValue(entry);
}

function sendReportFollowUpReminders() {
  const ss = getSpreadsheet_();
  const actSh = ss.getSheetByName("ACTIVITIES");
  if (!actSh) return;

  const lastRow = actSh.getLastRow();
  if (lastRow < 3) return;

  // Read B to J (columns 2 to 10): Date (B), Activity (C), Org (D), Status (E), EmailSent (F), ForWhom (G), ReportSubmitted (H), Time (I), LastReminder (J)
  const data = actSh.getRange(3, 2, lastRow - 2, 9).getValues();
  const now = new Date();
  const ms48hrs = 48 * 60 * 60 * 1000;
  const ms5days = 5 * 24 * 60 * 60 * 1000;
  const timezone = ss.getSpreadsheetTimeZone();

  data.forEach((row, i) => {
    const rowNum = i + 3; 

    const date = row[0];
    const activityName = row[1];
    const org = row[2];
    const status = row[3];        
    const reportStatus = (row[6] || "").toString().trim().toUpperCase();
    const lastReminder = row[8];  // Column J

    if (!activityName || !(date instanceof Date)) return;
    if (reportStatus === "YES" || reportStatus === "N/A") return;
    if (status !== true) return;

    let shouldSend = false;

    if (!lastReminder) {
      if (now - date >= ms48hrs) {
        shouldSend = true;
      }
    } else {
      const last = new Date(lastReminder);
      if (now - last >= ms5days) {
        shouldSend = true;
      }
    }

    if (!shouldSend) return;

    const contacts = getContacts(); 
    const recipients = contacts.filter(c =>
      c.report.map(r => r.toUpperCase()).includes(org.toUpperCase())
    );

    const loggedRecipients = [];
    recipients.forEach(contact => {
      const subject = `Follow-Up Reminder: ${activityName}`;
      const html = `
        <div style="font-family:Arial;font-size:14px;">
          <p>Dear ${contact.name},</p>
          <p>The following activity was completed but the report has not been submitted:</p>
          <h3>${activityName}</h3>
          <p>Date: <b>${Utilities.formatDate(date, timezone, "dd-MMM-yyyy")}</b></p>
          <p>Please submit your report as soon as possible.</p>
          <hr>
          <p style="font-size:12px;color:#777;">Obantoko Ward Calendar System</p>
        </div>
      `;

      let sendStatus = "SUCCESS";

      try {
        sendHtmlEmail(contact.email, subject, html);
      } catch (err) {
        sendStatus = "FAILED";
        console.error("Error sending follow-up to", contact.email, err);
      }

      loggedRecipients.push({ name: contact.name, status: sendStatus });
    });

    if (loggedRecipients.length > 0) {
      logToReportLog(`Reminder: ${activityName}`, loggedRecipients);
    }

    actSh.getRange(rowNum, 10).setValue(new Date());
  });
}

function logToReportLog(type, recipients) {
  if (!Array.isArray(recipients) || recipients.length === 0) return;

  const ss = getSpreadsheet_();
  const logSh = ss.getSheetByName("REPORT LOG");
  if (!logSh) return;
  const timezone = ss.getSpreadsheetTimeZone();

  const timestamp = Utilities.formatDate(
    new Date(),
    timezone,
    "dd-MMM-yyyy hh:mm a"
  );

  const row = [];
  row[0] = timestamp;   
  row[1] = type;        

  let colIndex = 2;     

  recipients.forEach(rec => {
    row[colIndex] = `${rec.name}\nStatus: ${rec.status}\nTimestamp: ${timestamp}`;
    colIndex++;
  });

  logSh.appendRow(row);
  const rowNumber = logSh.getLastRow();
  formatReportLogRow(logSh, rowNumber, colIndex - 1);
}

function formatReportLogRow(sheet, row, lastCol) {
  const headerColor = "#1c4587";
  const successColor = "#d9ead3";
  const failColor = "#f4cccc";

  sheet.getRange(row, 1)
    .setBackground("#f0f0f0")
    .setFontWeight("bold");

  sheet.getRange(row, 2)
    .setBackground(headerColor)
    .setFontColor("white")
    .setFontWeight("bold");

  for (let col = 3; col <= lastCol + 1; col++) {
    const cell = sheet.getRange(row, col);
    const text = cell.getValue().toString().toUpperCase();

    cell
      .setBackground(text.includes("FAILED") ? failColor : successColor)
      .setWrap(true)
      .setVerticalAlignment("top");
  }
}

function parseReportLogs_(data) {
  const out = [];
  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    if (row.every(v => String(v || "").trim() === "")) continue;
    
    const valA = String(row[0] || "").trim();
    const valB = String(row[1] || "").trim();
    if (!valA) continue;
    
    let type = "System Notification";
    let startCol = 1;
    
    if (valB.indexOf("\n") >= 0 || valB.toUpperCase().indexOf("STATUS:") >= 0) {
      type = "Weekly Upcoming Email";
      startCol = 1;
    } else {
      type = valB || "System Notification";
      startCol = 2;
    }
    
    for (let c = startCol; c < row.length; c++) {
      const cellVal = String(row[c] || "").trim();
      if (!cellVal) continue;
      
      const lines = cellVal.split("\n");
      const recipient = lines[0].trim();
      let status = "SUCCESS";
      let timestamp = valA;
      
      lines.forEach(line => {
        const uLine = line.toUpperCase();
        if (uLine.indexOf("STATUS:") >= 0) {
          if (uLine.indexOf("FAILED") >= 0) status = "FAILED";
        }
        if (uLine.indexOf("TIMESTAMP:") >= 0) {
          timestamp = line.replace(/timestamp:/i, "").trim();
        }
      });
      
      out.push({
        log_id: "log_" + r + "_" + c + "_" + valA.replace(/[^a-zA-Z0-9]/g, ""),
        date: valA.split(" ")[0] || valA,
        type: type,
        recipient: recipient,
        status: status,
        timestamp: timestamp
      });
    }
  }
  return out.reverse();
}

