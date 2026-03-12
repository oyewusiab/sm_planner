# Google Apps Script (SM_PLANNER)

Copy everything in the code block below into your Apps Script project (e.g., `Code.gs`).

```javascript
/**
 * Sacrament Planner - Google Sheets backend
 * Web App API for CRUD + full DB export/import
 *
 * Configure SPREADSHEET_ID and API_KEY before deploying.
 */
const CONFIG = {
  SPREADSHEET_ID: "1RGG0HbR2eYx0zENFftSuZpZhGyd0nwu2IE2ihzlL57g",
  API_KEY: "CHANGE_ME", // required in ?key= or JSON body {key: "..."}
};

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
  ],
  MEMBERS: [
    "member_id",
    "name",
    "gender",
    "age",
    "phone",
    "email",
    "organisation",
    "status",
    "notes",
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
};

const PRIMARY_KEYS = {
  PLANNERS: "planner_id",
  USERS: "user_id",
  MEMBERS: "member_id",
  ASSIGNMENTS: "assignment_id",
  CHECKLISTS: "checklist_id",
  NOTIFICATIONS: "notification_id",
  TODOS: "todo_id",
  SETTINGS_REQUESTS: "request_id",
  REMINDERS: "reminder_id",
  UNIT_SETTINGS: "Key",
};

// Columns that store JSON strings
const JSON_FIELDS = {
  PLANNERS: ["weeks"],
  NOTIFICATIONS: ["meta"],
  SETTINGS_REQUESTS: ["patch"],
};

const NUMBER_FIELDS = {
  PLANNERS: ["month", "year"],
  MEMBERS: ["age"],
  ASSIGNMENTS: ["minutes"],
};

const BOOLEAN_FIELDS = {
  CHECKLISTS: ["status"],
  NOTIFICATIONS: ["read"],
  USERS: ["must_reset_password"],
};

const UNIT_JSON_KEYS = ["prefs"];

function doGet(e) {
  return withLock(() => route_(e, "GET"));
}

function doPost(e) {
  return withLock(() => route_(e, "POST"));
}

function doOptions() {
  return jsonResponse_({ ok: true, ts: new Date().toISOString() });
}

function setup() {
  ensureSchema_();
  return "OK";
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("SM Planner")
    .addItem("Initialize / Repair Sheets", "setup")
    .addToUi();
}

function route_(e, method) {
  const payload = parsePayload_(e);
  const key = payload.key || (e && e.parameter && e.parameter.key) || "";
  if (!authorize_(key)) {
    return jsonError_("unauthorized", 401);
  }

  const action = (payload.action || (e && e.parameter && e.parameter.action) || "").toString();
  if (!action) return jsonError_("missing_action", 400);

  try {
    switch (action) {
      case "ping":
        return jsonResponse_({ ok: true, data: { message: "pong" }, ts: new Date().toISOString() });
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
  if (table === "UNIT_SETTINGS") {
    upsertUnitSettings_(row);
    return jsonResponse_({ ok: true, data: { updated: true }, ts: new Date().toISOString() });
  }
  const idCol = PRIMARY_KEYS[table];
  const idVal = String(row[idCol] || "");
  if (!idVal) return jsonError_("missing_primary_key", 400);
  const updated = upsertRow_(table, row, idCol);
  return jsonResponse_({ ok: true, data: updated, ts: new Date().toISOString() });
}

function handleBulkUpsert_(payload) {
  ensureSchema_();
  const table = normalizeTable_(payload.table);
  if (!table) return jsonError_("unknown_table", 400);
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  if (rows.length === 0) return jsonError_("missing_rows", 400);
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
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || typeof row !== "object") continue;
    if (!row[idCol]) continue;
    out.push(upsertRow_(table, row, idCol));
  }
  return jsonResponse_({ ok: true, data: { updated: out.length }, ts: new Date().toISOString() });
}

function handleDelete_(payload) {
  ensureSchema_();
  const table = normalizeTable_(payload.table);
  if (!table) return jsonError_("unknown_table", 400);
  const idCol = PRIMARY_KEYS[table];
  const idVal = (payload.id || payload.value || "").toString();
  if (!idVal) return jsonError_("missing_id", 400);
  if (table === "UNIT_SETTINGS") {
    deleteUnitSetting_(idVal);
    return jsonResponse_({ ok: true, data: { deleted: true }, ts: new Date().toISOString() });
  }
  const deleted = deleteRowById_(table, idCol, idVal);
  if (!deleted) return jsonError_("not_found", 404);
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
  };
  return jsonResponse_({ ok: true, data: db, ts: new Date().toISOString() });
}

function handleImport_(payload) {
  ensureSchema_();
  const db = payload.db;
  const mode = (payload.mode || "replace").toString(); // replace | merge
  if (!db || typeof db !== "object") return jsonError_("missing_db", 400);

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
  ];

  if (mode === "replace") {
    for (const t of tables) overwriteTable_(t, Array.isArray(db[t]) ? db[t] : []);
  } else {
    for (const t of tables) {
      const rows = Array.isArray(db[t]) ? db[t] : [];
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!row || typeof row !== "object") continue;
        const idCol = PRIMARY_KEYS[t];
        if (!row[idCol]) continue;
        upsertRow_(t, row, idCol);
      }
    }
  }

  if (db.UNIT_SETTINGS) {
    if (typeof db.UNIT_SETTINGS === "object") upsertUnitSettings_(db.UNIT_SETTINGS);
  }

  return jsonResponse_({ ok: true, data: { imported: true, mode: mode }, ts: new Date().toISOString() });
}

function ensureSchema_() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  Object.keys(SCHEMA).forEach((name) => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    const headers = SCHEMA[name];
    const firstRow = sh.getRange(1, 1, 1, headers.length).getValues()[0];
    let needsWrite = false;
    for (let i = 0; i < headers.length; i++) {
      if (String(firstRow[i] || "") !== headers[i]) {
        needsWrite = true;
        break;
      }
    }
    if (needsWrite) {
      sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    }
    if (sh.getFrozenRows() < 1) sh.setFrozenRows(1);
  });
}

function getAllRows_(table) {
  const sh = getSheet_(table);
  const data = sh.getDataRange().getValues();
  if (data.length <= 1) return [];
  const headers = data[0];
  const out = [];
  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    if (row.every((v) => String(v || "").trim() === "")) continue;
    out.push(rowToObj_(table, headers, row));
  }
  return out;
}

function findRowById_(table, idCol, idVal) {
  const sh = getSheet_(table);
  const data = sh.getDataRange().getValues();
  if (data.length <= 1) return null;
  const headers = data[0];
  const idx = headers.indexOf(idCol);
  if (idx === -1) return null;
  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    if (String(row[idx]) === idVal) {
      return rowToObj_(table, headers, row);
    }
  }
  return null;
}

function upsertRow_(table, obj, idCol) {
  const sh = getSheet_(table);
  const data = sh.getDataRange().getValues();
  const headers = data.length ? data[0] : SCHEMA[table];
  const idIdx = headers.indexOf(idCol);
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

  const row = objToRow_(table, headers, obj);
  if (rowIndex === -1) {
    sh.appendRow(row);
  } else {
    sh.getRange(rowIndex, 1, 1, headers.length).setValues([row]);
  }

  return obj;
}

function deleteRowById_(table, idCol, idVal) {
  const sh = getSheet_(table);
  const data = sh.getDataRange().getValues();
  if (data.length <= 1) return false;
  const headers = data[0];
  const idx = headers.indexOf(idCol);
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
  const sh = getSheet_(table);
  const headers = SCHEMA[table];
  sh.clearContents();
  sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (!rows || rows.length === 0) return;
  const out = rows.map((r) => objToRow_(table, headers, r));
  sh.getRange(2, 1, out.length, headers.length).setValues(out);
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
  for (let c = 0; c < headers.length; c++) {
    const key = headers[c];
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
  for (let c = 0; c < headers.length; c++) {
    const key = headers[c];
    let val = obj ? obj[key] : "";
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
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
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
  if (!CONFIG.API_KEY || CONFIG.API_KEY === "CHANGE_ME") return true;
  return String(key || "") === String(CONFIG.API_KEY);
}

function jsonResponse_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON)
    .setHeader("Access-Control-Allow-Origin", "*")
    .setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
    .setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function jsonError_(message, code) {
  return jsonResponse_({ ok: false, error: message, code: code, ts: new Date().toISOString() });
}

function withLock(fn) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
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
```
