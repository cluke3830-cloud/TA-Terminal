export const dynamic = 'force-dynamic';

import { logReturns, meanCov, solveFrontier } from '../../../portfolio/lib/markowitz';

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return Response.json({ error: 'invalid json' }, { status: 400 }); }
  const tickers = (body.tickers || []).map((t) => t.toUpperCase());
  if (tickers.length < 2) return Response.json({ error: 'need at least 2 tickers' }, { status: 400 });
  const start = body.start || '2018-01-01';
  const end = body.end || new Date().toISOString().slice(0, 10);
  const objective = body.objective || 'max_sharpe';
  const target = body.target != null ? +body.target : null;
  const rf = body.rf != null ? +body.rf : 0.04;
  const bounds = body.bounds || {};

  const origin = new URL(req.url).origin;
  const histRes = await fetch(`${origin}/data_pages/history?symbols=${tickers.join(',')}&start=${start}&end=${end}`);
  if (!histRes.ok) {
    const errBody = await histRes.json().catch(() => ({}));
    return Response.json({ error: `history fetch failed: ${errBody.error || histRes.status}`, missing: errBody.missing }, { status: 502 });
  }
  const hist = await histRes.json();
  if (hist.missing && hist.missing.length) {
    return Response.json({ error: 'missing data for some tickers', missing: hist.missing }, { status: 400 });
  }

  const returns = {};
  tickers.forEach((t) => { returns[t] = logReturns(hist.closes[t]); });
  const { mu, Sigma } = meanCov(returns);

  const result = solveFrontier({ mu, Sigma, tickers, bounds, rf, objective, target });
  if (result.error) return Response.json(result, { status: 400 });

  return Response.json({
    ...result,
    period: { start: hist.dates[0], end: hist.dates[hist.dates.length - 1], days: hist.dates.length },
    objective, rf,
    ts: new Date().toISOString(),
  });
}