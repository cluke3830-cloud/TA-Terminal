export const dynamic = 'force-dynamic';

import YahooFinance from 'yahoo-finance2';
import { getCached, setCache } from '../_cache';

const yahoo = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
const FMP = 'https://financialmodelingprep.com';
const TWELVE_HOURS = 12 * 60 * 60 * 1000;

async function fetchQuarter(symbol, year, q, key) {
  try {
    const r = await fetch(
      `${FMP}/stable/institutional-ownership/symbol-positions-summary?symbol=${symbol}&year=${year}&quarter=${q}&apikey=${key}`,
      { headers: { Accept: 'application/json' } }
    );
    if (!r.ok) return null;
    const j = await r.json();
    if (!Array.isArray(j) || !j.length) return null;
    return j[0];
  } catch { return null; }
}

function normalizeQuarter(it) {
  if (!it) return null;
  const num = (v) => { const n = +v; return isFinite(n) ? n : null; };
  return {
    date: it.date || null,
    investorsHolding: num(it.investorsHolding),
    investorsHoldingChange: num(it.investorsHoldingChange),
    numberOf13Fshares: num(it.numberOf13Fshares),
    numberOf13FsharesChange: num(it.numberOf13FsharesChange),
    totalInvested: num(it.totalInvested),
    totalInvestedChange: num(it.totalInvestedChange),
    ownershipPercent: num(it.ownershipPercent),
    lastOwnershipPercent: num(it.lastOwnershipPercent),
    newPositions: num(it.newPositions),
    closedPositions: num(it.closedPositions),
    increasedPositions: num(it.increasedPositions),
    reducedPositions: num(it.reducedPositions),
    totalCalls: num(it.totalCalls),
    totalPuts: num(it.totalPuts),
    putCallRatio: num(it.putCallRatio),
  };
}

function recentQuarters(maxBack = 8) {
  const out = [];
  const now = new Date();
  let y = now.getUTCFullYear();
  let q = Math.floor(now.getUTCMonth() / 3);
  if (q === 0) { q = 4; y -= 1; }
  for (let i = 0; i < maxBack; i++) {
    out.push({ year: y, quarter: q });
    q -= 1;
    if (q < 1) { q = 4; y -= 1; }
  }
  return out;
}

// Yahoo Finance fallback via yahoo-finance2 (handles crumb auth automatically).
async function fetchYahoo13F(symbol) {
  try {
    const summary = await yahoo.quoteSummary(symbol, {
      modules: ['majorHoldersBreakdown', 'netSharePurchaseActivity'],
    });
    const mhb = summary?.majorHoldersBreakdown || {};
    const nspa = summary?.netSharePurchaseActivity || {};

    const instPct = mhb.institutionsPercentHeld ?? null;
    const instCount = mhb.institutionsCount ?? mhb.institutionCount ?? null;
    const buys = nspa.buyInfoCount ?? null;
    const sells = nspa.sellInfoCount ?? null;
    const buyShares = nspa.buyInfoShares ?? null;
    const sellShares = nspa.sellInfoShares ?? null;
    const period = nspa.period || null;

    if (instPct == null && instCount == null && buys == null) return null;

    const flowScore = (buys != null && sells != null && (buys + sells) > 0)
      ? (buys - sells) / (buys + sells) : null;

    const today = new Date().toISOString().slice(0, 10);
    const syntheticQuarter = {
      date: period || today,
      investorsHolding: instCount,
      investorsHoldingChange: null,
      numberOf13Fshares: buyShares != null && sellShares != null ? buyShares - sellShares : null,
      numberOf13FsharesChange: null,
      totalInvested: null,
      totalInvestedChange: null,
      ownershipPercent: instPct != null ? instPct * 100 : null,
      lastOwnershipPercent: null,
      newPositions: buys,
      closedPositions: sells,
      increasedPositions: null,
      reducedPositions: null,
      putCallRatio: null,
    };

    const summaryObj = {
      asOf: period || today,
      ownershipPercent: instPct != null ? instPct * 100 : null,
      ownershipPercentChange: null,
      investorsHolding: instCount,
      investorsHoldingChange: null,
      totalInvested: null,
      totalInvestedChange: null,
      numberOf13Fshares: syntheticQuarter.numberOf13Fshares,
      sharesPctChange: null,
      newPositions: buys,
      closedPositions: sells,
      increasedPositions: null,
      reducedPositions: null,
      putCallRatio: null,
      churnRatio: null,
      flowScore,
    };

    return { summary: summaryObj, history: [syntheticQuarter], source: 'yahoo' };
  } catch { return null; }
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const symbol = (searchParams.get('symbol') || '').toUpperCase();
  if (!symbol) return Response.json({ error: 'symbol required' }, { status: 400 });

  const cacheKey = `holdings:${symbol}`;
  const cached = getCached(cacheKey);
  if (cached) return Response.json(cached);

  const key = process.env.FMP_API_KEY;

  if (key) {
    const slots = recentQuarters(6);
    const fetched = await Promise.all(slots.map((s) => fetchQuarter(symbol, s.year, s.quarter, key)));
    let history = fetched.map(normalizeQuarter).filter(Boolean);
    history.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    while (history.length >= 2) {
      const last = history[history.length - 1];
      const prior = history[history.length - 2];
      if (last.investorsHolding != null && prior.investorsHolding > 0
          && last.investorsHolding < 0.6 * prior.investorsHolding) {
        history.pop();
      } else break;
    }
    if (history.length) {
      const latest = history[history.length - 1];
      const prev = history[history.length - 2] || {};
      const sharesPctChange = (prev.numberOf13Fshares && latest.numberOf13Fshares != null)
        ? (latest.numberOf13Fshares - prev.numberOf13Fshares) / prev.numberOf13Fshares : null;
      const adds = (latest.newPositions || 0) + (latest.increasedPositions || 0);
      const cuts = (latest.closedPositions || 0) + (latest.reducedPositions || 0);
      const flowScore = (adds + cuts) > 0 ? (adds - cuts) / (adds + cuts) : null;
      const churnRatio = (latest.investorsHolding || 0) > 0 ? (adds + cuts) / latest.investorsHolding : null;
      const summary = {
        asOf: latest.date, ownershipPercent: latest.ownershipPercent,
        ownershipPercentChange: latest.ownershipPercent != null && latest.lastOwnershipPercent != null
          ? latest.ownershipPercent - latest.lastOwnershipPercent : null,
        investorsHolding: latest.investorsHolding, investorsHoldingChange: latest.investorsHoldingChange,
        totalInvested: latest.totalInvested, totalInvestedChange: latest.totalInvestedChange,
        numberOf13Fshares: latest.numberOf13Fshares, sharesPctChange,
        newPositions: latest.newPositions, closedPositions: latest.closedPositions,
        increasedPositions: latest.increasedPositions, reducedPositions: latest.reducedPositions,
        putCallRatio: latest.putCallRatio, churnRatio, flowScore,
      };
      const out = { symbol, summary, history, source: 'fmp', ts: new Date().toISOString() };
      setCache(cacheKey, out, TWELVE_HOURS);
      return Response.json(out);
    }
  }

  const yahooData = await fetchYahoo13F(symbol);
  if (yahooData) {
    const out = { symbol, ...yahooData, ts: new Date().toISOString() };
    setCache(cacheKey, out, TWELVE_HOURS);
    return Response.json(out);
  }

  const empty = { symbol, source: 'unavailable', summary: {}, history: [], ts: new Date().toISOString() };
  setCache(cacheKey, empty, 30 * 60 * 1000);
  return Response.json(empty);
}