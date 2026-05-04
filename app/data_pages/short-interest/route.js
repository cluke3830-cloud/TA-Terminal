export const dynamic = 'force-dynamic';

import { getCached, setCache } from '../_cache';
import YahooFinance from 'yahoo-finance2';

const yahoo = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });
const FMP = 'https://financialmodelingprep.com';
const SIX_HOURS = 6 * 60 * 60 * 1000;

async function tryFmp(paths) {
  for (const url of paths) {
    try {
      const r = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!r.ok) continue;
      const j = await r.json();
      if (j && (Array.isArray(j) ? j.length > 0 : Object.keys(j).length > 0)) return j;
    } catch { /* next */ }
  }
  return null;
}

// Fetch 90-day adjusted-close series for the price overlay in the card.
async function yahooPrice90d(symbol) {
  try {
    const end = new Date();
    const start = new Date(end.getTime() - 92 * 24 * 60 * 60 * 1000);
    const hist = await yahoo.historical(symbol, {
      period1: start.toISOString().slice(0, 10),
      period2: end.toISOString().slice(0, 10),
    });
    return hist
      .map((d) => ({
        date: d.date instanceof Date ? d.date.toISOString().slice(0, 10) : String(d.date).slice(0, 10),
        close: +(d.adjClose ?? d.close ?? 0),
      }))
      .filter((d) => d.close > 0)
      .sort((a, b) => a.date.localeCompare(b.date));
  } catch { return []; }
}

// Yahoo defaultKeyStatistics already exposes shortPercentOfFloat,
// sharesShort, sharesShortPriorMonth, shortRatio. We use that as the
// authoritative free source and bolt on FMP biweekly history when available.
async function yahooShort(symbol) {
  try {
    const m = await yahoo.quoteSummary(symbol, {
      modules: ['defaultKeyStatistics', 'summaryDetail', 'price'],
    });
    const ks = m?.defaultKeyStatistics || {};
    const sd = m?.summaryDetail || {};
    const num = (v) => v?.raw ?? (typeof v === 'number' ? v : null);
    // dateShortInterest can be a Date instance (yahoo-finance2 v3+), a string,
    // or epoch seconds depending on the symbol — defend against all three.
    const parseDate = (v) => {
      if (!v) return null;
      if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10);
      if (typeof v === 'string') return v.slice(0, 10);
      if (typeof v === 'number' && isFinite(v)) {
        const ms = v > 1e12 ? v : v * 1000;
        const d = new Date(ms);
        return isNaN(d) ? null : d.toISOString().slice(0, 10);
      }
      if (typeof v?.fmt === 'string') return v.fmt.slice(0, 10);
      return null;
    };
    return {
      sharesShort: num(ks.sharesShort),
      sharesShortPriorMonth: num(ks.sharesShortPriorMonth),
      shortPercentOfFloat: num(ks.shortPercentOfFloat),
      shortRatio: num(ks.shortRatio),                  // days-to-cover, Yahoo's number
      sharesOutstanding: num(ks.sharesOutstanding),
      floatShares: num(ks.floatShares),
      avgVol10d: num(sd.averageDailyVolume10Day) || num(sd.averageVolume10days),
      avgVol3mo: num(sd.averageDailyVolume3Month) || num(sd.averageVolume),
      lastDate: parseDate(ks.dateShortInterest),
    };
  } catch { return null; }
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const symbol = (searchParams.get('symbol') || '').toUpperCase();
  if (!symbol) return Response.json({ error: 'symbol required' }, { status: 400 });

  const cacheKey = `short:${symbol}`;
  const cached = getCached(cacheKey);
  if (cached) return Response.json(cached);

  const key = process.env.FMP_API_KEY;
  const [yh, fmpHist, prices] = await Promise.all([
    yahooShort(symbol),
    key ? tryFmp([
      `${FMP}/stable/short-interest?symbol=${symbol}&limit=24&apikey=${key}`,
      `${FMP}/api/v4/short-interest?symbol=${symbol}&limit=24&apikey=${key}`,
    ]) : null,
    yahooPrice90d(symbol),
  ]);

  if (!yh && !fmpHist) {
    const empty = { symbol, source: 'unavailable', current: {}, history: [], ts: new Date().toISOString() };
    setCache(cacheKey, empty, 30 * 60 * 1000);
    return Response.json(empty);
  }

  // Normalize FMP biweekly history if present.
  const history = (fmpHist || []).map((h) => {
    const si = +(h.shortInterest ?? h.shares ?? 0);
    const float = +(h.floatShares ?? h.publicFloat ?? 0);
    const avgVol = +(h.averageDailyVolume ?? h.avgDailyVolume ?? 0);
    const dtc = avgVol > 0 ? si / avgVol : null;
    const pctFloat = float > 0 ? si / float : null;
    return {
      date: h.date || h.settlementDate || h.recordDate || null,
      shortInterest: isFinite(si) ? si : null,
      floatShares: isFinite(float) ? float : null,
      pctOfFloat: pctFloat,
      daysToCover: dtc,
      avgVolume: isFinite(avgVol) ? avgVol : null,
    };
  })
    .filter((h) => h.date && h.shortInterest != null)
    .sort((a, b) => (a.date || '').localeCompare(b.date || '')); // ascending

  // Build the "current" snapshot — prefer Yahoo (most fresh), fall back to
  // most-recent FMP entry.
  const last = history[history.length - 1];
  const prev = history[history.length - 2];
  const fallbackDtc = yh && yh.avgVol10d ? yh.sharesShort / yh.avgVol10d : null;
  const fallbackPctFloat = yh && yh.floatShares ? yh.sharesShort / yh.floatShares : null;
  const current = {
    sharesShort: yh?.sharesShort ?? last?.shortInterest ?? null,
    sharesShortPriorMonth: yh?.sharesShortPriorMonth ?? prev?.shortInterest ?? null,
    floatShares: yh?.floatShares ?? last?.floatShares ?? null,
    sharesOutstanding: yh?.sharesOutstanding ?? null,
    pctOfFloat: yh?.shortPercentOfFloat ?? last?.pctOfFloat ?? fallbackPctFloat ?? null,
    daysToCover: yh?.shortRatio ?? last?.daysToCover ?? fallbackDtc ?? null,
    avgVol10d: yh?.avgVol10d ?? null,
    avgVol3mo: yh?.avgVol3mo ?? null,
    asOf: yh?.lastDate || last?.date || null,
  };

  // QoQ change in short interest, used to flag a build-up vs unwind.
  if (current.sharesShort && current.sharesShortPriorMonth) {
    current.shortInterestChange = current.sharesShort - current.sharesShortPriorMonth;
    current.shortInterestChangePct = current.shortInterestChange / current.sharesShortPriorMonth;
  }

  // Squeeze score (heuristic, 0–100): high % float + high DTC + rising trend
  const pctScore = Math.min(40, ((current.pctOfFloat || 0) * 100) * 4); // 10% float = 40 pts
  const dtcScore = Math.min(40, (current.daysToCover || 0) * 8);        // 5d DTC = 40 pts
  const trendScore = current.shortInterestChangePct ? Math.min(20, Math.max(0, current.shortInterestChangePct * 100 * 2)) : 0;
  current.squeezeScore = +(pctScore + dtcScore + trendScore).toFixed(1);

  const out = {
    symbol,
    current,
    history,
    prices,
    source: history.length ? 'yahoo+fmp' : 'yahoo',
    ts: new Date().toISOString(),
  };
  setCache(cacheKey, out, SIX_HOURS);
  return Response.json(out);
}
