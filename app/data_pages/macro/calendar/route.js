export const dynamic = 'force-dynamic';

import { getCached, setCache } from '../../_cache';
import { getText, fetchWithTimeout } from '../../_lib/http';

// Two parts, with different costs.
//
//   Calendar   Forex Factory's public weekly file: free, no key. It lists this
//              week's releases with impact, forecast and previous value. It
//              does not carry the actual figure, and there is no file for next
//              week until the weekend.
//
//   Surprise   Actual against forecast needs a feed that publishes actuals.
//              That is Financial Modeling Prep's economic calendar, which is
//              part of its paid plans. It switches on by itself when
//              FMP_API_KEY belongs to a plan that includes it. Until then the
//              response says surprise.available = false with the reason, and
//              the surprise index is empty, not zero.

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
  // FF answers 200 with an HTML page when it is rate-limiting, so the body is
  // checked before it is parsed.
  const text = await getText(FF_THISWEEK, {}, 8000);
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

// Returns { events, reason }. reason says why there are none.
async function fetchFMPEvents(KEY) {
  if (!KEY) return { events: [], reason: 'FMP_API_KEY is not set' };
  const today = new Date();
  const past = new Date(today); past.setDate(today.getDate() - 7);
  const future = new Date(today); future.setDate(today.getDate() + 21);
  const from = past.toISOString().slice(0, 10);
  const to = future.toISOString().slice(0, 10);
  try {
    const r = await fetchWithTimeout(`https://financialmodelingprep.com/stable/economic-calendar?from=${from}&to=${to}&apikey=${KEY}`, {}, 7000);
    if (!r.ok) {
      const paid = r.status === 402 || r.status === 403;
      return { events: [], reason: paid
        ? `Financial Modeling Prep refused the economic calendar (HTTP ${r.status}): the current plan does not include it`
        : `Financial Modeling Prep answered HTTP ${r.status}` };
    }
    const raw = await r.json();
    if (!Array.isArray(raw) || (raw[0] && raw[0]['Error Message'])) {
      return { events: [], reason: 'Financial Modeling Prep returned an error instead of a calendar (plan or key problem)' };
    }
    const events = raw
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
          actual, estimate, previous,
          impact: e.impact,
          surprisePct, direction,
          unit: e.unit || '',
        };
      });
    return { events, reason: events.length ? null : 'Financial Modeling Prep returned no medium or high impact events' };
  } catch (e) {
    return { events: [], reason: `Financial Modeling Prep did not answer (${e.message})` };
  }
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

  // Add the paid feed when the key's plan allows it. Events are keyed by
  // (hour + name) so one release is not listed twice.
  const fmp = await fetchFMPEvents(process.env.FMP_API_KEY);
  const fmpEvents = fmp.events;
  if (fmpEvents.length > 0) {
    const seen = new Set(events.map((e) => `${e.date.slice(0, 13)}|${e.event}`));
    for (const ev of fmpEvents) {
      const k = `${(ev.date || '').slice(0, 13)}|${ev.event}`;
      if (!seen.has(k)) events.push(ev);
    }
    if (events.length === fmpEvents.length) source = 'fmp';
    else source = 'forex-factory + fmp';
  }
  const withSurprise = events.filter((e) => e.surprisePct != null).length;
  const surprise = {
    available: withSurprise > 0,
    reason: withSurprise > 0 ? null
      : `No feed with actual figures is connected. ${fmp.reason || ''}. The free calendar carries forecasts only.`.replace('. .', '.'),
    howToEnable: 'Set FMP_API_KEY to a Financial Modeling Prep plan that includes the economic calendar. Nothing else needs to change.',
  };

  if (events.length === 0) {
    const empty = {
      upcoming: [], recent: [], citiProxy: null,
      counts: { beat: 0, miss: 0, inline: 0 },
      surprise,
      upcomingNote: 'The calendar feed is not answering right now.',
      source: 'unavailable',
      lastUpdated: new Date().toISOString(),
    };
    setCache('macro:calendar', empty, 5 * 60 * 1000);
    return Response.json(empty);
  }

  events.sort((a, b) => new Date(b.date) - new Date(a.date));

  const recentUSD = events.filter((e) => e.currency === 'USD' && e.surprisePct != null).slice(0, 12);
  // Empty when there is nothing to average. A zero here would read as "no surprise".
  const citiProxy = recentUSD.length > 0
    ? +(recentUSD.reduce((s, e) => s + Math.max(-50, Math.min(50, e.surprisePct)), 0) / recentUSD.length).toFixed(1)
    : null;

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
    surprise,
    upcomingNote: upcoming.length ? null
      : "No more medium or high impact releases this week. The free feed covers one week at a time; next week's list appears over the weekend.",
    source,
    lastUpdated: new Date().toISOString(),
  };
  setCache('macro:calendar', data, 30 * 60 * 1000);
  return Response.json(data);
}