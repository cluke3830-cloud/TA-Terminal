export const dynamic = 'force-dynamic';

import { getCached, setCache } from '../_cache';
import YahooFinance from 'yahoo-finance2';

const yahoo = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

function num(v) { return v?.raw ?? (typeof v === 'number' ? v : null); }
function isoDate(d) {
  if (!d) return null;
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  if (typeof d === 'string') return d.slice(0, 10);
  if (d?.fmt) return d.fmt;
  return null;
}

async function fmpEarnings(symbol, key) {
  if (!key) return null;
  const FMP = 'https://financialmodelingprep.com/stable';
  const get = async (path) => {
    try {
      const r = await fetch(`${FMP}/${path}${path.includes('?') ? '&' : '?'}apikey=${key}`);
      if (!r.ok) return null;
      const j = await r.json();
      if (j?.['Error Message']) return null;
      return j;
    } catch { return null; }
  };
  const [calendar, income, history, surprises, estimates] = await Promise.all([
    get(`earning-calendar?symbol=${symbol}`),
    get(`income-statement?symbol=${symbol}&period=quarter&limit=5`),
    get(`historical/earning_calendar?symbol=${symbol}&limit=5`),
    get(`earnings-surprises?symbol=${symbol}&limit=5`),
    get(`analyst-estimates?symbol=${symbol}&period=quarter&limit=8`),
  ]);

  let historyData = Array.isArray(history) && history.length > 0 ? history : [];
  if (historyData.length === 0 && Array.isArray(surprises) && surprises.length > 0) {
    historyData = surprises.map((s) => ({ date: s.date, eps: s.actualEarningResult, epsEstimated: s.estimatedEarning }));
  }
  if (historyData.length === 0 && Array.isArray(income) && income.length > 0) {
    historyData = income.slice(0, 5).map((s) => ({ date: s.date, eps: s.eps, epsEstimated: s.epsdiluted || s.eps }));
  }

  // Build the next-period analyst forecast from FMP analyst-estimates,
  // which is forward-looking (the dates are future quarter ends with consensus
  // EPS/revenue means). Pick the soonest date >= today.
  let nextEstimate = null;
  if (Array.isArray(estimates) && estimates.length > 0) {
    const todayKey = new Date().toISOString().slice(0, 10);
    const sorted = [...estimates].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const upcoming = sorted.find((e) => (e.date || '') >= todayKey) || sorted[sorted.length - 1];
    if (upcoming) {
      nextEstimate = {
        date: upcoming.date,
        epsAvg: upcoming.estimatedEpsAvg ?? upcoming.epsAvg ?? null,
        epsLow: upcoming.estimatedEpsLow ?? upcoming.epsLow ?? null,
        epsHigh: upcoming.estimatedEpsHigh ?? upcoming.epsHigh ?? null,
        revenueAvg: upcoming.estimatedRevenueAvg ?? upcoming.revenueAvg ?? null,
        analystCount: upcoming.numberAnalystsEstimatedEps ?? upcoming.numberAnalystEstimatedEps ?? null,
        source: 'fmp',
      };
    }
  }

  // Earnings-calendar entry tells us *when* the next print happens (often
  // before analyst-estimates dates align). Merge in the date if missing.
  const cal = Array.isArray(calendar) ? calendar.filter((e) => e.symbol === symbol) : [];
  const upcomingCal = cal.find((e) => (e.date || '') >= new Date().toISOString().slice(0, 10));
  if (upcomingCal && !nextEstimate) {
    nextEstimate = {
      date: upcomingCal.date,
      epsAvg: upcomingCal.epsEstimated ?? null,
      revenueAvg: upcomingCal.revenueEstimated ?? null,
      source: 'fmp-calendar',
    };
  } else if (upcomingCal && nextEstimate && upcomingCal.date < nextEstimate.date) {
    // Calendar event is sooner than the analyst-estimate row — prefer the calendar date
    // and keep the analyst means (best-guess for that print).
    nextEstimate = { ...nextEstimate, date: upcomingCal.date };
  }

  if (!calendar && !income && historyData.length === 0 && !nextEstimate) return null;
  return {
    calendar: cal.slice(0, 5),
    history: historyData.slice(0, 12),
    quarterly_income: Array.isArray(income) ? income : [],
    nextEstimate,
  };
}

async function yahooEarnings(symbol) {
  const m = await yahoo.quoteSummary(symbol, {
    modules: ['earningsHistory', 'calendarEvents', 'earnings', 'earningsTrend'],
  }).catch(() => null);
  if (!m) return null;

  const hist = (m.earningsHistory?.history || [])
    .map((h) => ({
      date: isoDate(h.quarter),
      eps: num(h.epsActual),
      epsEstimated: num(h.epsEstimate),
    }))
    .filter((h) => h.date);

  const ce = m.calendarEvents?.earnings || {};
  const nextDate = isoDate(ce.earningsDate?.[0]);
  const calendar = nextDate ? [{ date: nextDate, symbol }] : [];

  // Forward consensus: Yahoo's earningsTrend has rows keyed by period (0q = current
  // quarter, +1q = next quarter, etc.). Earnings is best estimated from current quarter
  // (the upcoming print). Revenue from the same row.
  let nextEstimate = null;
  const trend = (m.earningsTrend?.trend || []);
  const currentQ = trend.find((t) => t.period === '0q') || trend.find((t) => t.period === '+1q');
  if (currentQ || nextDate) {
    nextEstimate = {
      date: nextDate || isoDate(currentQ?.endDate),
      epsAvg: num(currentQ?.earningsEstimate?.avg) ?? num(ce.earningsAverage),
      epsLow: num(currentQ?.earningsEstimate?.low) ?? num(ce.earningsLow),
      epsHigh: num(currentQ?.earningsEstimate?.high) ?? num(ce.earningsHigh),
      revenueAvg: num(currentQ?.revenueEstimate?.avg) ?? num(ce.revenueAverage),
      analystCount: num(currentQ?.earningsEstimate?.numberOfAnalysts),
      source: 'yahoo',
    };
    // If we have nothing meaningful, drop it
    if (nextEstimate.epsAvg == null && nextEstimate.revenueAvg == null && !nextEstimate.date) {
      nextEstimate = null;
    }
  }

  const quarterly_income = (m.earnings?.financialsChart?.quarterly || [])
    .map((q) => ({
      date: q.date ? `${q.date.slice(-4)}-${q.date.slice(0, 2)}-01` : null,
      period: q.date?.slice(0, 2) || 'Q',
      revenue: num(q.revenue),
      netIncome: num(q.earnings),
    }))
    .filter((q) => q.revenue != null);

  if (hist.length === 0 && calendar.length === 0 && quarterly_income.length === 0 && !nextEstimate) return null;
  return { calendar, history: hist, quarterly_income, nextEstimate };
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const symbol = (searchParams.get('symbol') || 'NVDA').toUpperCase();

  const cacheKey = `earn:${symbol}`;
  const cached = getCached(cacheKey);
  if (cached) return Response.json(cached);

  let result = null;
  let source = 'fmp';
  try { result = await fmpEarnings(symbol, process.env.FMP_API_KEY); } catch (_) { /* try yahoo */ }
  if (!result) {
    try { result = await yahooEarnings(symbol); source = 'yahoo'; } catch (_) { /* return empty */ }
  }
  if (!result) {
    const empty = { calendar: [], history: [], quarterly_income: [], nextEstimate: null, source: 'unavailable' };
    setCache(cacheKey, empty, 5 * 60 * 1000);
    return Response.json(empty);
  }
  result.source = source;
  setCache(cacheKey, result, 60 * 60 * 1000);
  return Response.json(result);
}