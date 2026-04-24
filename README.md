# Sales Dashboard

Live sales leaderboard for Jay Sales OS, pulling EOD report data from Airtable.

## Deployment (Vercel)

1. Push this repo to GitHub (private).
2. Import the repo into Vercel (https://vercel.com/new).
3. Set one environment variable in Vercel project settings:
   - `AIRTABLE_TOKEN` — personal access token with `data.records:read` on the Jay Sales OS base.
4. Deploy. Visit the Vercel URL to view the dashboard.

Optional overrides (if the base or table IDs change):
- `AIRTABLE_BASE_ID`
- `AIRTABLE_TABLE_ID`

## Architecture

- `index.html` — static dashboard UI, no secrets.
- `api/airtable.js` — Vercel Serverless Function that proxies Airtable list-records requests, injecting the token server-side.

The browser never sees the Airtable token.
