// GHL serverless proxy — keeps the API key server-side.
// Returns this week's (Mon–Sun) calendar bookings per closer.

const LOCATION_ID = 'YB8rMdFShcHGcZGW87mA';

// Active sales-call calendars (closer pipeline)
const SALES_CALENDARS = [
  { name: 'Lead Gen Consultation',     id: 'FeAyFFzjGjTw3uf8ag1R' },
  { name: 'Work with Lead Gen Jay',    id: 'tVt4mXTVI8sY562RHqCn' },
  { name: 'Custom Lead Gen Buildout',  id: 'e3EI7ccDh6RGW6wJT5cr' },
  { name: 'LGJ Business Consultation', id: 'St1hoWfjvD9DtOuxXMU9' },
  { name: 'Easter Sale',               id: 'Nhwr6i5OIQBdl2TD5Gxx' }
];

// Closer userId → display name. Add new closers here as the team grows.
const USER_MAP = {
  'KE6rxzuoZbT8CNoYMiWw': 'Jonathan Walker',
  'yBiXFlZqWePl7cjA8d0F': 'Tyler Hoff',
  'Fu6c4vRIKHCKubzAsKdG': 'Ian Kirk',
  'CBDBxhhrhFS0SrqfaIR5': 'Daniel Hussain',
  'YFddLNRHv11vxxAc9ymq': 'Jordan Wiseman',
  'cXu1htFR4UHQMMAYFUl4': 'Mason Church',
  'D3tZrMJLaX40k5lZAFMi': 'Jay Feldman',
  'Lztu5FOHOQi4ODLRLDmq': 'Kevin Just',
  'UIo3KaDw85MruXxrctyT': 'Kevin Farrugia',
  '52w7WFl4Hn6r04iEZY7s': 'Michael Hernandez'
};

// Compute Mon 00:00 → next Mon 00:00 (UTC-based, good enough for week-bucket purposes)
function currentWeekRange() {
  const now = new Date();
  const dow = now.getUTCDay(); // 0 Sun .. 6 Sat
  const daysFromMon = dow === 0 ? 6 : dow - 1;
  const monday = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysFromMon, 0, 0, 0, 0
  ));
  const nextMonday = new Date(monday.getTime() + 7 * 24 * 60 * 60 * 1000);
  return { start: monday.getTime(), end: nextMonday.getTime(), startISO: monday.toISOString(), endISO: nextMonday.toISOString() };
}

export default async function handler(req, res) {
  const token = process.env.GHL_API_KEY;
  if (!token) {
    res.status(500).json({ error: 'GHL_API_KEY is not set in environment variables' });
    return;
  }

  const { start, end, startISO, endISO } = currentWeekRange();
  const nowMs = Date.now();

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Version': '2021-04-15',
    'Accept': 'application/json'
  };

  try {
    // Fetch all sales calendars in parallel
    const results = await Promise.all(SALES_CALENDARS.map(async (cal) => {
      const url = `https://services.leadconnectorhq.com/calendars/events?locationId=${LOCATION_ID}&calendarId=${cal.id}&startTime=${start}&endTime=${end}`;
      try {
        const r = await fetch(url, { headers });
        if (!r.ok) {
          return { calendar: cal.name, events: [], error: `HTTP ${r.status}` };
        }
        const data = await r.json();
        return { calendar: cal.name, events: data.events || [] };
      } catch (e) {
        return { calendar: cal.name, events: [], error: e.message };
      }
    }));

    // Aggregate per closer
    const perCloser = {};
    let totalEvents = 0;
    for (const result of results) {
      for (const e of result.events) {
        totalEvents++;
        const uid = e.assignedUserId || 'UNASSIGNED';
        const name = USER_MAP[uid] || `Unknown (${uid.slice(0, 6)})`;
        if (!perCloser[name]) {
          perCloser[name] = { name, userId: uid, upcoming: 0, done: 0, cancelled: 0 };
        }
        const status = e.appointmentStatus || '';
        const stMs = e.startTime ? new Date(e.startTime).getTime() : 0;
        if (status === 'cancelled') perCloser[name].cancelled++;
        else if (stMs > nowMs) perCloser[name].upcoming++;
        else perCloser[name].done++;
      }
    }

    const closers = Object.values(perCloser).sort((a, b) => b.upcoming - a.upcoming);
    const totals = closers.reduce(
      (acc, c) => ({
        upcoming: acc.upcoming + c.upcoming,
        done: acc.done + c.done,
        cancelled: acc.cancelled + c.cancelled
      }),
      { upcoming: 0, done: 0, cancelled: 0 }
    );

    res.status(200);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.json({
      closers,
      totals,
      totalEvents,
      weekStart: startISO,
      weekEnd: endISO,
      updatedAt: new Date().toISOString(),
      calendarsQueried: SALES_CALENDARS.map(c => c.name),
      perCalendarErrors: results.filter(r => r.error).map(r => ({ calendar: r.calendar, error: r.error }))
    });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}
