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

// CNN's Fear & Greed dataviz API. Returns the official score + 7 sub-indicators.
async function fetchCNN() {
  try {
    const r = await fetch('https://production.dataviz.cnn.io/index/fearandgreed/graphdata', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
      cache: 'no-store',
    });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// Map CNN's lowercase rating words to display label + color (matches our bucket palette)
function ratingMeta(rating) {
  const r = (rating || '').toLowerCase();
  if (r.includes('extreme fear'))  return { label: 'EXTREME FEAR',  color: '#ff3355' };
  if (r === 'fear')                return { label: 'FEAR',          color: '#ff8833' };
  if (r === 'neutral')             return { label: 'NEUTRAL',       color: '#ffc700' };
  if (r === 'greed')               return { label: 'GREED',         color: '#00d4ff' };
  if (r.includes('extreme greed')) return { label: 'EXTREME GREED', color: '#00f59b' };
  return { label: r.toUpperCase() || 'NEUTRAL', color: '#ffc700' };
}

function bucketFromScore(score) {
  if (score < 25)  return ratingMeta('extreme fear');
  if (score < 45)  return ratingMeta('fear');
  if (score < 55)  return ratingMeta('neutral');
  if (score < 75)  return ratingMeta('greed');
  return ratingMeta('extreme greed');
}

// Pull a CNN sub-indicator block into our component shape.
function cnnIndicator(name, block, descFn) {
  if (!block || typeof block.score !== 'number') return null;
  const meta = ratingMeta(block.rating);
  return {
    name,
    score: +block.score.toFixed(1),
    signal: meta.label,
    desc: descFn ? descFn(block) : (block.rating || ''),
    rating: block.rating,
  };
}

// ── Macro fallback scorers (used only when CNN is unreachable) ──────────────
function scoreYieldCurve(spread) {
  if (spread == null) return { score: 50, signal: 'NEUTRAL', desc: 'no data' };
  const score = clamp(50 + spread * 20, 5, 95);
  return { score: +score.toFixed(1), signal: score > 60 ? 'GREED' : score < 40 ? 'FEAR' : 'NEUTRAL', desc: `10Y-2Y spread: ${spread > 0 ? '+' : ''}${spread.toFixed(2)}` };
}
function scoreRealRate(fed, cpiYoY) {
  if (fed == null || cpiYoY == null) return { score: 50, signal: 'NEUTRAL', desc: 'no data' };
  const real = fed - cpiYoY;
  const score = clamp(60 - real * 12, 5, 95);
  return { score: +score.toFixed(1), signal: score > 60 ? 'GREED' : score < 40 ? 'FEAR' : 'NEUTRAL', desc: `Real rate: ${real >= 0 ? '+' : ''}${real.toFixed(2)}%` };
}
function scoreDxy(dxyChange) {
  if (dxyChange == null) return { score: 50, signal: 'NEUTRAL', desc: 'no data' };
  const score = clamp(50 - dxyChange * 5, 5, 95);
  return { score: +score.toFixed(1), signal: score > 60 ? 'GREED' : score < 40 ? 'FEAR' : 'NEUTRAL', desc: `DXY 24h: ${dxyChange >= 0 ? '+' : ''}${dxyChange.toFixed(2)}%` };
}
function scoreCommodityMomentum(commodities) {
  if (!commodities || commodities.length === 0) return { score: 50, signal: 'NEUTRAL', desc: 'no data' };
  const oil = commodities.find((c) => c.symbol === 'CLUSD' || c.name?.includes('WTI'));
  const copper = commodities.find((c) => c.symbol === 'HGUSD' || c.name === 'Copper');
  const avg = ((oil?.changePct ?? 0) + (copper?.changePct ?? 0)) / 2;
  const score = clamp(60 + avg * 4, 10, 90);
  return { score: +score.toFixed(1), signal: score > 60 ? 'GREED' : score < 40 ? 'FEAR' : 'NEUTRAL', desc: `Oil+Cu avg 24h: ${avg >= 0 ? '+' : ''}${avg.toFixed(2)}%` };
}
function scoreYieldVol(currentYields, historicalYields) {
  if (!currentYields || !historicalYields) return { score: 50, signal: 'NEUTRAL', desc: 'no data' };
  const cur10 = currentYields.find((p) => p.label === '10Y')?.yield;
  const old10 = historicalYields['1y']?.find((p) => p.label === '10Y')?.yield;
  if (cur10 == null || old10 == null) return { score: 50, signal: 'NEUTRAL', desc: 'no data' };
  const move = Math.abs(cur10 - old10);
  const score = clamp(80 - move * 25, 10, 90);
  return { score: +score.toFixed(1), signal: score > 60 ? 'GREED' : score < 40 ? 'FEAR' : 'NEUTRAL', desc: `10Y 1Y move: ${move.toFixed(2)}%` };
}
function scoreCBStance(banks) {
  if (!banks || banks.length === 0) return { score: 50, signal: 'NEUTRAL', desc: 'no data' };
  const cuts = banks.filter((b) => b.trend === 'cut').length;
  const hikes = banks.filter((b) => b.trend === 'hike').length;
  const total = banks.length;
  const net = (cuts - hikes) / total;
  const score = clamp(50 + net * 35, 15, 90);
  return { score: +score.toFixed(1), signal: score > 60 ? 'GREED' : score < 40 ? 'FEAR' : 'NEUTRAL', desc: `${cuts} cutting · ${total - cuts - hikes} holding · ${hikes} hiking` };
}

export async function GET(request) {
  const cached = getCached('macro:feargreed');
  if (cached) return Response.json(cached);

  const url = new URL(request.url);
  const origin = `${url.protocol}//${url.host}`;

  const [cnnRaw, yields, fx, comm, banks] = await Promise.all([
    fetchCNN(),
    safeFetch(origin, '/data_pages/macro/yields'),
    safeFetch(origin, '/data_pages/macro/fx'),
    safeFetch(origin, '/data_pages/macro/commodities'),
    safeFetch(origin, '/data_pages/macro/centralbanks'),
  ]);

  const cnnFG = cnnRaw?.fear_and_greed;
  const useCNN = cnnFG && typeof cnnFG.score === 'number';

  let score, label, color, source, components, cnnMeta;

  if (useCNN) {
    score = +cnnFG.score.toFixed(1);
    const meta = ratingMeta(cnnFG.rating) || bucketFromScore(score);
    label = meta.label;
    color = meta.color;
    source = 'CNN';
    cnnMeta = {
      previousClose: cnnFG.previous_close ?? null,
      prev1w: cnnFG.previous_1_week?.score ?? null,
      prev1m: cnnFG.previous_1_month?.score ?? null,
      prev1y: cnnFG.previous_1_year?.score ?? null,
    };
    // CNN's 7 official sub-indicators
    components = [
      cnnIndicator('Market Momentum',    cnnRaw.market_momentum_sp125,   (b) => `S&P 500 vs 125-day MA · ${b.rating}`),
      cnnIndicator('Stock Price Strength', cnnRaw.stock_price_strength,  (b) => `52-week highs vs lows · ${b.rating}`),
      cnnIndicator('Stock Price Breadth',  cnnRaw.stock_price_breadth,   (b) => `McClellan Volume Summation · ${b.rating}`),
      cnnIndicator('Put/Call Options',     cnnRaw.put_call_options,      (b) => `5-day put/call ratio · ${b.rating}`),
      cnnIndicator('Market Volatility',    cnnRaw.market_volatility_vix, (b) => `VIX vs 50-day MA · ${b.rating}`),
      cnnIndicator('Safe Haven Demand',    cnnRaw.safe_haven_demand,     (b) => `Stocks vs Treasuries 20d · ${b.rating}`),
      cnnIndicator('Junk Bond Demand',     cnnRaw.junk_bond_demand,      (b) => `HY vs IG yield spread · ${b.rating}`),
    ].filter(Boolean);
  } else {
    // Macro fallback when CNN is unreachable
    const fed = yields?.fedFundsRate;
    const cpiYoY = 2.9;
    components = [
      { name: 'Yield Curve',      ...scoreYieldCurve(yields?.spread_10_2) },
      { name: 'Real Fed Rate',    ...scoreRealRate(fed, cpiYoY) },
      { name: 'USD Momentum',     ...scoreDxy(fx?.dxyChange24h) },
      { name: 'Commodity Mtm',    ...scoreCommodityMomentum(comm?.commodities) },
      { name: 'Yield Volatility', ...scoreYieldVol(yields?.current, yields?.historical) },
      { name: 'CB Policy Stance', ...scoreCBStance(banks?.banks) },
    ];
    const macroAvg = +(components.reduce((s, c) => s + c.score, 0) / components.length).toFixed(1);
    score = macroAvg;
    const meta = bucketFromScore(score);
    label = meta.label;
    color = meta.color;
    source = 'macro';
    cnnMeta = null;
  }

  const data = {
    score,
    label,
    color,
    source,
    cnnMeta,
    components,
    lastUpdated: new Date().toISOString(),
  };

  setCache('macro:feargreed', data);
  return Response.json(data);
}