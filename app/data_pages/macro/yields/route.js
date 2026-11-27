export const dynamic = 'force-dynamic';

import { getCached, setCache } from '../../_cache';
import {
  latestTreasuryCurve, treasuryCurveOn, curvePoints, getFedFunds, getCpi, TREASURY_SOURCE,
} from '../../_lib/rates';

// Yield curve: the US Treasury's own daily par yields (no key needed).
// Fed funds: the New York Fed's effective rate and the FOMC target range.
// CPI: the Bureau of Labor Statistics. Every figure carries its as-of date,
// and a source that fails is named in `errors` instead of being filled in.

function yearsBefore(isoDate, years) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
}

async function settle(name, promise, errors) {
  try { return await promise; } catch (e) { errors[name] = e.message || 'failed'; return null; }
}

export async function GET() {
  const cached = getCached('macro:yields');
  if (cached) return Response.json(cached);

  const errors = {};
  const latest = await settle('treasury', latestTreasuryCurve(), errors);
  if (!latest) {
    return Response.json({ error: `Treasury yield curve unavailable: ${errors.treasury}` }, { status: 502 });
  }

  const [h1, h2, h5, fed, cpi] = await Promise.all([
    settle('treasury_1y', treasuryCurveOn(yearsBefore(latest.date, 1)), errors),
    settle('treasury_2y', treasuryCurveOn(yearsBefore(latest.date, 2)), errors),
    settle('treasury_5y', treasuryCurveOn(yearsBefore(latest.date, 5)), errors),
    settle('fedfunds', getFedFunds(), errors),
    settle('cpi', getCpi(), errors),
  ]);

  const cur = curvePoints(latest);
  const at = (label) => cur.find((p) => p.label === label)?.yield;
  const y2 = at('2Y'), y5 = at('5Y'), y10 = at('10Y'), y30 = at('30Y');
  const spread_10_2 = y10 != null && y2 != null ? +(y10 - y2).toFixed(3) : null;
  const spread_30_5 = y30 != null && y5 != null ? +(y30 - y5).toFixed(3) : null;

  const data = {
    current: cur,
    asOf: latest.date,
    historical: {
      '1y': h1 ? curvePoints(h1) : [],
      '2y': h2 ? curvePoints(h2) : [],
      '5y': h5 ? curvePoints(h5) : [],
    },
    historicalAsOf: { '1y': h1?.date ?? null, '2y': h2?.date ?? null, '5y': h5?.date ?? null },
    spread_10_2,
    spread_30_5,
    inversion: spread_10_2 != null && spread_10_2 < 0,
    fedFundsRate: fed?.effr ?? null,
    fedTarget: fed ? { lower: fed.targetLower, upper: fed.targetUpper, asOf: fed.asOf } : null,
    cpiLatest: cpi?.index ?? null,
    cpiYoY: cpi?.yoyPct ?? null,
    cpiPeriod: cpi?.period ?? null,
    sources: {
      curve: TREASURY_SOURCE,
      fedFunds: fed?.source ?? null,
      cpi: cpi?.source ?? null,
    },
    errors: Object.keys(errors).length ? errors : undefined,
    lastUpdated: new Date().toISOString(),
  };
  // A partial answer (a source failed) is retried sooner than a full one.
  setCache('macro:yields', data, Object.keys(errors).length ? 2 * 60 * 1000 : 30 * 60 * 1000);
  return Response.json(data);
}
