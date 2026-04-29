import { getCached, setCache } from '../../_cache';

// Forex Factory's public JSON feed: free, no auth, no daily quota.
// This is the same dataset professional FX traders rely on, with
// High/Medium/Low impact ratings, forecast, previous, and actual values
// once an event releases. We use it as primary, with FMP as enrichment
// for the days where the feed doesn't yet have actuals.

const FF_THISWEEK = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';

const CC_FLAG = {
  USD: '🇺🇸', EUR: '🇪🇺', JPY: '🇯🇵', GBP: '🇬🇧', CNY: '🇨🇳', AUD: '🇦🇺',
  CAD: '🇨🇦', CHF: '🇨🇭', NZD: '🇳🇿', SEK: '🇸🇪', NOK: '🇳🇴', BRL: '🇧🇷',
  INR: '🇮🇳', KRW: '🇰🇷', MXN: '🇲🇽', ZAR: '🇿🇦', HKD: '🇭🇰', SGD: '🇸🇬',
};

function parseNum(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  const s = String(v).replace(/[^\d.\-]/g, '');
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function normalizeImpact(impact) {
  if (!impact) return 'Low';
  const i = String(impact).toLowerCase();
  if (i.includes('high')) return 'High';
  if (i.includes('medium')) return 'Medium';
  if (i.includes('holiday')) return 'Holiday';
  return 'Low';
}

function deriveSurprise(actual, estimate) {
  if (actual == null || estimate == null) return { surprisePct: null, direction: 'pending' };
  let surprisePct;
  if (estimate === 0) {
    surprisePct = actual === 0 ? 0 : (actual > 0 ? 100 : -100);
  } else {
    surprisePct = ((actual - estimate) / Math.abs(estimate)) * 100;
  }
  let direction;
  if (surprisePct > 2) direction = 'beat';
  else if (surprisePct < -2) direction = 'miss';
  else direction = 'inline';
  return { surprisePct: +surprisePct.toFixed(1), direction };
}

async function fetchFFEvents() {
  const r = await fetch(FF_THISWEEK, {
    cache: 'no-store',
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; QuantumTerminal/1.0)' },
  });
  if (!r.ok) throw new Error(`Forex Factory: ${r.status}`);
  // FF responds 200 + HTML when rate-limited, so check content before parsing.
  const text = await r.text();
  if (!text.startsWith('[') && !text.startsWith('{')) {
    throw new Error('Forex Factory: rate-limited or non-JSON response');
  }
  const raw = JSON.parse(text);
  if (!Array.isArray(raw)) throw new Error('Forex Factory: unexpected shape');

  return raw
    .filter((e) => e.title && e.date && normalizeImpact(e.impact) !== 'Holiday')
    .map((e) => {
      const actual = parseNum(e.actual);
      const estimate = parseNum(e.forecast);
      const previous = parseNum(e.previous);
      const { surprisePct, direction } = deriveSurprise(actual, estimate);
      const cur = (e.country || '').toUpperCase();
      return {
        date: e.date, // ISO with timezone
        country: cur,
        currency: cur,
        flag: CC_FLAG[cur] || '🌐',
        event: e.title,
        actual,
        estimate,
        previous,
        impact: normalizeImpact(e.impact),
        surprisePct,
        direction,
        unit: e.unit || '',
      };
    });
}

async function fetchFMPEvents(KEY) {
  if (!KEY) return [];
  const today = new Date();
  const past = new Date(today); past.setDate(today.getDate() - 7);
  const future = new Date(today); future.setDate(today.getDate() + 21);
  const from = past.toISOString().slice(0, 10);
  const to = future.toISOString().slice(0, 10);
  try {
    const r = await fetch(`https://financialmodelingprep.com/stable/economic-calendar?from=${from}&to=${to}&apikey=${KEY}`, { cache: 'no-store' });
    if (!r.ok) return [];
    const raw = await r.json();
    if (!Array.isArray(raw) || (raw[0] && raw[0]['Error Message'])) return [];
    return raw
      .filter((e) => e.event && (e.impact === 'High' || e.impact === 'Medium'))
      .map((e) => {
        const actual = parseNum(e.actual);
        const estimate = parseNum(e.estimate);
        const previous = parseNum(e.previous);
        const { surprisePct, direction } = deriveSurprise(actual, estimate);
        const cur = (e.currency || '').toUpperCase();
        return {
          date: e.date,
          country: e.country || cur,
          currency: cur,
          flag: CC_FLAG[cur] || '🌐',
          event: e.event,
          actual,
          estimate,
          previous,
          impact: e.impact,
          surprisePct,
          direction,
          unit: e.unit || '',
        };
      });
  } catch (_) { return []; }
}

export async function GET() {
  const cached = getCached('macro:calendar');
  if (cached) return Response.json(cached);

  let events = [];
  let source = 'forex-factory';
  try {
    events = await fetchFFEvents();
  } catch (e) {
    // Fall through to FMP-only path
    events = [];
  }

  // Enrich with FMP if quota allows. Each FMP event is keyed by (date+event)
  // so we don't double-count events already in the FF feed.
  const fmpEvents = await fetchFMPEvents(process.env.FMP_API_KEY);
  if (fmpEvents.length > 0) {
    const seen = new Set(events.map((e) => `${e.date.slice(0, 13)}|${e.event}`));
    for (const ev of fmpEvents) {
      const k = `${(ev.date || '').slice(0, 13)}|${ev.event}`;
      if (!seen.has(k)) events.push(ev);
    }
    if (events.length === fmpEvents.length) source = 'fmp';
    else source = 'forex-factory + fmp';
  }

  if (events.length === 0) {
    // Still return a valid empty response so the UI doesn't break.
    // Negative-cache for 5 min so we don't hammer FF/FMP on every request.
    const empty = {
      upcoming: [], recent: [], citiProxy: 0,
      counts: { beat: 0, miss: 0, inline: 0 },
      source: 'unavailable',
      lastUpdated: new Date().toISOString(),
    };
    setCache('macro:calendar', empty, 5 * 60 * 1000);
    return Response.json(empty);
  }

  events.sort((a, b) => new Date(b.date) - new Date(a.date));

  const recentUSD = events.filter((e) => e.currency === 'USD' && e.surprisePct != null).slice(0, 12);
  const citiProxy = recentUSD.length > 0
    ? +(recentUSD.reduce((s, e) => s + Math.max(-50, Math.min(50, e.surprisePct)), 0) / recentUSD.length).toFixed(1)
    : 0;

  const todayMs = new Date().setHours(0, 0, 0, 0);
  const upcoming = events
    .filter((e) => new Date(e.date).getTime() >= todayMs && e.impact !== 'Low')
    .reverse()
    .slice(0, 60);
  const recent = events.filter((e) => e.surprisePct != null).slice(0, 30);

  const data = {
    upcoming,
    recent,
    citiProxy,
    counts: {
      beat: events.filter((e) => e.direction === 'beat').length,
      miss: events.filter((e) => e.direction === 'miss').length,
      inline: events.filter((e) => e.direction === 'inline').length,
    },
    source,
    lastUpdated: new Date().toISOString(),
  };
  setCache('macro:calendar', data, 30 * 60 * 1000);
  return Response.json(data);
}