/**
 * Sacrament Meeting Planner — Google Apps Script Backend API
 * 
 * INSTRUCTIONS:
 * 1. Open Google Sheets (https://sheets.new)
 * 2. Click "Extensions" > "Apps Script"
 * 3. Replace all existing code in Code.gs with this code.
 * 4. Click "Deploy" > "New deployment"
 * 5. Select type: "Web app"
 * 6. Execute as: "Me"
 * 7. Who has access: "Anyone"
 * 8. Click "Deploy", authorize access, and copy the Web App URL!
 * 9. Paste the Web App URL into your Sacrament Meeting Planner Settings page or .env file (VITE_GAS_WEB_APP_URL).
 */

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) ? e.parameter.action : "pullAll";
  var result = {};
  
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    
    if (action === "getMetadata") {
      result = {
        status: "success",
        metadata: getMetadata_(ss)
      };
    } else {
      // Default: pullAll
      result = {
        status: "success",
        db: getFullDatabase_(ss),
        metadata: getMetadata_(ss)
      };
    }
  } catch (err) {
    result = {
      status: "error",
      message: err.toString()
    };
  }
  
  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var result = {};
  
  try {
    var contents = e && e.postData && e.postData.contents ? e.postData.contents : "{}";
    var payload = JSON.parse(contents);
    var action = payload.action || "pushAll";
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    
    if (action === "pushAll") {
      saveFullDatabase_(ss, payload.data || {});
      var nextMeta = touchMetadata_(ss);
      result = {
        status: "success",
        message: "Full database saved successfully",
        metadata: nextMeta
      };
    } else if (action === "pushTable" && payload.tableName && payload.rows) {
      saveTable_(ss, payload.tableName, payload.rows);
      var nextMeta = touchMetadata_(ss);
      result = {
        status: "success",
        message: "Table " + payload.tableName + " saved successfully",
        metadata: nextMeta
      };
    } else {
      result = {
        status: "error",
        message: "Unknown action: " + action
      };
    }
  } catch (err) {
    result = {
      status: "error",
      message: err.toString()
    };
  }
  
  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// Internal Helper Functions

function getMetadata_(ss) {
  var sheet = getOrCreateSheet_(ss, "METADATA");
  var val = sheet.getRange(1, 1).getValue();
  if (val) {
    try {
      return JSON.parse(val);
    } catch (e) {}
  }
  return { last_updated: new Date().toISOString(), versions: {} };
}

function touchMetadata_(ss) {
  var sheet = getOrCreateSheet_(ss, "METADATA");
  var meta = getMetadata_(ss);
  meta.last_updated = new Date().toISOString();
  sheet.getRange(1, 1).setValue(JSON.stringify(meta));
  return meta;
}

function getFullDatabase_(ss) {
  var sheet = getOrCreateSheet_(ss, "RAW_DB");
  var val = sheet.getRange(1, 1).getValue();
  if (val) {
    try {
      return JSON.parse(val);
    } catch (e) {}
  }
  return {};
}

function saveFullDatabase_(ss, dbData) {
  var sheet = getOrCreateSheet_(ss, "RAW_DB");
  sheet.getRange(1, 1).setValue(JSON.stringify(dbData));
}

function saveTable_(ss, tableName, rows) {
  var db = getFullDatabase_(ss);
  db[tableName] = rows;
  saveFullDatabase_(ss, db);
}

function getOrCreateSheet_(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  return sheet;
}
