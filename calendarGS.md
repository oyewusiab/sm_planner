function refreshCalendar() {
  markCalendarActivities();
}

function toDateObject(value) {
  if (value instanceof Date) return value;

  // Try to convert text like "10-Jan-2026" automatically
  const parsed = new Date(value);
  if (!isNaN(parsed.getTime())) return parsed;

  return null; // not a valid date
}

function markCalendarActivities() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const activitySheet = ss.getSheetByName("activities");
  const holidaySheet = ss.getSheetByName("PUBLIC HOLIDAY");
  const churchProgSheet = ss.getSheetByName("OTHER CHURCH PROGRAM");
  const calendarSheet = ss.getSheetByName("2026 calendar");

  // COLORS
  const COLOR_ACTIVITY = "#64e851";
  const COLOR_HOLIDAY = "#f4cccc";
  const COLOR_CHURCH_PROGRAM = "#d9ead3";
  const COLOR_OVERLAP_ACTIVITY_HOLIDAY = "#f5ac1a";
  const COLOR_OVERLAP_ACTIVITY_CHURCH = "#f90202";
  const COLOR_OVERLAP_ALL_THREE = "#980000";

  // ===== READ ACTIVITIES =====
  const actData = activitySheet.getRange(2, 1, Math.max(0, activitySheet.getLastRow() - 1), 3).getValues();
  const actMap = {};

  actData.forEach(r => {
    const d = toDateObject(r[0]);
    if (d) {
      const key = d.toDateString();
      if (!actMap[key]) actMap[key] = [];
      actMap[key].push(`${r[1]} — ${r[2]}`);
    }
  });

  // ===== READ PUBLIC HOLIDAYS =====
  const holData = holidaySheet.getRange(2, 1, Math.max(0, holidaySheet.getLastRow() - 1), 3).getValues();
  const holMap = {};

  holData.forEach(r => {
    const d = toDateObject(r[0]);
    if (d) {
      const key = d.toDateString();
      if (!holMap[key]) holMap[key] = [];
      holMap[key].push(`${r[1]} (Theme: ${r[2]})`);
    }
  });

  // ===== READ OTHER CHURCH PROGRAMS =====
  const chData = churchProgSheet.getRange(2, 1, Math.max(0, churchProgSheet.getLastRow() - 1), 3).getValues();
  const chMap = {};

  chData.forEach(r => {
    const d = toDateObject(r[0]);
    if (d) {
      const key = d.toDateString();
      if (!chMap[key]) chMap[key] = [];
      chMap[key].push(`${r[1]} — ${r[2]}`);
    }
  });

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
generateNext60DaysActivities();

function refreshCalendar() { 
  markCalendarActivities(); 
  generateNext14DaysMiniTable();
  generateNext60DaysActivities();
  sendPendingReportEmails();   
  generateCompletionWidget();   
  sendReportFollowUpReminders();   // <<< NEW
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
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const activitiesSheet = ss.getSheetByName("activities");
  const dashboard = ss.getSheetByName("CALENDAR DASHBOARD");

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

  // Read 4 columns: Date / Activity / Org / Status
  const lastRow = activitiesSheet.getLastRow();
  const dataRange = activitiesSheet.getRange(2, 1, lastRow - 1, 4).getValues();

  const today = new Date();
  const ahead60 = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 60);

  let filtered = [];

  dataRange.forEach(row => {
    let date = row[0];
    let activity = row[1];
    let org = row[2];
    let status = row[3]; // NEW

    if (!(date instanceof Date)) return;

    // NEW LOGIC: remove completed activities
    if (status === true) return;

    // NEW LOGIC: remove overdue activities
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
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const dashboard = ss.getSheetByName("CALENDAR DASHBOARD");
  const activitiesSheet = ss.getSheetByName("activities");
  const churchSheet = ss.getSheetByName("OTHER CHURCH PROGRAM");

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

  // --- ACTIVITIES (with new completed and overdue logic)
  const actLastRow = activitiesSheet.getLastRow();
  const actData = activitiesSheet.getRange(2, 1, actLastRow - 1, 4).getValues();

  actData.forEach(row => {
    let date = row[0];
    let item = row[1];
    let org = row[2];
    let status = row[3]; // NEW

    if (!(date instanceof Date)) return;

    if (status === true) return; // NEW: exclude completed
    if (date < today) return; // NEW: exclude overdue

    if (date >= today && date <= ahead14) {
      let finalOrg = (org || "").toString().toUpperCase();
      if (finalOrg !== "WARD") finalOrg = "WARD " + finalOrg;

      miniList.push([date, (item || "").toString().toUpperCase(), finalOrg, "ACTIVITY"]);
    }
  });

  // --- OTHER CHURCH PROGRAM
  const churchLastRow = churchSheet.getLastRow();
  const churchData = churchSheet.getRange(2, 1, churchLastRow - 1, 3).getValues();

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
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const dash = ss.getSheetByName("CALENDAR DASHBOARD");
  const sheet = ss.getSheetByName("activities");

  if (!sheet || !dash) {
    console.error("Missing sheet: activities or CALENDAR DASHBOARD");
    return;
  }

  // Read columns A–G (Date, Activity, Org, Status, EmailStatus, ForWhom, ReportSubmitted)
  const lastRow = sheet.getLastRow();
  if (lastRow < 3) return;

  const data = sheet.getRange(2, 1, lastRow - 1, 7).getValues();

  let total = 0;
  let completed = 0;
  let pending = 0;
  let notDone = 0;
  let reportsSubmitted = 0;
  let overdueReports = 0;

  let dueActivities = 0;   // NEW — for correct completion rate

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  data.forEach(row => {
    const date = row[0];
    const activityName = row[1];
    const status = row[3];
    const reportStatusRaw = row[6];

    if (!activityName) return; // skip blank rows

    total++;

    let isDue = false;

    if (date instanceof Date) {
      const activityDate = new Date(date);
      activityDate.setHours(0, 0, 0, 0);

      isDue = (activityDate <= today);
    }

    // Count due activities (for correct completion rate)
    if (isDue) dueActivities++;

    // COMPLETED
    if (status === true) {
      completed++;

      const reportStatus = (reportStatusRaw || "").toString().trim().toUpperCase();

      if (reportStatus === "YES") reportsSubmitted++;
      else if (reportStatus === "NO") overdueReports++;

      return; // done with this row
    }

    // NOT COMPLETED
    if (date instanceof Date) {
      let activityDate = new Date(date);
      activityDate.setHours(0, 0, 0, 0);

      if (activityDate < today) notDone++;
      else pending++;
    }
  });

  // ---- NEW COMPLETION RATE LOGIC ----
  const rate = (dueActivities > 0)
    ? (completed / dueActivities) * 100
    : 0;

  // ---- Write to dashboard ----
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

/*******************************
 Calendar Notification Engine
 - Weekly upcoming emails every Friday (14d + 60d)
 - Report emails when status becomes TRUE
 - HTML formatted emails
 - Uses CONTACTS sheet for recipients and rules
*******************************/

/* ---------- CONFIG ---------- */
const CONTACTS_SHEET = "CONTACTS";
const ACTIVITIES_SHEET = "activities";
const CHURCH_PROG_SHEET = "OTHER CHURCH PROGRAM";
const DASHBOARD_SHEET = "CALENDAR DASHBOARD";

// Who are considered "admins" to mention in the email footer? (optional)
const ADMIN_NAMES = ["Bishop", "First Counselor", "Second Counselor", "Ward Clerk", "Executive Secretary"];

/* ---------- UTILITIES ---------- */
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
  if (!(d instanceof Date)) return "";   // <-- prevents errors!
  return Utilities.formatDate(
    d,
    SpreadsheetApp.getActive().getSpreadsheetTimeZone(),
    "dd-MMM-yyyy"
  );
}


/* ---------- ACTIVITY GATHERERS ---------- */
function getActivitiesFromSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(ACTIVITIES_SHEET);
  const last = sh.getLastRow();
  if (last < 2) return [];
  // Columns: A Date, B Activity, C Organisation, D Status(checkbox)
  const rows = sh.getRange(2, 1, last - 1, 4).getValues();
  return rows.map(r => ({
    date: r[0] instanceof Date ? r[0] : null,
    activity: (r[1] || "").toString(),
    org: normalizeOrgName(r[2]),
    status: r[3] === true
  }));
}

function getOtherChurchPrograms() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(CHURCH_PROG_SHEET);
  const last = sh.getLastRow();
  if (last < 2) return [];
  // Columns: A Date, B Program, C Organisation
  const rows = sh.getRange(2, 1, last - 1, 3).getValues();
  return rows.map(r => ({
    date: r[0] instanceof Date ? r[0] : null,
    activity: (r[1] || "").toString(),
    org: normalizeOrgName(r[2]),
    status: false  // church program sheet has no status column
  }));
}

/* returns activities (both sources) between today (inclusive) and today+days (inclusive), excluding completed and overdue */
function getUpcomingActivities(days) {
  const today = new Date();
  const end = new Date(); end.setDate(today.getDate() + days);
  const acts = getActivitiesFromSheet().filter(a => a.date && a.date >= today && a.date <= end && a.status !== true);
  const ch = getOtherChurchPrograms().filter(a => a.date && a.date >= today && a.date <= end);
  return acts.concat(ch);
}

/* ---------- CONTACTS PARSING ---------- */
function getContacts() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(CONTACTS_SHEET);
  const last = sh.getLastRow();
  if (last < 2) return [];

  const rows = sh.getRange(2, 1, last - 1, 6).getValues();

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


/* ---------- FILTER LOGIC FOR UPCOMING EMAILS ---------- */
/*
Rules:
- If contact.upcoming contains "ALL ACTIVITIES" -> send all upcoming items (14d and 60d) 
- If contact.upcoming contains "WARD" -> send only items where org === "WARD"
- If contact.upcoming contains "RELIEF SOCIETY" -> send only items where org === "RELIEF SOCIETY"
- "WARD; RELIEF SOCIETY" -> send union of both filters
*/
function filterActivitiesForContact(contact, days) {
  const requested = contact.upcoming.map(s => s.toUpperCase());
  const allActs = getUpcomingActivities(days);

  // if All Activities requested
  if (requested.some(r => r === "ALL ACTIVITIES")) {
    return allActs;
  }

  // else filter by each requested token
  const allowedOrgs = requested.map(s => s.trim().toUpperCase());
  return allActs.filter(a => {
    // If activity's org is blank, treat as not matching
    if (!a.org) return false;
    // If any allowedOrg equals org, include
    return allowedOrgs.some(allowed => {
      if (allowed === "WARD") return a.org === "WARD";
      return a.org === allowed;
    });
  });
}

/* ---------- HTML EMAIL BUILDERS ---------- */
function buildHtmlTableForActivities(list) {
  if (!list || list.length === 0) return "<p>No items.</p>";
  // table header
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

/* ---------- EMAIL SENDER ---------- */
function sendHtmlEmail(toEmail, subject, htmlBody) {
  MailApp.sendEmail({
    to: toEmail,
    subject: subject,
    htmlBody: htmlBody
  });
}

/* ---------- WEEKLY UPCOMING EMAILS (FRIDAY) ---------- */
function sendWeeklyUpcomingEmails() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const contacts = getContacts();
  if (!contacts.length) return;

  contacts.forEach(contact => {
    try {
      const next14 = filterActivitiesForContact(contact, 14);
      const next60 = filterActivitiesForContact(contact, 60);

      // If both empty → skip (but still no log needed)
      if (next14.length === 0 && next60.length === 0) return;

      // Build HTML email
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

      // Try sending email → log result
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

      // 🔥 SAVE TO REPORT LOG
      logWeeklyUpcomingEmail(contact.name, sendStatus, timestamp);

    } catch (err) {
      console.error("Error processing contact:", contact.name, err);
    }
  });
}

/* ---------- REPORT EMAILS WHEN ACTIVITY COMPLETED ---------- */
/*
 This function should be called by an onEdit(e) handler when a checkbox changes to TRUE in activities sheet column D.
 It finds the completed activity row, then:
  - For each contact whose Report field mentions the activity's org:
     - If the report entry contains "(FU)" (case-insensitive), send a follow-up style email (no report request)
     - Otherwise send a report request email
*/
function handleActivityCompletion(activityRowObj) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const contacts = getContacts();

  const org = activityRowObj.org;
  const activityName = activityRowObj.activity;
  const dateStr = activityRowObj.date
    ? formatDateShort(activityRowObj.date)
    : "";

  contacts.forEach(contact => {
    contact.report.forEach(tokenRaw => {

      // -------------------------------
      // NORMALIZE TOKEN FIRST
      // -------------------------------
      const token = tokenRaw.toUpperCase();
      const isFollowUp = token.includes("(FU)");
      const plainToken = token.replace(/\(FU\)/gi, "").trim();

      // -------------------------------
      // CHECK IF TOKEN MATCHES ACTIVITY
      // -------------------------------
      if (plainToken !== "ALL ACTIVITIES" && plainToken !== org) return;

      // -------------------------------
      // BUILD EMAIL
      // -------------------------------
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

      // -------------------------------
      // SEND EMAIL
      // -------------------------------
      let sendStatus = "SUCCESS";
      try {
        sendHtmlEmail(contact.email, subj, html);
      } catch (err) {
        sendStatus = "FAILED";
        console.error("Email failed for", contact.email, err);
      }

      // -------------------------------
      // LOG RESULT (SAFE)
      // -------------------------------
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

  Logger.log("EDIT DETECTED:");
  Logger.log("Sheet = " + sheetName);
  Logger.log("Row = " + row);
  Logger.log("Column = " + col);
  Logger.log("Value = " + e.range.getValue());

  // Only fire on ACTIVITIES sheet
  if (sheetName !== ACTIVITIES_SHEET) {
    Logger.log("Not activities sheet → SKIPPED.");
    return;
  }

  // Only fire on STATUS column (D = col 4)
  if (col !== 4) {
    Logger.log("Not Status column → SKIPPED.");
    return;
  }

  // Ignore header rows
  if (row < 3) {
    Logger.log("Header row → SKIPPED.");
    return;
  }

  const value = e.range.getValue();

  if (value === true) {
    Logger.log("STATUS CHECKED → PROCEEDING...");
  } else {
    Logger.log("STATUS unchecked → SKIPPED.");
    return;
  }

  // Read entire row
  const rowVals = sh.getRange(row, 1, 1, 4).getValues()[0];
  Logger.log("Row Data = " + JSON.stringify(rowVals));

  const date = rowVals[0];
  const activity = rowVals[1];
  const org = rowVals[2];

  if (!(date instanceof Date)) {
    Logger.log("Invalid date → SKIPPED.");
    return;
  }

  Logger.log("Calling handleActivityCompletion...");
  handleActivityCompletion({
    date: date,
    activity: activity,
    org: normalizeOrgName(org),
    rowNumber: row
  });
}

/* Installable trigger handler */
function onEditInstallable(e) {
  onStatusEdit(e);
}

/* ---------- Trigger creation helper ---------- */
function createFridayTrigger() {
  // Deletes previous triggers named sendWeeklyUpcomingEmails to avoid duplicates
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => {
    if (t.getHandlerFunction() === "sendWeeklyUpcomingEmails") ScriptApp.deleteTrigger(t);
  });

  // Create new time-based trigger: every Friday at 09:00 (you can change)
  ScriptApp.newTrigger("sendWeeklyUpcomingEmails")
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.FRIDAY)
    .atHour(9)
    .create();

  // Also ensure onEditInstallable is installed if not present (optional)
  const hasOnEditInstallable = triggers.some(t => t.getHandlerFunction() === "onEditInstallable");
  if (!hasOnEditInstallable) {
    ScriptApp.newTrigger("onEditInstallable").forSpreadsheet(SpreadsheetApp.getActive()).onEdit().create();
  }
}

/* ---------- TEST HELPERS ---------- */
function testSendWeeklyEmails() {
  // Sends weekly emails once now to verify formatting (use during testing)
  sendWeeklyUpcomingEmails();
}

function testReportEmailForRow() {
  const rowNumber = 7;   // <--- Set the row you want to test
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(ACTIVITIES_SHEET);

  if (!sh) {
    throw new Error("ERROR: Sheet '" + ACTIVITIES_SHEET + "' not found. Check the sheet name.");
  }

  if (!rowNumber || rowNumber < 2) {
    throw new Error("ERROR: Enter a valid row number (2 or greater).");
  }

  const lastRow = sh.getLastRow();
  if (rowNumber > lastRow) {
    throw new Error("ERROR: Row number is beyond the available data (" + lastRow + ").");
  }

  const rowVals = sh.getRange(rowNumber, 1, 1, 4).getValues()[0];
  const date = rowVals[0];
  const activity = rowVals[1];
  const org = rowVals[2];
  const status = rowVals[3];

  if (!(date instanceof Date)) {
    throw new Error("ERROR: Row " + rowNumber + " does not contain a valid date.");
  }

  if (!activity) {
    throw new Error("ERROR: Row " + rowNumber + " has no activity name.");
  }

  if (!org) {
    throw new Error("ERROR: Row " + rowNumber + " has no organisation.");
  }

  if (status !== true) {
    throw new Error("ERROR: STATUS is not checked (TRUE). Check the activity before testing.");
  }

  // NOW send the report email correctly
  handleActivityCompletion({
    date: date,
    activity: activity.toString(),
    org: normalizeOrgName(org),
    rowNumber: rowNumber
  });

  Logger.log("SUCCESS: Report notification triggered for row " + rowNumber);
}
/* -------------------------------------------------------
   Send report emails for all NEWLY completed activities
   Called from your REFRESH button
---------------------------------------------------------*/
function sendPendingReportEmails() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(ACTIVITIES_SHEET);

  const last = sh.getLastRow();
  if (last < 3) return;

  // Columns:
  // A Date, B Activity, C Org, D Status, E EmailSent?
  const data = sh.getRange(2, 1, last - 1, 5).getValues();  
  // Row offset = row index +1 because sheet starts at row 2

  for (let i = 0; i < data.length; i++) {
    const rowNum = i + 2;
    const date = data[i][0];
    const activity = data[i][1];
    const org = normalizeOrgName(data[i][2]);
    const status = data[i][3];
    const emailSent = data[i][4];

    // Skip invalid or incomplete rows
    if (!(date instanceof Date)) continue;
    if (!activity || !org) continue;

    // Check if email needs to be sent
    if (status === true && emailSent !== true) {
      // Send report email
      handleActivityCompletion({
        date: date,
        activity: activity,
        org: org,
        rowNumber: rowNum
      });

      // Mark email sent
      sh.getRange(rowNum, 5).setValue(true);
    }
  }
}
/* ------------------------------------------------------
   UNIVERSAL FORMATTER FOR WHATSAPP ANNOUNCEMENTS
-------------------------------------------------------*/
function formatWhatsappActivityUniversal(activityObj, index) {
  const dateStr = activityObj.date;
  const rawName = activityObj.activity || "";
  const org = (activityObj.org || "").toUpperCase();
  const forWhom = (activityObj.forWhom || "").toString();

  // 1️⃣ Add “WARD” prefix if missing
  const wardActivityName =
    rawName.toUpperCase().startsWith("WARD")
      ? rawName
      : "WARD " + rawName;

  // 2️⃣ Detect audience
  let audience = "all members"; // default

  if (/YOUTH|YM|YW/i.test(forWhom) || /YOUTH/i.test(org)) audience = "all youths";
  if (/RELIEF/i.test(forWhom) || /RELIEF/i.test(org)) audience = "all Relief Society sisters";
  if (/ELDER/i.test(forWhom) || /ELDER/i.test(org)) audience = "all Elders Quorum members";
  if (/PRIMARY/i.test(forWhom) || /PRIMARY/i.test(org)) audience = "all Primary children and leaders";
  if (/YOUNG WOMEN|YW/i.test(forWhom)) audience = "all Young Women";
  if (/YOUNG MEN|YM/i.test(forWhom)) audience = "all Young Men";

  // 3️⃣ Build message
  return (
    `${index}️⃣ *${wardActivityName}*\n` +
    `${capitalize(audience)} are invited to the *${wardActivityName}* coming up on *${dateStr}* at *The Obantoko Ward*.\n` +
    `Time: __________________\n`
  );
}

// Capitalize helper
function capitalize(txt) {
  return txt.charAt(0).toUpperCase() + txt.slice(1);
}

/* ------------------------------------------------------
   NATURAL-LANGUAGE ACTIVITY FORMATTER
   (Using SUNDAY as today's date)
-------------------------------------------------------*/
function formatActivityWhatsapp(item, timezone) {
  const today = new Date();
  const sunday = new Date(today);
  sunday.setDate(today.getDate() + ((7 - today.getDay()) % 7)); // Move to Sunday
  sunday.setHours(0,0,0,0);

  const activityDate = new Date(item.dateObj);
  activityDate.setHours(0,0,0,0);

  const diffDays = Math.round((activityDate - sunday) / (1000*60*60*24));

  let phrasing = "";

  // ---- Within this week (Sunday → Saturday)
  if (diffDays >= 0 && diffDays <= 6) {
    const weekday = Utilities.formatDate(activityDate, timezone, "EEEE");
    phrasing = `coming up this ${weekday.toLowerCase()}, *${item.date}*`;
  }

  // ---- Next week (Next Sunday → Next Saturday)
  else if (diffDays >= 7 && diffDays <= 13) {
    const weekday = Utilities.formatDate(activityDate, timezone, "EEEE");
    phrasing = `coming up next week ${weekday.toLowerCase()}, *${item.date}*`;
  }

  // ---- Beyond next week
  else {
    const weekday = Utilities.formatDate(activityDate, timezone, "EEEE");
    phrasing = `coming up on ${weekday.toLowerCase()}, *${item.date}*`;
  }

  return (
    `• All ${item.forWhom.toLowerCase()} are invited to the *Ward ${item.activity}* ` +
    `${phrasing} at *The Obantoko Ward*.\n` +
    `Time: __________________\n`
  );
}

/* ------------------------------------------------------
   MAP GROUP NAMES ("for" column → readable Who)
-------------------------------------------------------*/
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

/* ------------------------------------------------------
   NATURAL-LANGUAGE DATE FORMATTER (SUNDAY as today)
-------------------------------------------------------*/
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

/* ------------------------------------------------------
   FORMAT A SINGLE ACTIVITY BLOCK
-------------------------------------------------------*/
function formatActivityBlock(item, timezone) {
  const dateObj = item.dateObj;
  const rawActivity = (item.activity || "").toString().trim();
  const rawAudience = (item.forWhom || "").toString().trim();
  const timeText = item.time ? item.time.toString().trim() : "";

  /* ---------- CLEAN ACTIVITY TITLE ---------- */
  let activityTitle = rawActivity.toUpperCase();
  if (!activityTitle.startsWith("WARD ")) {
    activityTitle = "WARD " + activityTitle;
  }

  /* ---------- CLEAN AUDIENCE TEXT ---------- */
  let audience = rawAudience
    .replace(/^ALL\s+/i, "")     // remove leading "All"
    .trim()
    .toLowerCase();

  if (!audience) audience = "members";

  /* ---------- DATE PHRASE ---------- */
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

  /* ---------- TIME ---------- */
  const timeLine = timeText ? `Time: ${timeText}` : `Time: __________________`;

  /* ---------- FINAL BLOCK ---------- */
  return (
`*${activityTitle}*
• All ${audience} are invited to the *${activityTitle}* ${datePhrase} at the *Obantoko Ward*.
${timeLine}\n\n`
  );
}

/* ======================================================
   SEND BISHOPRIC WHATSAPP NOTIFICATION — SATURDAY 6PM
   - Hides past activities
   - Uses exact Time from Column H
   - Logs dispatch into REPORT LOG
====================================================== */
function sendBishopricWhatsappNotification() {

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const actSh = ss.getSheetByName("ACTIVITIES");
  const conSh = ss.getSheetByName("CONTACTS");
  const timezone = ss.getSpreadsheetTimeZone();

  if (!actSh || !conSh) {
    throw new Error("Missing ACTIVITIES or CONTACTS sheet.");
  }

  /* --------------------------------------------------
     LOAD BISHOPRIC CONTACTS
  -------------------------------------------------- */
  const contacts = conSh
    .getRange(2, 1, conSh.getLastRow() - 1, 6)
    .getValues()
    .map(r => ({
      name: r[0],
      org: r[2],
      email: r[5]
    }))
    .filter(c => (c.org || "").toString().toUpperCase() === "BISHOPRIC");

  if (contacts.length === 0) return;

  /* --------------------------------------------------
     LOAD ACTIVITIES
     A = Date
     B = Activity
     F = For Whom
     H = Time
  -------------------------------------------------- */
  const rows = actSh.getRange(3, 1, actSh.getLastRow() - 2, 8).getValues();

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

    const diffDays = Math.floor(
      (eventDate - today) / (1000 * 60 * 60 * 24)
    );

    // ✅ Hide past activities automatically
    if (diffDays >= 0 && diffDays <= DAYS_AHEAD) {
      upcoming.push({
        dateObj: eventDate,
        activity: activity.toString().trim(),
        forWhom: (forWhom || "").toString().trim(),
        time: (time || "").toString().trim()
      });
    }
  });

  /* --------------------------------------------------
     BUILD WHATSAPP MESSAGE
  -------------------------------------------------- */
  let body = `WHATSAPP NOTIFICATION\n\n*WARD ACTIVITIES*\n\n`;

  if (upcoming.length === 0) {
    body += `No upcoming ward activities in the next ${DAYS_AHEAD} days.\n\n`;
  } else {
    upcoming.forEach(item => {
      body += buildWhatsappBlock(item, timezone);
    });
  }

  body +=
`Please verify, update, and post this (with the Stake announcement) in the Ward Members WhatsApp group immediately after the Sacrament meeting tomorrow.`;

  /* --------------------------------------------------
     SEND EMAIL + LOG RESULT
  -------------------------------------------------- */
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

  // ✅ Log dispatch into REPORT LOG
  logToReportLog(
    "Bishopric WhatsApp Notification",
    [{
      name: "Bishopric",
      status: overallStatus
    }]
  );
}

/* ======================================================
   FORMAT EACH ACTIVITY BLOCK (CLEAN + CONSISTENT)
====================================================== */
function buildWhatsappBlock(item, timezone) {

  /* ---- CLEAN ACTIVITY TITLE ---- */
  let title = item.activity.toUpperCase();
  title = title.replace(/^WARD\s+/i, "");
  title = "WARD " + title;

  /* ---- CLEAN AUDIENCE ---- */
  let audience = item.forWhom
    .replace(/^ALL\s+/i, "")
    .trim()
    .toLowerCase();

  if (!audience) audience = "members";

  /* ---- DATE WORDING ---- */
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const eventDate = item.dateObj;
  const diff = Math.floor(
    (eventDate - today) / (1000 * 60 * 60 * 24)
  );

  const weekday = eventDate.toLocaleDateString("en-GB", {
    weekday: "long"
  });

  const dateText = Utilities.formatDate(
    eventDate,
    timezone,
    "dd-MMM-yyyy"
  );

  let datePhrase;
  if (diff >= 0 && diff <= 6) {
    datePhrase = `coming up this ${weekday}, *${dateText}*`;
  } else if (diff >= 7 && diff <= 13) {
    datePhrase = `coming up next week ${weekday}, *${dateText}*`;
  } else {
    datePhrase = `coming up on ${weekday}, *${dateText}*`;
  }

  /* ---- TIME (EXACT CELL CONTENT ONLY) ---- */
  const timeText = item.time ? item.time : "TBD";

  /* ---- FINAL BLOCK ---- */
  return (
`*${title}*
• All ${audience} are invited to the *${title}* ${datePhrase} at the *Obantoko Ward*.
Time: ${timeText}\n\n`
  );
}


function logWeeklyUpcomingEmail(contactName, status, timestamp) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName("REPORT LOG");
  if (!sh) throw new Error("Sheet 'REPORT LOG' not found!");

  const today = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), "dd-MMM-yyyy");

  let lastRow = sh.getLastRow();

  // --- Check if today's date already exists ---
  let rowToUse = 0;
  if (lastRow >= 1) {
    const lastDate = sh.getRange(lastRow, 1).getValue();
    const lastDateStr = Utilities.formatDate(new Date(lastDate), ss.getSpreadsheetTimeZone(), "dd-MMM-yyyy");
    if (lastDateStr === today) {
      rowToUse = lastRow;   // append to today's row
    }
  }

  // If no row for today, create new row
  if (rowToUse === 0) {
    rowToUse = lastRow + 1;
    sh.getRange(rowToUse, 1).setValue(today);
  }

  // Find next empty column AFTER Column A
  let col = 2;
  while (sh.getRange(rowToUse, col).getValue() !== "") {
    col++;
  }

  // Write entry: "Name / Status / Timestamp"
  const entry =
    contactName + "\n" +
    "Status: " + status + "\n" +
    "Timestamp: " + timestamp;

  sh.getRange(rowToUse, col).setValue(entry);
}

function sendReportFollowUpReminders() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const actSh = ss.getSheetByName("ACTIVITIES");
  const logSh = ss.getSheetByName("REPORT LOG");
  const timezone = ss.getSpreadsheetTimeZone();

  if (!actSh || !logSh) {
    throw new Error("Missing ACTIVITIES or REPORT LOG sheet.");
  }

  const lastRow = actSh.getLastRow();
  if (lastRow < 3) return;

  const data = actSh.getRange(3, 1, lastRow - 2, 8).getValues();
  const now = new Date();
  const ms48hrs = 48 * 60 * 60 * 1000;
  const ms5days = 5 * 24 * 60 * 60 * 1000;

  data.forEach((row, i) => {
    const rowNum = i + 3; // real row number

    const date = row[0];
    const activityName = row[1];
    const org = row[2];
    const status = row[3];        // TRUE/FALSE
    const reportStatus = (row[6] || "").toString().trim().toUpperCase();
    const lastReminder = row[7];  // Column H

    // Skip invalid rows
    if (!activityName || !(date instanceof Date)) return;

    // Skip if report submitted
    if (reportStatus === "YES" || reportStatus === "N/A") return;

    // Only follow-up when completed
    if (status !== true) return;

    // --- Determine if reminder due ---
    let shouldSend = false;

    // First reminder (48 hours)
    if (!lastReminder) {
      // Check if 48 hrs since the activity date
      if (now - date >= ms48hrs) {
        shouldSend = true;
      }
    } else {
      // Recurring reminder every 5 days
      const last = new Date(lastReminder);
      if (now - last >= ms5days) {
        shouldSend = true;
      }
    }

    if (!shouldSend) return;

    // --- Send follow-up email ---
    const contacts = getContacts(); // already existing function
    const recipients = contacts.filter(c =>
      c.report.map(r => r.toUpperCase()).includes(org.toUpperCase())
    );

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

      // Log email
      logSh.appendRow([
        Utilities.formatDate(new Date(), timezone, "dd-MMM-yyyy hh:mm a"),
        contact.name,
        `Reminder: ${sendStatus}`
      ]);
    });

    // Update last reminder timestamp
    actSh.getRange(rowNum, 8).setValue(new Date());
  });
}

function logToReportLog(type, recipients) {
  if (!Array.isArray(recipients) || recipients.length === 0) {
    console.warn("logToReportLog skipped — no recipients provided", type);
    return;
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const logSh = ss.getSheetByName("REPORT LOG");
  const timezone = ss.getSpreadsheetTimeZone();

  const timestamp = Utilities.formatDate(
    new Date(),
    timezone,
    "dd-MMM-yyyy hh:mm a"
  );

  // ----------------------------------
  // BUILD ROW (HORIZONTAL)
  // ----------------------------------
  const row = [];
  row[0] = timestamp;   // Column A — Date
  row[1] = type;        // Column B — Report Type

  let colIndex = 2;     // Start at Column C

  recipients.forEach(rec => {
    row[colIndex] =
`${rec.name}
Status: ${rec.status}
Timestamp: ${timestamp}`;
    colIndex++;
  });

  // Append row
  logSh.appendRow(row);

  const rowNumber = logSh.getLastRow();

  // Apply formatting
  formatReportLogRow(logSh, rowNumber, colIndex - 1);
}
function formatReportLogRow(sheet, row, lastCol) {
  const headerColor = "#1c4587";
  const successColor = "#d9ead3";
  const failColor = "#f4cccc";

  // Date column (A)
  sheet.getRange(row, 1)
    .setBackground("#f0f0f0")
    .setFontWeight("bold");

  // Type column (B)
  sheet.getRange(row, 2)
    .setBackground(headerColor)
    .setFontColor("white")
    .setFontWeight("bold");

  // Recipient columns (C onward)
  for (let col = 3; col <= lastCol + 1; col++) {
    const cell = sheet.getRange(row, col);
    const text = cell.getValue().toString().toUpperCase();

    cell
      .setBackground(text.includes("FAILED") ? failColor : successColor)
      .setWrap(true)
      .setVerticalAlignment("top");
  }
}
