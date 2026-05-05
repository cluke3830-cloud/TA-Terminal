export const dynamic = 'force-dynamic';

import { runBacktest } from '../../../portfolio/lib/backtest';
import { fetchHistory } from '../../_fetchHistory';

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return Response.json({ error: 'invalid json' }, { status: 400 }); }
  const tickers = (body.tickers || []).map((t) => t.toUpperCase());
  if (tickers.length < 1) return Response.json({ error: 'need at least 1 ticker' }, { status: 400 });
  const weights = {};
  tickers.forEach((t) => { weights[t] = body.weights && body.weights[t] != null ? +body.weights[t] : 1 / tickers.length; });
  const start = body.start || '2018-01-01';
  const end = body.end || new Date().toISOString().slice(0, 10);
  const costBps = body.costBps != null ? +body.costBps : 5;
  const t1 = body.t1 !== false;
  const rebalance = body.rebalance || 'monthly';

  const hist = await fetchHistory(tickers, start, end);
  if (hist.error) return Response.json({ error: hist.error, missing: hist.missing }, { status: 502 });
  if (hist.missing && hist.missing.length) {
    return Response.json({ error: 'missing data for some tickers', missing: hist.missing }, { status: 400 });
  }

  const result = runBacktest({
    dates: hist.dates,
    closes: hist.closes,
    weights,
    costBps,
    t1,
    rebalance,
  });
  if (result.error) return Response.json(result, { status: 400 });

  return Response.json({
    ...result,
    period: { start: hist.dates[0], end: hist.dates[hist.dates.length - 1] },
    config: { tickers, weights, costBps, t1, rebalance },
    ts: new Date().toISOString(),
  });
}