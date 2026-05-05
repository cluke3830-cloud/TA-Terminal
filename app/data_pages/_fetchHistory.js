// Shared history-fetching logic used directly by portfolio routes.
// Avoids the internal HTTP self-fetch (which Vercel blocks with 401).

import YahooFinance from 'yahoo-finance2';
import { getCached, setCache } from './_cache';

const yahoo = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });
const ONE_DAY = 24 * 60 * 60 * 1000;

async function fetchOne(symbol, period1, period2) {
  const key = `hist:${symbol}:${period1.toISOString().slice(0, 10)}:${period2.toISOString().slice(0, 10)}`;
  const cached = getCached(key);
  if (cached) return cached;
  const res = await yahoo.chart(symbol, { period1, period2, interval: '1d' });
  const quotes = (res?.quotes || []).filter((q) => q && q.date && q.close != null);
  const out = quotes.map((q) => ({
    d: new Date(q.date).toISOString().slice(0, 10),
    c: q.close,
  }));
  setCache(key, out, ONE_DAY);
  return out;
}

// Returns { dates, closes, missing } on success, or { error, missing } on failure.
export async function fetchHistory(tickers, start, end) {
  const period1 = new Date(start);
  const period2 = new Date(end);

  const series = {};
  const missing = [];
  const CHUNK = 5;
  for (let i = 0; i < tickers.length; i += CHUNK) {
    const chunk = tickers.slice(i, i + CHUNK);
    const results = await Promise.allSettled(chunk.map((s) => fetchOne(s, period1, period2)));
    chunk.forEach((sym, j) => {
      const r = results[j];
      if (r.status === 'fulfilled' && r.value.length > 5) {
        series[sym] = r.value;
      } else {
        missing.push({ ticker: sym, reason: r.status === 'rejected' ? String(r.reason).slice(0, 120) : 'no data' });
      }
    });
  }

  if (Object.keys(series).length === 0) return { error: 'no data for any ticker', missing };

  const maps = {};
  Object.entries(series).forEach(([sym, arr]) => {
    maps[sym] = new Map(arr.map((p) => [p.d, p.c]));
  });
  const symList = Object.keys(maps);
  const baseDates = series[symList[0]].map((p) => p.d);
  const dates = baseDates.filter((d) => symList.every((s) => maps[s].has(d)));
  if (dates.length < 30) return { error: 'insufficient overlapping history', missing, available: dates.length };

  const closes = {};
  symList.forEach((sym) => { closes[sym] = dates.map((d) => maps[sym].get(d)); });

  return { dates, closes, missing };
}
