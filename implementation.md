# Implementation Guide (SM_PLANNER + Apps Script)

This guide explains how to deploy the Apps Script backend and how to connect the Vite frontend.

**1) Paste and configure Apps Script**
1. Open the Google Sheet `SM_PLANNER`.
1. Extensions ? Apps Script.
1. Replace existing code with the contents of `gs.md`.
1. Update `CONFIG.API_KEY` (strong random string). You can keep it `CHANGE_ME` to disable auth, but not recommended.
1. Save.

**2) Initialize the sheets**
1. In Apps Script, run `setup()` once.
1. Return to the Sheet: use menu `SM Planner ? Initialize / Repair Sheets` if needed.

**3) Deploy as Web App**
1. In Apps Script: Deploy ? New deployment.
1. Select type: Web app.
1. Execute as: Me.
1. Who has access: Anyone.
1. Deploy and copy the Web App URL.

**4) Configure frontend environment**
Update `.env` in the project root:

```
VITE_GS_BASE_URL=https://script.google.com/macros/s/AKfycbzyWsIY8nXiPjZSDQYdbLvhY16bjMWh6IIWlL_YFPYNdauHImirABTHl0DPVRo8ldkGow/exec
VITE_GS_API_KEY=CHANGE_ME
```

If `VITE_GS_BASE_URL` is empty, the app stays in local-only mode.

**5) Test your endpoint**
Use your Web App URL as `BASE_URL` below.

```bash
# Ping
curl "BASE_URL?action=ping&key=YOUR_API_KEY"

# Export full DB
curl "BASE_URL?action=export&key=YOUR_API_KEY"
```

**6) How syncing works in the app**
- On startup, the app pulls the full DB from Google Sheets and hydrates local storage.
- If Sheets are empty but local storage has data, the app pushes local data into Sheets (first-time bootstrap).
- On every change, local storage writes are batched and merged into Sheets using `import` with `mode=merge`.

**7) Common API calls**

All requests use `action` plus `table` when needed. For POST, send JSON.

```bash
# List all rows in a table
curl "BASE_URL?action=list&table=PLANNERS&key=YOUR_API_KEY"

# Get one row by primary key
curl "BASE_URL?action=get&table=USERS&id=user_id_value&key=YOUR_API_KEY"

# Upsert a row
curl -X POST "BASE_URL" \
  -H "Content-Type: application/json" \
  -d '{"action":"upsert","table":"USERS","key":"YOUR_API_KEY","row":{"user_id":"u1","name":"Alice","role":"ADMIN"}}'

# Bulk upsert
curl -X POST "BASE_URL" \
  -H "Content-Type: application/json" \
  -d '{"action":"bulkUpsert","table":"MEMBERS","key":"YOUR_API_KEY","rows":[{"member_id":"m1","name":"Sam"},{"member_id":"m2","name":"Lee"}]}'

# Delete by id
curl "BASE_URL?action=delete&table=MEMBERS&id=m1&key=YOUR_API_KEY"

# Export + import whole DB
curl "BASE_URL?action=export&key=YOUR_API_KEY"

curl -X POST "BASE_URL" \
  -H "Content-Type: application/json" \
  -d '{"action":"import","key":"YOUR_API_KEY","mode":"replace","db":{...}}'
```

**8) Data format notes**
- `PLANNERS.weeks` is stored as a JSON string in Sheets and returned as an array/object in API responses.
- `NOTIFICATIONS.meta` and `SETTINGS_REQUESTS.patch` are stored as JSON strings.
- `UNIT_SETTINGS.prefs` is stored as JSON (key/value in Sheets).
- Numeric fields (e.g., `PLANNERS.month`) are parsed to numbers; booleans to true/false.

**9) Troubleshooting**
- If you see `missing_sheet_*` errors: run `setup()` again.
- If you see `unauthorized`: confirm your `key` matches `CONFIG.API_KEY`.
- If JSON fields fail to parse: ensure the cell contains valid JSON text.
