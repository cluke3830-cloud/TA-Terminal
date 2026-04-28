import { getCached, setCache } from '../../_cache';

function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

async function safeFetch(origin, path) {
  try {
    const r = await fetch(`${origin}${path}`, { cache: 'no-store' });
    if (!r.ok) return null;
    return await r.json();
  } catch (_) { return null; }
}

function scoreYieldCurve(spread) {
  // Inversion is a recession signal → fear; steep positive curve → growth/greed
  if (spread == null) return { score: 50, signal: 'NEUTRAL', desc: 'no data' };
  // Map: -1.5 → 10, 0 → 45, +1 → 70, +2.5 → 90
  const score = clamp(50 + spread * 20, 5, 95);
  const signal = score > 60 ? 'GREED' : score < 40 ? 'FEAR' : 'NEUTRAL';
  return { score: +score.toFixed(1), signal, desc: `10Y-2Y spread: ${spread > 0 ? '+' : ''}${spread.toFixed(2)}` };
}

function scoreRealRate(fed, cpiYoY) {
  if (fed == null || cpiYoY == null) return { score: 50, signal: 'NEUTRAL', desc: 'no data' };
  const real = fed - cpiYoY;
  // High real rate = tight money = fear, negative real rate = easy = greed
  // Map: real=4 → 15, real=2 → 35, real=0 → 60, real=-2 → 80
  const score = clamp(60 - real * 12, 5, 95);
  const signal = score > 60 ? 'GREED' : score < 40 ? 'FEAR' : 'NEUTRAL';
  return { score: +score.toFixed(1), signal, desc: `Real rate: ${real >= 0 ? '+' : ''}${real.toFixed(2)}%` };
}

function scoreDxy(dxyChange) {
  if (dxyChange == null) return { score: 50, signal: 'NEUTRAL', desc: 'no data' };
  // Rising USD = risk-off = fear
  const score = clamp(50 - dxyChange * 5, 5, 95);
  const signal = score > 60 ? 'GREED' : score < 40 ? 'FEAR' : 'NEUTRAL';
  return { score: +score.toFixed(1), signal, desc: `DXY 24h: ${dxyChange >= 0 ? '+' : ''}${dxyChange.toFixed(2)}%` };
}

function scoreCommodityMomentum(commodities) {
  if (!commodities || commodities.length === 0) return { score: 50, signal: 'NEUTRAL', desc: 'no data' };
  const oil = commodities.find((c) => c.symbol === 'CLUSD' || c.name?.includes('WTI'));
  const copper = commodities.find((c) => c.symbol === 'HGUSD' || c.name === 'Copper');
  const oilChg = oil?.changePct ?? 0;
  const copperChg = copper?.changePct ?? 0;
  const avg = (oilChg + copperChg) / 2;
  // Mild rises = growth optimism (greed); sharp moves either way = fear
  const score = clamp(60 + avg * 4, 10, 90);
  const signal = score > 60 ? 'GREED' : score < 40 ? 'FEAR' : 'NEUTRAL';
  return { score: +score.toFixed(1), signal, desc: `Oil+Cu avg 24h: ${avg >= 0 ? '+' : ''}${avg.toFixed(2)}%` };
}

function scoreYieldVol(currentYields, historicalYields) {
  if (!currentYields || !historicalYields) return { score: 50, signal: 'NEUTRAL', desc: 'no data' };
  // Compare 10Y current vs 1Y ago
  const cur10 = currentYields.find((p) => p.label === '10Y')?.yield;
  const old10 = historicalYields['1y']?.find((p) => p.label === '10Y')?.yield;
  if (cur10 == null || old10 == null) return { score: 50, signal: 'NEUTRAL', desc: 'no data' };
  const move = Math.abs(cur10 - old10);
  // Big moves (>1.5%) suggest stress = fear
  const score = clamp(80 - move * 25, 10, 90);
  const signal = score > 60 ? 'GREED' : score < 40 ? 'FEAR' : 'NEUTRAL';
  return { score: +score.toFixed(1), signal, desc: `10Y 1Y move: ${move.toFixed(2)}%` };
}

function scoreCBStance(banks) {
  if (!banks || banks.length === 0) return { score: 50, signal: 'NEUTRAL', desc: 'no data' };
  const cuts = banks.filter((b) => b.trend === 'cut').length;
  const hikes = banks.filter((b) => b.trend === 'hike').length;
  const holds = banks.filter((b) => b.trend === 'hold').length;
  const total = banks.length;
  // Net cuts = easing = greed; net hikes = tightening = fear
  const net = (cuts - hikes) / total; // -1 to +1
  const score = clamp(50 + net * 35, 15, 90);
  const signal = score > 60 ? 'GREED' : score < 40 ? 'FEAR' : 'NEUTRAL';
  return { score: +score.toFixed(1), signal, desc: `${cuts} cutting · ${holds} holding · ${hikes} hiking` };
}

function bucket(score) {
  if (score < 20) return { label: 'EXTREME FEAR',  color: '#ff3355' };
  if (score < 40) return { label: 'FEAR',          color: '#ff8833' };
  if (score < 60) return { label: 'NEUTRAL',       color: '#ffc700' };
  if (score < 80) return { label: 'GREED',         color: '#00d4ff' };
  return         { label: 'EXTREME GREED', color: '#00f59b' };
}

export async function GET(request) {
  const cached = getCached('macro:feargreed');
  if (cached) return Response.json(cached);

  const url = new URL(request.url);
  const origin = `${url.protocol}//${url.host}`;

  const [yields, fx, comm, banks] = await Promise.all([
    safeFetch(origin, '/api/macro/yields'),
    safeFetch(origin, '/api/macro/fx'),
    safeFetch(origin, '/api/macro/commodities'),
    safeFetch(origin, '/api/macro/centralbanks'),
  ]);

  // Approximate CPI YoY: FRED CPIAUCSL is index level. Use ~3% as fallback if missing.
  const fed = yields?.fedFundsRate;
  const cpiYoY = 2.9; // Latest reported CPI YoY (approx); real route can refine

  const components = [
    { name: 'Yield Curve',    weight: 0.20, ...scoreYieldCurve(yields?.spread_10_2) },
    { name: 'Real Fed Rate',  weight: 0.20, ...scoreRealRate(fed, cpiYoY) },
    { name: 'USD Momentum',   weight: 0.15, ...scoreDxy(fx?.dxyChange24h) },
    { name: 'Commodity Mtm',  weight: 0.15, ...scoreCommodityMomentum(comm?.commodities) },
    { name: 'Yield Volatility', weight: 0.15, ...scoreYieldVol(yields?.current, yields?.historical) },
    { name: 'CB Policy Stance', weight: 0.15, ...scoreCBStance(banks?.banks) },
  ];

  const total = components.reduce((s, c) => s + c.score * c.weight, 0);
  const score = +total.toFixed(1);
  const b = bucket(score);

  const data = {
    score,
    label: b.label,
    color: b.color,
    components,
    lastUpdated: new Date().toISOString(),
  };
  setCache('macro:feargreed', data);
  return Response.json(data);
}