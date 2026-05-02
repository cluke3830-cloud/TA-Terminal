export const dynamic = 'force-dynamic';

// Returns a Date pinned to the most recent realistic market activity:
//   - During regular session (9:30–16:00 ET, weekdays): now
//   - During pre/after-hours of a trading day: now (we want fresh extended bars)
//   - Outside trading hours (overnight, weekends, holidays):
//     last weekday's 8:00 PM ET (covers post-market through the close window)
// We approximate the ET offset; DST drift of ~1h doesn't matter since callers
// pull a multi-day window and Alpaca clamps to available bars.
function mostRecentMarketAnchor() {
  const now = new Date();
  const etOffsetHours = -5;
  const utcMs = now.getTime();
  const etMs = utcMs + etOffsetHours * 3600_000;
  const et = new Date(etMs);
  const day = et.getUTCDay();         // 0 = Sun, 6 = Sat
  const hour = et.getUTCHours();
  const inTradingWindow = day >= 1 && day <= 5 && hour >= 4 && hour < 20;
  if (inTradingWindow) return now;

  // Walk back to the most recent weekday and pin to 8:00 PM ET (end of post-market)
  const anchor = new Date(et);
  while (true) {
    const d = anchor.getUTCDay();
    if (d >= 1 && d <= 5) break;
    anchor.setUTCDate(anchor.getUTCDate() - 1);
  }
  // If we're early Monday morning before 4 AM ET, walk back to Friday
  if (anchor.getUTCDay() === et.getUTCDay() && hour < 4) {
    do {
      anchor.setUTCDate(anchor.getUTCDate() - 1);
    } while (anchor.getUTCDay() === 0 || anchor.getUTCDay() === 6);
  }
  anchor.setUTCHours(20, 0, 0, 0);
  return new Date(anchor.getTime() - etOffsetHours * 3600_000);
}

// US equity market hours in ET
function classifyMarket(lastBarMs) {
  const now = new Date();
  const etOffsetHours = -5; // simple ET approximation; chart only uses for color hint
  const utcHours = now.getUTCHours();
  const etHour = (utcHours + etOffsetHours + 24) % 24;
  const etMinutes = now.getUTCMinutes();
  const etDay = now.getUTCDay();
  const minutesSinceOpen = (etHour - 9) * 60 + (etMinutes - 30);
  const minutesSinceClose = (etHour - 16) * 60 + etMinutes;
  const isWeekend = etDay === 0 || etDay === 6;
  const ageMin = lastBarMs ? (Date.now() - lastBarMs) / 60_000 : Infinity;

  if (isWeekend) return 'closed';
  if (minutesSinceOpen >= 0 && minutesSinceClose < 0 && ageMin < 30) return 'open';
  if (etHour >= 4 && etHour < 9) return 'pre';
  if (etHour >= 16 && etHour < 20) return 'post';
  return 'closed';
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const symbol = (searchParams.get('symbol') || 'NVDA').toUpperCase();
  const timeframe = searchParams.get('timeframe') || '1Min';

  // tradingDays takes priority; legacy days param still supported for back-compat.
  // Caps raised to support user-configurable lookback up to ~1y intraday / ~5y daily.
  const tradingDaysParam = searchParams.get('tradingDays');
  const tradingDays = tradingDaysParam ? Math.min(parseInt(tradingDaysParam, 10) || 3, 252) : null;
  const calendarDays = tradingDays
    ? Math.ceil(tradingDays * 1.6 + 2)
    : Math.min(parseInt(searchParams.get('days') || '5', 10), 1825);

  const key = process.env.ALPACA_API_KEY;
  const secret = process.env.ALPACA_SECRET_KEY;
  if (!key || !secret) return Response.json({ error: 'Alpaca keys not set' }, { status: 500 });

  try {
    // Anchor `end` to the most recent NYSE close (4:00 PM ET, weekday) when the
    // market isn't currently in regular session. This way 1D/5D/1M selectors
    // always show the last completed trading day(s) instead of an empty window
    // on weekends, holidays, or pre-9:30 mornings. Includes 4 hours of after-
    // hours so post-market bars on the most recent session are visible.
    const end = mostRecentMarketAnchor();
    const start = new Date(end.getTime() - calendarDays * 864e5);
    const params = new URLSearchParams({
      start: start.toISOString(), end: end.toISOString(),
      timeframe, feed: 'iex', limit: '10000', sort: 'asc',
    });

    const res = await fetch(
      `https://data.alpaca.markets/v2/stocks/${encodeURIComponent(symbol)}/bars?${params}`,
      { headers: { 'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': secret } }
    );

    if (!res.ok) return Response.json({ error: `Alpaca: ${res.status}` }, { status: res.status });
    const data = await res.json();
    let bars = data.bars || [];

    if (tradingDays && bars.length > 0) {
      const sessionsSeen = [];
      const wantSessions = new Set();
      for (let i = bars.length - 1; i >= 0 && sessionsSeen.length < tradingDays; i--) {
        const day = bars[i].t.slice(0, 10);
        if (!wantSessions.has(day)) {
          wantSessions.add(day);
          sessionsSeen.push(day);
        }
      }
      bars = bars.filter((b) => wantSessions.has(b.t.slice(0, 10)));
    }

    const lastBar = bars[bars.length - 1];
    const lastBarMs = lastBar ? new Date(lastBar.t).getTime() : null;
    const marketStatus = classifyMarket(lastBarMs);
    const sessions = [...new Set(bars.map((b) => b.t.slice(0, 10)))];

    return Response.json({
      symbol,
      bars,
      count: bars.length,
      timeframe,
      sessions,
      lastBarTimestamp: lastBar?.t || null,
      marketStatus,
      feed: 'iex',
    });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}