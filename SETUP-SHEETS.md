# Setup: live data refresh (Vercel env vars)

The dashboard's three team-wide tiles — **Contract Value**, **New Cash Collected**,
**Total Cash Collected** — pull from the "Sales Tracking" tab of the
**Sales Call Tracking 2025** sheet
(`19BQT8ki2WcTjJyhT_RRwy6_VoHAFRhbdqarJR37Kznc`). All per-rep KPIs continue to
pull from Airtable.

Both data sources auto-refresh every 10 minutes via Vercel serverless proxies
(`/api/sheet` and `/api/airtable`). To activate, **two env vars** need to be set
in Vercel: `AIRTABLE_TOKEN` and `GOOGLE_SERVICE_ACCOUNT`. One-time setup, ~10 min total.

## 0. Set AIRTABLE_TOKEN in Vercel (quick — do this first)

The previously-embedded Airtable PAT was removed from the HTML (GitHub's secret
scanning flagged it). The `/api/airtable` proxy reads it from an env var instead.

1. Open Vercel project settings: <https://vercel.com/dashboard> → Sales-Dashboard-LGJ → **Settings** → **Environment Variables**.
2. Add:
   - **Name:** `AIRTABLE_TOKEN`
   - **Value:** the Airtable PAT (Mason has this — was previously embedded in HTML before this commit; see chat handoff or generate a fresh one in Airtable settings)
   - **Environments:** Production, Preview, Development.
3. Save. (You'll redeploy in step 5 below alongside the Sheets env var.)

> ⚠️ **Rotate this token soon.** It's been in public git history since the repo
> was created. Generate a new PAT in Airtable
> (<https://airtable.com/create/tokens>) with `data.records:read` on the Jay
> Sales OS base, paste the new value into Vercel, and revoke the old token. The
> dashboard will work either way — proxy doesn't care which token, just that
> one exists.

## 1. Create the service account

1. Open the GCP console: <https://console.cloud.google.com/iam-admin/serviceaccounts?project=stellar-arcadia-493623-d7>
   (this is the same project the `gws` CLI is authed against — reuse it).
2. Click **+ CREATE SERVICE ACCOUNT**.
3. Name it `sales-dashboard-sheet-reader` (description: "Read-only access to Sales Tracking sheet for the live dashboard").
4. Skip the optional role grant on step 2 (the service account doesn't need any
   IAM role — it just needs the sheet shared with it, see step 4 below).
5. Click **Done**.

## 2. Enable the Sheets API on the project

1. Go to <https://console.cloud.google.com/apis/library/sheets.googleapis.com?project=stellar-arcadia-493623-d7>.
2. Click **Enable** (or "Manage" if it's already enabled — nothing to change).

## 3. Generate a JSON key

1. On the service-account list, click into `sales-dashboard-sheet-reader`.
2. Open the **KEYS** tab → **ADD KEY** → **Create new key** → **JSON** → **Create**.
3. A JSON file downloads. Keep this safe — it's the only copy.

The JSON file looks like:

```json
{
  "type": "service_account",
  "project_id": "stellar-arcadia-493623-d7",
  "client_email": "sales-dashboard-sheet-reader@stellar-arcadia-493623-d7.iam.gserviceaccount.com",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
  ...
}
```

Copy the `client_email` — you'll need it in the next step.

## 4. Share the sheet with the service account

1. Open the sheet: <https://docs.google.com/spreadsheets/d/19BQT8ki2WcTjJyhT_RRwy6_VoHAFRhbdqarJR37Kznc/edit>.
2. Click **Share** (top right).
3. Paste the `client_email` from the JSON key.
4. Set permission to **Viewer**.
5. **Uncheck "Notify people"** (service accounts don't have inboxes).
6. Click **Share**.

## 5. Paste the JSON into Vercel as an env var

1. Open Vercel project settings: <https://vercel.com/dashboard> → Sales-Dashboard-LGJ → **Settings** → **Environment Variables**.
2. Add a new variable:
   - **Name:** `GOOGLE_SERVICE_ACCOUNT`
   - **Value:** the **entire contents** of the downloaded JSON file, pasted as-is
     (Vercel handles the newlines in `private_key` correctly).
   - **Environments:** check Production, Preview, and Development.
3. Save.
4. Redeploy: Vercel → Deployments → **⋯** on latest → **Redeploy**.
   (Env var changes don't auto-redeploy.)

## 6. Verify

Open `https://<your-vercel-url>/api/sheet` directly in the browser. You should see
JSON like:

```json
{ "rows": [{"d":"2025-05-21","c":3750,"pp":false,"k":7500,...}, ...], "fetchedAt": "..." }
```

If you see `{ "error": "GOOGLE_SERVICE_ACCOUNT env var is not set" }`, the env var
didn't get applied — check step 5 and redeploy.

If you see `{ "error": "OAuth failed: ..." }`, the JSON is malformed or the
private key is corrupted — re-paste from the original download.

If you see `{ "error": "Sheets API 403", "body": "..." }`, the sheet wasn't
shared with the service account — revisit step 4.

## Fallback behavior

The dashboard always has a baked-in `SALES_TRACKING` snapshot (refreshed daily at
7AM by the local cron in `~/Code/sales-dashboard/scripts/refresh_sales_tracking.py`).
If `/api/sheet` errors for any reason, the dashboard silently falls back to that
snapshot — you'll see slightly stale data but the dashboard still works.

## Local development

When you open `sales-dashboard.html` directly via `file://`, there is no server,
so `/api/sheet` 404s and the dashboard uses the baked-in snapshot. Live refresh
only works on the Vercel-hosted URL.

To preview the live behavior locally, run:
```
cd ~/Code/sales-dashboard-deploy
npx vercel dev
```
This boots Vercel's local dev server with the serverless functions running.
You'll need the `GOOGLE_SERVICE_ACCOUNT` env var available locally too — easiest
is `npx vercel env pull` to mirror Vercel's prod env into a local `.env`.
