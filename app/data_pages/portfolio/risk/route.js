export const dynamic = 'force-dynamic';

import { computeRisk } from '../../../portfolio/lib/risk';
import { runBacktest } from '../../../portfolio/lib/backtest';

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return Response.json({ error: 'invalid json' }, { status: 400 }); }

  const tickers = (body.tickers || []).map((t) => String(t).toUpperCase()).filter(Boolean);
  if (tickers.length < 1) return Response.json({ error: 'need at least 1 ticker' }, { status: 400 });

  const weights = {};
  tickers.forEach((t) => {
    weights[t] = body.weights && body.weights[t] != null ? +body.weights[t] : 1 / tickers.length;
  });

  const benchmark = (body.benchmark || 'SPY').toUpperCase();
  const conf = body.conf != null ? +body.conf : 0.95;
  const start = body.start || '2020-01-01';
  const end = body.end || new Date().toISOString().slice(0, 10);
  // Match backtest defaults so the headline stats line up out of the box.
  const rebalance = body.rebalance || 'monthly';
  const costBps = body.costBps != null ? +body.costBps : 5;
  const t1 = body.t1 !== false;

  // Reuse the existing history endpoint so we share its caching + alignment.
  const fetchSyms = Array.from(new Set([...tickers, benchmark])).join(',');
  const origin = new URL(req.url).origin;
  const histRes = await fetch(`${origin}/data_pages/history?symbols=${fetchSyms}&start=${start}&end=${end}`);
  if (!histRes.ok) {
    const errBody = await histRes.json().catch(() => ({}));
    return Response.json({ error: `history fetch failed: ${errBody.error || histRes.status}`, missing: errBody.missing }, { status: 502 });
  }
  const hist = await histRes.json();
  if (hist.missing && hist.missing.length) {
    return Response.json({ error: 'missing data for some tickers', missing: hist.missing }, { status: 400 });
  }

  // Build the realized daily return series via the backtest engine so Sharpe
  // and Max DD line up with the Backtest section exactly.
  const bt = runBacktest({
    dates: hist.dates,
    closes: hist.closes,
    weights,
    costBps,
    t1,
    rebalance,
  });
  let portRetSeries = null;
  if (!bt.error && bt.equity?.length > 1) {
    portRetSeries = [];
    for (let i = 1; i < bt.equity.length; i++) {
      portRetSeries.push(bt.equity[i].v / bt.equity[i - 1].v - 1);
    }
  }

  const result = computeRisk({
    tickers, closes: hist.closes, weights, benchmark, conf, portRetSeries,
  });
  if (result.error) return Response.json(result, { status: 400 });

  return Response.json({
    ...result,
    period: { start: hist.dates[0], end: hist.dates[hist.dates.length - 1] },
    dates: hist.dates,
    execution: { rebalance, costBps, t1 },
    ts: new Date().toISOString(),
  });
}
