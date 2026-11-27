export const dynamic = 'force-dynamic';

import { logReturns, meanCov, solveFrontier } from '../../../portfolio/lib/markowitz';
import { fetchHistory } from '../../_fetchHistory';
import { getRiskFree } from '../../_lib/rates';

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return Response.json({ error: 'invalid json' }, { status: 400 }); }
  const tickers = (body.tickers || []).map((t) => t.toUpperCase());
  if (tickers.length < 2) return Response.json({ error: 'need at least 2 tickers' }, { status: 400 });
  const start = body.start || '2018-01-01';
  const end = body.end || new Date().toISOString().slice(0, 10);
  const objective = body.objective || 'max_sharpe';
  const target = body.target != null ? +body.target : null;
  // Risk-free rate for the tangency portfolio: the caller's, or else today's
  // 3-month Treasury yield. There is no built-in default number.
  let rf = body.rf != null ? +body.rf : null;
  let rfAsOf = null;
  let rfSource = body.rf != null ? 'request' : null;
  if (rf == null) {
    const live = await getRiskFree().catch(() => null);
    if (!live) {
      return Response.json(
        { error: 'No live Treasury rate is available right now. Send "rf" in the request to set one.' },
        { status: 503 },
      );
    }
    rf = live.rate; rfAsOf = live.asOf; rfSource = live.source;
  }
  const bounds = body.bounds || {};

  const hist = await fetchHistory(tickers, start, end);
  if (hist.error) return Response.json({ error: hist.error, missing: hist.missing }, { status: 502 });
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
    objective, rf, rfAsOf, rfSource,
    ts: new Date().toISOString(),
  });
}