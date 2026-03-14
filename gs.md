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
  API_KEY: "ThisIsMySecretKey123!@", // required in ?key= or JSON body {key: "..."}
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
    "disabled",
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
  HYMNS: ["number", "title", "type", "theme", "updated_date"],
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
  HYMNS: "number",
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
  USERS: ["must_reset_password", "disabled"],
};

const UNIT_JSON_KEYS = ["prefs", "venues"];

function doGet(e) {
  return withLock(() => route_(e, "GET"));
}

function doPost(e) {
  return withLock(() => route_(e, "POST"));
}

function doOptions(e) {
  return jsonResponse_({ ok: true, ts: new Date().toISOString() });
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
      case "syncHymns":
        return jsonResponse_({ ok: true, data: syncLdsHymns(), ts: new Date().toISOString() });
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
    HYMNS: getAllRows_("HYMNS"),
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
    // Trigger email notification for new notifications
    if (table === "NOTIFICATIONS") {
      try { sendEmail_(obj); } catch (e) { console.warn("Email failed:", e); }
    }
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

function hashUserPasswords() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
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
```
