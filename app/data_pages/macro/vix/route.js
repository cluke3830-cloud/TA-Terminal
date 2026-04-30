export const dynamic = 'force-dynamic';

import YahooFinance from 'yahoo-finance2';
import { getCached, setCache } from '../../_cache';

const yahoo = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });
const ONE_HOUR = 60 * 60 * 1000;

async function fetchSeries(symbol, period1, period2) {
  const res = await yahoo.chart(symbol, { period1, period2, interval: '1d' });
  const quotes = (res?.quotes || []).filter((q) => q && q.date && q.close != null);
  return quotes.map((q) => ({ d: new Date(q.date).toISOString().slice(0, 10), c: q.close }));
}

export async function GET() {
  const cacheKey = 'vix-term';
  const cached = getCached(cacheKey);
  if (cached) return Response.json(cached);

  const period2 = new Date();
  const period1 = new Date(period2.getTime() - 130 * 24 * 60 * 60 * 1000);

  let vix, vix3m, vix6m;
  try {
    [vix, vix3m, vix6m] = await Promise.all([
      fetchSeries('^VIX', period1, period2),
      fetchSeries('^VIX3M', period1, period2),
      fetchSeries('^VIX6M', period1, period2),
    ]);
  } catch (e) {
    return Response.json({ error: `yahoo fetch failed: ${e.message}` }, { status: 502 });
  }

  if (!vix.length || !vix3m.length) {
    return Response.json({ error: 'no VIX data' }, { status: 502 });
  }

  const map3 = new Map(vix3m.map((p) => [p.d, p.c]));
  const map6 = new Map(vix6m.map((p) => [p.d, p.c]));

  const history = vix.slice(-90).map((p) => {
    const v3 = map3.get(p.d);
    const v6 = map6.get(p.d);
    return {
      d: p.d,
      vix: +p.c.toFixed(2),
      vix3m: v3 != null ? +v3.toFixed(2) : null,
      vix6m: v6 != null ? +v6.toFixed(2) : null,
      ratio: v3 != null && v3 > 0 ? +(p.c / v3).toFixed(4) : null,
    };
  });

  const last = history[history.length - 1];
  const ratio = last.ratio;
  const regime = ratio == null ? 'unknown' : (ratio < 1 ? 'contango' : 'backwardation');

  const result = {
    current: {
      VIX: last.vix,
      VIX3M: last.vix3m,
      VIX6M: last.vix6m,
      ratio,
      regime,
    },
    history,
    ts: new Date().toISOString(),
  };
  setCache(cacheKey, result, ONE_HOUR);
  return Response.json(result);
}