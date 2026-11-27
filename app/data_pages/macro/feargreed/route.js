export const dynamic = 'force-dynamic';

import YahooFinance from 'yahoo-finance2';
import { getCached, setCache } from '../../_cache';
import { withTimeout } from '../../_lib/http';

// Fear & Greed, computed here from live market prices.
//
// Five gauges. Each is today's reading ranked against its own last 252
// trading days: 0 means the most fearful reading of the past year, 100 the
// greediest. The index is the plain average of the five ranks.
//
//   Market momentum    S&P 500 against its 125-day average
//   Price strength     S&P 500 against its 52-week high
//   Market volatility  VIX against its 50-day average (high = fear)
//   Safe haven demand  20-day return of stocks (SPY) minus Treasuries (TLT)
//   Junk bond demand   20-day return of high yield (HYG) minus investment grade (LQD)
//
// It is not CNN's index: CNN's data feed refuses automated clients, and two
// of its seven inputs (breadth, put/call) need exchange data this app does
// not have. The page labels it as the terminal's own composite.

const yahoo = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });
const DAY = 24 * 60 * 60 * 1000;
const RANK_WINDOW = 252;

const SYMBOLS = ['^GSPC', '^VIX', 'SPY', 'TLT', 'HYG', 'LQD'];

async function closes(symbol) {
  const period2 = new Date();
  const period1 = new Date(period2.getTime() - 1150 * DAY); // ~3 years of sessions
  const res = await withTimeout(yahoo.chart(symbol, { period1, period2, interval: '1d' }), 9000, `Yahoo ${symbol}`);
  const map = new Map();
  for (const q of res?.quotes || []) {
    if (q && q.date && q.close != null) map.set(new Date(q.date).toISOString().slice(0, 10), q.close);
  }
  return map;
}

function sma(arr, i, n) {
  if (i + 1 < n) return null;
  let s = 0;
  for (let k = i - n + 1; k <= i; k++) s += arr[k];
  return s / n;
}

function rollingMax(arr, i, n) {
  if (i + 1 < n) return null;
  let m = -Infinity;
  for (let k = i - n + 1; k <= i; k++) if (arr[k] > m) m = arr[k];
  return m;
}

function ret(arr, i, n) {
  if (i < n || !(arr[i - n] > 0)) return null;
  return arr[i] / arr[i - n] - 1;
}

// Rank of series[i] among the RANK_WINDOW readings that end at i, 0 to 100.
// Ties count half, so a flat series sits at 50.
function percentile(series, i) {
  if (i + 1 < RANK_WINDOW) return null;
  const x = series[i];
  if (x == null) return null;
  let below = 0, equal = 0, n = 0;
  for (let k = i - RANK_WINDOW + 1; k <= i; k++) {
    const v = series[k];
    if (v == null) return null;
    n++;
    if (v < x) below++;
    else if (v === x) equal++;
  }
  return ((below + 0.5 * equal) / n) * 100;
}

function meta(score) {
  if (score < 25) return { label: 'EXTREME FEAR', color: '#ff3355' };
  if (score < 45) return { label: 'FEAR', color: '#ff8833' };
  if (score < 55) return { label: 'NEUTRAL', color: '#ffc700' };
  if (score < 75) return { label: 'GREED', color: '#00d4ff' };
  return { label: 'EXTREME GREED', color: '#00f59b' };
}

const pct = (x, d = 1) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(d)}%`;

export async function GET() {
  const cached = getCached('macro:feargreed');
  if (cached) return Response.json(cached);

  let maps;
  try {
    maps = await Promise.all(SYMBOLS.map(closes));
  } catch (e) {
    return Response.json({ error: `Market data unavailable: ${e.message}` }, { status: 502 });
  }
  const [mSpx, mVix, mSpy, mTlt, mHyg, mLqd] = maps;

  // Sessions on which all six series have a close.
  const dates = [...mSpx.keys()].filter((d) => maps.every((m) => m.has(d))).sort();
  if (dates.length < RANK_WINDOW + 260) {
    return Response.json({ error: `Not enough shared history (${dates.length} sessions)` }, { status: 502 });
  }
  const col = (m) => dates.map((d) => m.get(d));
  const spx = col(mSpx), vix = col(mVix), spy = col(mSpy), tlt = col(mTlt), hyg = col(mHyg), lqd = col(mLqd);
  const n = dates.length;

  // Raw readings, oriented so that higher = greedier.
  const raw = {
    momentum: spx.map((v, i) => { const a = sma(spx, i, 125); return a ? v / a - 1 : null; }),
    strength: spx.map((v, i) => { const m = rollingMax(spx, i, 252); return m ? v / m - 1 : null; }),
    volatility: vix.map((v, i) => { const a = sma(vix, i, 50); return a ? -(v / a - 1) : null; }),
    safeHaven: spy.map((_, i) => { const a = ret(spy, i, 20), b = ret(tlt, i, 20); return a != null && b != null ? a - b : null; }),
    junk: hyg.map((_, i) => { const a = ret(hyg, i, 20), b = ret(lqd, i, 20); return a != null && b != null ? a - b : null; }),
  };
  const keys = Object.keys(raw);

  const compositeAt = (i) => {
    const ranks = keys.map((k) => percentile(raw[k], i));
    if (ranks.some((r) => r == null)) return null;
    return { ranks, score: ranks.reduce((s, r) => s + r, 0) / ranks.length };
  };

  const last = n - 1;
  const now = compositeAt(last);
  if (!now) return Response.json({ error: 'Could not rank the gauges' }, { status: 502 });

  const descriptions = {
    momentum: `S&P 500 is ${pct(raw.momentum[last])} against its 125-day average`,
    strength: `S&P 500 is ${pct(raw.strength[last])} from its 52-week high`,
    volatility: `VIX ${vix[last].toFixed(1)} is ${pct(-raw.volatility[last])} against its 50-day average`,
    safeHaven: `Stocks minus Treasuries over 20 days: ${pct(raw.safeHaven[last])}`,
    junk: `High yield minus investment grade over 20 days: ${pct(raw.junk[last], 2)}`,
  };
  const names = {
    momentum: 'Market Momentum', strength: 'Price Strength', volatility: 'Market Volatility',
    safeHaven: 'Safe Haven Demand', junk: 'Junk Bond Demand',
  };
  const components = keys.map((k, j) => ({
    name: names[k],
    score: +now.ranks[j].toFixed(1),
    signal: meta(now.ranks[j]).label,
    desc: descriptions[k],
  }));

  const back = (sessions) => {
    const c = compositeAt(last - sessions);
    return c ? +c.score.toFixed(1) : null;
  };

  const score = +now.score.toFixed(1);
  const data = {
    score,
    ...meta(score),
    source: 'market',
    asOf: dates[last],
    history: { previousClose: back(1), prev1w: back(5), prev1m: back(21), prev1y: back(252) },
    components,
    method: 'Average of five gauges, each ranked against its own last 252 trading days (0 = most fearful, 100 = greediest).',
    lastUpdated: new Date().toISOString(),
  };
  setCache('macro:feargreed', data, 15 * 60 * 1000);
  return Response.json(data);
}
