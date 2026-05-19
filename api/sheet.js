// Google Sheets serverless proxy — keeps the service account key server-side.
// Reads the Sales Tracking tab and returns rows shaped exactly like the
// SALES_TRACKING const baked into the dashboard by refresh_sales_tracking.py.
//
// Each row: { d, c, pp, k, u, e, sp }
//   d  = sale date (YYYY-MM-DD)
//   c  = cash collected (col L)
//   pp = is payment plan (col M contains "PAYMENT PLAN")
//   k  = contract value (col M numeric, fallback col J)
//   u  = is unit (1 if not PP)
//   e  = client email (col E lowercased)
//   sp = salesperson first name (col H first word, lowercased)
//
// Env vars:
//   GOOGLE_SERVICE_ACCOUNT — full service-account JSON as a string
//   SHEET_ID (optional)    — defaults to the Sales Call Tracking 2025 sheet
//   SHEET_RANGE (optional) — defaults to "Sales Tracking!A2:M2000"

import crypto from 'crypto';

const DEFAULT_SHEET_ID = '19BQT8ki2WcTjJyhT_RRwy6_VoHAFRhbdqarJR37Kznc';
const DEFAULT_RANGE = 'Sales Tracking!A2:M2000';

// === Helpers ported from refresh_sales_tracking.py ===

function toNum(s) {
  if (s == null) return 0;
  const cleaned = String(s).replace(/[$,]/g, '').trim();
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

function firstName(full) {
  if (!full) return '';
  const parts = String(full).trim().split(/\s+/);
  return parts[0] ? parts[0].toLowerCase() : '';
}

// Port of parse_date(): handles the M/D/YYYY [H:MM[:SS] [AM/PM]] variants
// the sheet uses, plus the verbose "Monday, April 6, 2026 8:30 PM" fallback.
const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

function parseDate(s) {
  if (!s) return null;
  s = String(s).trim();
  if (!s) return null;

  // M/D/YYYY (with optional time) — most common in this sheet
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    let [, mo, da, yr] = m;
    if (yr.length === 2) yr = (parseInt(yr, 10) < 70 ? '20' : '19') + yr;
    return `${yr}-${mo.padStart(2, '0')}-${da.padStart(2, '0')}`;
  }

  // "Monday, April 6, 2026 ..." or "April 6, 2026 ..."
  m = s.match(/(?:[A-Za-z]+,\s*)?([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/);
  if (m) {
    const mo = MONTHS[m[1].toLowerCase()];
    if (mo) {
      return `${m[3]}-${String(mo).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
    }
  }

  return null;
}

function buildSalesSnapshot(values) {
  const out = [];
  for (const r of values || []) {
    const d = parseDate(r[2]);
    if (!d) continue;
    const clientEmail = String(r[4] || '').trim().toLowerCase();
    const salespersonName = r[7] || '';
    const saleValue = toNum(r[9]);
    const cash = toNum(r[11]);
    const mRaw = String(r[12] || '').trim();
    const isPP = mRaw.toUpperCase().includes('PAYMENT PLAN');
    let contract, isUnit;
    if (isPP) {
      contract = 0;
      isUnit = 0;
    } else {
      const n = toNum(mRaw);
      contract = n > 0 ? n : saleValue;
      isUnit = 1;
    }
    out.push({
      d,
      c: cash,
      pp: isPP,
      k: contract,
      u: isUnit,
      e: clientEmail,
      sp: firstName(salespersonName),
    });
  }
  out.sort((a, b) => a.d.localeCompare(b.d));
  return out;
}

// === Service-account auth (no npm deps) ===

function b64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claim))}`;
  const sig = crypto.sign('RSA-SHA256', Buffer.from(unsigned), sa.private_key);
  const jwt = `${unsigned}.${b64url(sig)}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  const data = await res.json();
  if (!data.access_token) {
    throw new Error(`OAuth failed: ${JSON.stringify(data).slice(0, 200)}`);
  }
  return data.access_token;
}

// === Handler ===

export default async function handler(req, res) {
  const saJson = process.env.GOOGLE_SERVICE_ACCOUNT;
  if (!saJson) {
    res.status(500).json({ error: 'GOOGLE_SERVICE_ACCOUNT env var is not set' });
    return;
  }
  let sa;
  try {
    sa = JSON.parse(saJson);
  } catch (e) {
    res.status(500).json({ error: 'GOOGLE_SERVICE_ACCOUNT is not valid JSON' });
    return;
  }
  if (!sa.client_email || !sa.private_key) {
    res.status(500).json({ error: 'Service account JSON missing client_email or private_key' });
    return;
  }

  const sheetId = process.env.SHEET_ID || DEFAULT_SHEET_ID;
  const range = process.env.SHEET_RANGE || DEFAULT_RANGE;

  try {
    const token = await getAccessToken(sa);
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`;
    const sheetRes = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!sheetRes.ok) {
      const body = await sheetRes.text();
      res.status(sheetRes.status).json({
        error: `Sheets API ${sheetRes.status}`,
        body: body.slice(0, 300),
      });
      return;
    }
    const data = await sheetRes.json();
    const rows = buildSalesSnapshot(data.values);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ rows, fetchedAt: new Date().toISOString() });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}
