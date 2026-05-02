import { getCached, setCache } from '../../_cache';

// Calendar source strategy:
//   1. Forex Factory's free "this week" JSON feed — covers Mon→Sun with
//      forecasts, actuals, and impact ratings. Strong when we're mid-week.
//   2. FRED releases API — authoritative forward-looking schedule for the
//      most-watched US macro releases (CPI, NFP, FOMC, PPI, GDP, PCE,
//      Retail Sales, etc.). Fills the gap when FF's window has rolled past
//      its last event (Saturdays/Sundays before next week is published).
//   3. FMP economic-calendar — premium-only on the free FMP tier in 2026,
//      so we treat it as best-effort enrichment only.

const FF_THISWEEK = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';

const CC_FLAG = {
  USD: '🇺🇸', EUR: '🇪🇺', JPY: '🇯🇵', GBP: '🇬🇧', CNY: '🇨🇳', AUD: '🇦🇺',
  CAD: '🇨🇦', CHF: '🇨🇭', NZD: '🇳🇿', SEK: '🇸🇪', NOK: '🇳🇴', BRL: '🇧🇷',
  INR: '🇮🇳', KRW: '🇰🇷', MXN: '🇲🇽', ZAR: '🇿🇦', HKD: '🇭🇰', SGD: '🇸🇬',
};

// Real-browser UA — FairEconomy's CDN refuses some custom agents.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36';

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
  try {
    const r = await fetch(FF_THISWEEK, {
      cache: 'no-store',
      headers: { 'User-Agent': UA, Accept: 'application/json,*/*' },
    });
    if (!r.ok) return [];
    const text = await r.text();
    if (!text.startsWith('[') && !text.startsWith('{')) return [];
    const raw = JSON.parse(text);
    if (!Array.isArray(raw)) return [];

    return raw
      .filter((e) => e.title && e.date && normalizeImpact(e.impact) !== 'Holiday')
      .map((e) => {
        const actual = parseNum(e.actual);
        const estimate = parseNum(e.forecast);
        const previous = parseNum(e.previous);
        const { surprisePct, direction } = deriveSurprise(actual, estimate);
        const cur = (e.country || '').toUpperCase();
        return {
          date: e.date,
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
  } catch (_) { return []; }
}

// Filter FRED's release schedule down to the macro events traders actually
// watch. The full FRED feed includes daily noise (Coinbase prices, S&P
// Composite, etc.); we want only meaningful US macro prints.
const FRED_RELEASE_PATTERNS = [
  { re: /\bFOMC\b|Federal Open Market/i, impact: 'High' },
  { re: /Consumer Price Index|^CPI\b/i, impact: 'High' },
  { re: /Producer Price Index|^PPI\b/i, impact: 'High' },
  { re: /Employment Situation|Nonfarm|Unemployment Rate|JOLTS/i, impact: 'High' },
  { re: /Personal Income.*Outlays|PCE/i, impact: 'High' },
  { re: /Gross Domestic Product|^GDP\b/i, impact: 'High' },
  { re: /Retail Sales/i, impact: 'High' },
  { re: /Industrial Production|Capacity Utilization/i, impact: 'Medium' },
  { re: /Housing Starts|Existing Home Sales|New Home Sales|Pending Home/i, impact: 'Medium' },
  { re: /ISM Manufacturing|ISM Services|ISM Non-Manufacturing/i, impact: 'High' },
  { re: /Consumer Confidence|Consumer Sentiment/i, impact: 'Medium' },
  { re: /Durable Goods/i, impact: 'Medium' },
  { re: /Trade Balance/i, impact: 'Medium' },
  { re: /FOMC Press Release|FOMC Minutes|FOMC Projections/i, impact: 'High' },
  { re: /Beige Book/i, impact: 'Medium' },
  { re: /Initial Claims/i, impact: 'Medium' },
];

async function fetchFREDReleases(KEY) {
  if (!KEY) return [];
  try {
    const today = new Date();
    const future = new Date(today); future.setDate(today.getDate() + 30);
    const past = new Date(today); past.setDate(today.getDate() - 7);
    const params = new URLSearchParams({
      api_key: KEY,
      file_type: 'json',
      include_release_dates_with_no_data: 'true',
      realtime_start: past.toISOString().slice(0, 10),
      realtime_end: future.toISOString().slice(0, 10),
      order_by: 'release_date',
      sort_order: 'asc',
      limit: '1000',
    });
    const r = await fetch(`https://api.stlouisfed.org/fred/releases/dates?${params}`, { cache: 'no-store' });
    if (!r.ok) return [];
    const j = await r.json();
    const rows = j.release_dates || [];

    // FRED reports the same release_name on every business day it's "active",
    // not just the day it actually drops. To turn that into a usable
    // calendar, keep one event per (release_name + ISO week) — the earliest
    // future date in that window. Past dates are used to anchor "this week"
    // entries so the recent tab is non-empty during the day a release fires.
    const todayKey = new Date().toISOString().slice(0, 10);
    const bestPerNameWeek = new Map();
    for (const row of rows) {
      const name = row.release_name || '';
      const match = FRED_RELEASE_PATTERNS.find((p) => p.re.test(name));
      if (!match) continue;
      const d = new Date(`${row.date}T00:00:00Z`);
      // ISO week key: YYYY-WW (rough, fine for grouping)
      const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      const weekNum = Math.floor((d - yearStart) / 86400000 / 7);
      const weekKey = `${name}|${d.getUTCFullYear()}-W${weekNum}`;
      const existing = bestPerNameWeek.get(weekKey);
      // Prefer earliest future date; if none, latest past date in this week
      if (!existing) {
        bestPerNameWeek.set(weekKey, { row, name, impact: match.impact });
      } else {
        const cur = existing.row.date;
        const newer = row.date;
        const curIsFuture = cur >= todayKey;
        const newIsFuture = newer >= todayKey;
        if (newIsFuture && (!curIsFuture || newer < cur)) {
          bestPerNameWeek.set(weekKey, { row, name, impact: match.impact });
        } else if (!curIsFuture && !newIsFuture && newer > cur) {
          bestPerNameWeek.set(weekKey, { row, name, impact: match.impact });
        }
      }
    }

    return [...bestPerNameWeek.values()].map(({ row, name, impact }) => ({
      date: `${row.date}T08:30:00-05:00`, // most US macro releases drop at 8:30 AM ET
      country: 'USD',
      currency: 'USD',
      flag: '🇺🇸',
      event: name,
      actual: null,
      estimate: null,
      previous: null,
      impact,
      surprisePct: null,
      direction: 'pending',
      unit: '',
    }));
  } catch (_) { return []; }
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

function dedupe(events) {
  const seen = new Map();
  for (const e of events) {
    const k = `${(e.date || '').slice(0, 13)}|${e.event}`;
    const existing = seen.get(k);
    // Prefer the entry with actuals filled in (FF/FMP > FRED schedule)
    if (!existing || (e.actual != null && existing.actual == null)) seen.set(k, e);
  }
  return [...seen.values()];
}

export async function GET() {
  const cached = getCached('macro:calendar');
  if (cached) return Response.json(cached);

  const [ffEvents, fmpEvents, fredEvents] = await Promise.all([
    fetchFFEvents(),
    fetchFMPEvents(process.env.FMP_API_KEY),
    fetchFREDReleases(process.env.FRED_API_KEY),
  ]);

  const sources = [];
  if (ffEvents.length) sources.push('forex-factory');
  if (fmpEvents.length) sources.push('fmp');
  if (fredEvents.length) sources.push('fred-releases');

  let events = dedupe([...ffEvents, ...fmpEvents, ...fredEvents]);

  if (events.length === 0) {
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
    source: sources.join(' + ') || 'unavailable',
    lastUpdated: new Date().toISOString(),
  };
  setCache('macro:calendar', data, 30 * 60 * 1000);
  return Response.json(data);
}