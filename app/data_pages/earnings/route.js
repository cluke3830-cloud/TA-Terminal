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
  const [calendar, income, history, surprises] = await Promise.all([
    get(`earning-calendar?symbol=${symbol}`),
    get(`income-statement?symbol=${symbol}&period=quarter&limit=5`),
    get(`historical/earning_calendar?symbol=${symbol}&limit=5`),
    get(`earnings-surprises?symbol=${symbol}&limit=5`),
  ]);
  let historyData = Array.isArray(history) && history.length > 0 ? history : [];
  if (historyData.length === 0 && Array.isArray(surprises) && surprises.length > 0) {
    historyData = surprises.map((s) => ({ date: s.date, eps: s.actualEarningResult, epsEstimated: s.estimatedEarning }));
  }
  if (historyData.length === 0 && Array.isArray(income) && income.length > 0) {
    historyData = income.slice(0, 5).map((s) => ({ date: s.date, eps: s.eps, epsEstimated: s.epsdiluted || s.eps }));
  }
  if (!calendar && !income && historyData.length === 0) return null;
  return {
    calendar: Array.isArray(calendar) ? calendar.filter((e) => e.symbol === symbol).slice(0, 5) : [],
    history: historyData.slice(0, 12),
    quarterly_income: Array.isArray(income) ? income : [],
  };
}

async function yahooEarnings(symbol) {
  const m = await yahoo.quoteSummary(symbol, {
    modules: ['earningsHistory', 'calendarEvents', 'earnings'],
  }).catch(() => null);
  if (!m) return null;

  const hist = (m.earningsHistory?.history || [])
    .map((h) => ({
      date: isoDate(h.quarter),
      eps: num(h.epsActual),
      epsEstimated: num(h.epsEstimate),
    }))
    .filter((h) => h.date);

  const nextDate = m.calendarEvents?.earnings?.earningsDate?.[0];
  const calendar = nextDate ? [{ date: isoDate(nextDate), symbol }] : [];

  const quarterly_income = (m.earnings?.financialsChart?.quarterly || [])
    .map((q) => {
      const qNum = q.date ? parseInt(q.date[0], 10) : null;
      const year = q.date ? q.date.slice(-4) : null;
      const month = qNum ? String((qNum - 1) * 3 + 1).padStart(2, '0') : '01';
      return {
        date: (year && qNum) ? `${year}-${month}-01` : null,
        period: (year && qNum) ? `Q${qNum}` : (q.date || 'Q'),
        revenue: num(q.revenue),
        netIncome: num(q.earnings),
      };
    })
    .filter((q) => q.revenue != null)
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  if (hist.length === 0 && calendar.length === 0 && quarterly_income.length === 0) return null;
  return { calendar, history: hist, quarterly_income };
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
    const empty = { calendar: [], history: [], quarterly_income: [], source: 'unavailable' };
    setCache(cacheKey, empty, 5 * 60 * 1000);
    return Response.json(empty);
  }
  result.source = source;
  setCache(cacheKey, result, 60 * 60 * 1000);
  return Response.json(result);
}