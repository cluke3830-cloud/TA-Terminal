export const dynamic = 'force-dynamic';

import { getCached, setCache } from '../../_cache';

function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

async function safeFetch(origin, path) {
  try {
    const r = await fetch(`${origin}${path}`, { cache: 'no-store' });
    if (!r.ok) return null;
    return await r.json();
  } catch (_) { return null; }
}

async function fetchCNN() {
  try {
    const r = await fetch('https://production.dataviz.cnn.io/index/fearandgreed/graphdata', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
      cache: 'no-store',
    });
    if (!r.ok) return null;
    const j = await r.json();
    const fg = j?.fear_and_greed;
    if (!fg || typeof fg.score !== 'number') return null;
    return {
      score: fg.score,
      rating: fg.rating,
      previousClose: fg.previous_close ?? null,
      prev1w: fg.previous_1_week?.score ?? null,
      prev1m: fg.previous_1_month?.score ?? null,
      prev1y: fg.previous_1_year?.score ?? null,
    };
  } catch { return null; }
}

function scoreYieldCurve(spread) {
  if (spread == null) return { score: 50, signal: 'NEUTRAL', desc: 'no data' };
  const score = clamp(50 + spread * 20, 5, 95);
  const signal = score > 60 ? 'GREED' : score < 40 ? 'FEAR' : 'NEUTRAL';
  return { score: +score.toFixed(1), signal, desc: `10Y-2Y spread: ${spread > 0 ? '+' : ''}${spread.toFixed(2)}` };
}

function scoreRealRate(fed, cpiYoY) {
  if (fed == null || cpiYoY == null) return { score: 50, signal: 'NEUTRAL', desc: 'no data' };
  const real = fed - cpiYoY;
  const score = clamp(60 - real * 12, 5, 95);
  const signal = score > 60 ? 'GREED' : score < 40 ? 'FEAR' : 'NEUTRAL';
  return { score: +score.toFixed(1), signal, desc: `Real rate: ${real >= 0 ? '+' : ''}${real.toFixed(2)}%` };
}

function scoreDxy(dxyChange) {
  if (dxyChange == null) return { score: 50, signal: 'NEUTRAL', desc: 'no data' };
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
  const score = clamp(60 + avg * 4, 10, 90);
  const signal = score > 60 ? 'GREED' : score < 40 ? 'FEAR' : 'NEUTRAL';
  return { score: +score.toFixed(1), signal, desc: `Oil+Cu avg 24h: ${avg >= 0 ? '+' : ''}${avg.toFixed(2)}%` };
}

function scoreYieldVol(currentYields, historicalYields) {
  if (!currentYields || !historicalYields) return { score: 50, signal: 'NEUTRAL', desc: 'no data' };
  const cur10 = currentYields.find((p) => p.label === '10Y')?.yield;
  const old10 = historicalYields['1y']?.find((p) => p.label === '10Y')?.yield;
  if (cur10 == null || old10 == null) return { score: 50, signal: 'NEUTRAL', desc: 'no data' };
  const move = Math.abs(cur10 - old10);
  const score = clamp(80 - move * 25, 10, 90);
  const signal = score > 60 ? 'GREED' : score < 40 ? 'FEAR' : 'NEUTRAL';
  return { score: +score.toFixed(1), signal, desc: `10Y 1Y move: ${move.toFixed(2)}%` };
}

function scoreCBStance(banks) {
  if (!banks || banks.length === 0) return { score: 50, signal: 'NEUTRAL', desc: 'no data' };
  const cuts = banks.filter((b) => b.trend === 'cut').length;
  const hikes = banks.filter((b) => b.trend === 'hike').length;
  const total = banks.length;
  const net = (cuts - hikes) / total;
  const score = clamp(50 + net * 35, 15, 90);
  const signal = score > 60 ? 'GREED' : score < 40 ? 'FEAR' : 'NEUTRAL';
  return { score: +score.toFixed(1), signal, desc: `${cuts} cutting · ${total - cuts - hikes} holding · ${hikes} hiking` };
}

function bucket(score) {
  if (score < 20) return { label: 'EXTREME FEAR',  color: '#ff3355' };
  if (score < 40) return { label: 'FEAR',          color: '#ff8833' };
  if (score < 60) return { label: 'NEUTRAL',       color: '#ffc700' };
  if (score < 80) return { label: 'GREED',         color: '#00d4ff' };
  return               { label: 'EXTREME GREED', color: '#00f59b' };
}

export async function GET(request) {
  const cached = getCached('macro:feargreed');
  if (cached) return Response.json(cached);

  const url = new URL(request.url);
  const origin = `${url.protocol}//${url.host}`;

  const [cnnData, yields, fx, comm, banks] = await Promise.all([
    fetchCNN(),
    safeFetch(origin, '/data_pages/macro/yields'),
    safeFetch(origin, '/data_pages/macro/fx'),
    safeFetch(origin, '/data_pages/macro/commodities'),
    safeFetch(origin, '/data_pages/macro/centralbanks'),
  ]);

  const fed = yields?.fedFundsRate;
  const cpiYoY = 2.9;

  const components = [
    { name: 'Yield Curve',      weight: 0.20, ...scoreYieldCurve(yields?.spread_10_2) },
    { name: 'Real Fed Rate',    weight: 0.20, ...scoreRealRate(fed, cpiYoY) },
    { name: 'USD Momentum',     weight: 0.15, ...scoreDxy(fx?.dxyChange24h) },
    { name: 'Commodity Mtm',    weight: 0.15, ...scoreCommodityMomentum(comm?.commodities) },
    { name: 'Yield Volatility', weight: 0.15, ...scoreYieldVol(yields?.current, yields?.historical) },
    { name: 'CB Policy Stance', weight: 0.15, ...scoreCBStance(banks?.banks) },
  ];

  const macroScore = +components.reduce((s, c) => s + c.score * c.weight, 0).toFixed(1);

  const score = (cnnData && typeof cnnData.score === 'number') ? +cnnData.score.toFixed(1) : macroScore;
  const source = cnnData ? 'CNN' : 'macro';
  const b = bucket(score);

  const data = {
    score,
    label: b.label,
    color: b.color,
    source,
    cnnMeta: cnnData ? {
      previousClose: cnnData.previousClose,
      prev1w: cnnData.prev1w,
      prev1m: cnnData.prev1m,
      prev1y: cnnData.prev1y,
    } : null,
    macroScore,
    components,
    lastUpdated: new Date().toISOString(),
  };

  setCache('macro:feargreed', data);
  return Response.json(data);
}