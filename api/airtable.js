export default async function handler(req, res) {
  const token = process.env.AIRTABLE_TOKEN;
  if (!token) {
    res.status(500).json({ error: 'AIRTABLE_TOKEN is not set in environment variables' });
    return;
  }

  const baseId = process.env.AIRTABLE_BASE_ID || 'appcydvIpTaKuk8Gs';
  const tableId = process.env.AIRTABLE_TABLE_ID || 'tblhMrmyR3VvVwzGq';
  const offset = req.query.offset;

  const params = new URLSearchParams({ pageSize: '100' });
  if (offset) params.set('offset', offset);

  const url = `https://api.airtable.com/v0/${baseId}/${tableId}?${params}`;

  try {
    const airtableRes = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const body = await airtableRes.text();
    res.status(airtableRes.status);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.send(body);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}
