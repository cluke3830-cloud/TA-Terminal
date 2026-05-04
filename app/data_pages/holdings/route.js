export const dynamic = 'force-dynamic';

import { getCached, setCache } from '../_cache';

const FMP = 'https://financialmodelingprep.com';
const TWELVE_HOURS = 12 * 60 * 60 * 1000;

// FMP free-tier (post-Aug-2025) only exposes the AGGREGATE 13F summary, not
// per-holder positions. We pull the last 4 quarterly snapshots and surface
// the QoQ flow (new/closed/increased/reduced + ownership %) instead of a
// top-holders list.

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
  const num = (v) => {
    const n = +v;
    return isFinite(n) ? n : null;
  };
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

// Walk back from "now" through up to 8 quarter slots (some may be empty
// because the filing window hasn't closed yet).
function recentQuarters(maxBack = 8) {
  const out = [];
  const now = new Date();
  // Filings settle ~45 days after quarter-end, so start one quarter back from
  // the current calendar quarter to avoid a perpetual empty slot.
  let y = now.getUTCFullYear();
  let q = Math.floor(now.getUTCMonth() / 3); // current quarter index 0..3, but we want the PRIOR one
  if (q === 0) { q = 4; y -= 1; }
  for (let i = 0; i < maxBack; i++) {
    out.push({ year: y, quarter: q });
    q -= 1;
    if (q < 1) { q = 4; y -= 1; }
  }
  return out;
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const symbol = (searchParams.get('symbol') || '').toUpperCase();
  if (!symbol) return Response.json({ error: 'symbol required' }, { status: 400 });

  const cacheKey = `holdings:${symbol}`;
  const cached = getCached(cacheKey);
  if (cached) return Response.json(cached);

  const key = process.env.FMP_API_KEY;
  if (!key) {
    const empty = { symbol, source: 'unavailable', summary: {}, history: [], ts: new Date().toISOString() };
    setCache(cacheKey, empty, 30 * 60 * 1000);
    return Response.json(empty);
  }

  const slots = recentQuarters(6);
  const fetched = await Promise.all(slots.map((s) => fetchQuarter(symbol, s.year, s.quarter, key)));
  let history = fetched.map(normalizeQuarter).filter(Boolean);
  // Sort ascending by date so the UI can plot newest-on-the-right.
  history.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  // Drop trailing quarters that are still in the 45-day filing window — they
  // appear with a fraction of the holder count of the prior period and look
  // like a crash even though they're just under-reported. Heuristic: holder
  // count < 60% of the prior quarter's count.
  while (history.length >= 2) {
    const last = history[history.length - 1];
    const prior = history[history.length - 2];
    if (last.investorsHolding != null && prior.investorsHolding > 0
        && last.investorsHolding < 0.6 * prior.investorsHolding) {
      history.pop();
    } else break;
  }

  if (!history.length) {
    const empty = { symbol, source: 'unavailable', summary: {}, history: [], ts: new Date().toISOString() };
    setCache(cacheKey, empty, 30 * 60 * 1000);
    return Response.json(empty);
  }

  const latest = history[history.length - 1];
  const prev = history[history.length - 2] || {};

  // % change-in-shares vs prior quarter, normalized to a fraction.
  const sharesPctChange = (prev.numberOf13Fshares && latest.numberOf13Fshares != null)
    ? (latest.numberOf13Fshares - prev.numberOf13Fshares) / prev.numberOf13Fshares
    : null;

  // Activity ratio: how much portfolio churn is happening.
  const activeMoves = (latest.newPositions || 0) + (latest.closedPositions || 0)
    + (latest.increasedPositions || 0) + (latest.reducedPositions || 0);
  const totalHolders = latest.investorsHolding || 0;
  const churnRatio = totalHolders > 0 ? activeMoves / totalHolders : null;

  // Bullish flow score: net positions added vs reduced as a fraction of total.
  const adds = (latest.newPositions || 0) + (latest.increasedPositions || 0);
  const cuts = (latest.closedPositions || 0) + (latest.reducedPositions || 0);
  const flowScore = (adds + cuts) > 0 ? (adds - cuts) / (adds + cuts) : null;

  const summary = {
    asOf: latest.date,
    ownershipPercent: latest.ownershipPercent,           // 0-100 scale from FMP
    ownershipPercentChange: latest.ownershipPercent != null && latest.lastOwnershipPercent != null
      ? latest.ownershipPercent - latest.lastOwnershipPercent : null,
    investorsHolding: latest.investorsHolding,
    investorsHoldingChange: latest.investorsHoldingChange,
    totalInvested: latest.totalInvested,
    totalInvestedChange: latest.totalInvestedChange,
    numberOf13Fshares: latest.numberOf13Fshares,
    sharesPctChange,
    newPositions: latest.newPositions,
    closedPositions: latest.closedPositions,
    increasedPositions: latest.increasedPositions,
    reducedPositions: latest.reducedPositions,
    putCallRatio: latest.putCallRatio,
    churnRatio,
    flowScore, // -1 (all cuts) .. +1 (all adds)
  };

  const out = {
    symbol,
    summary,
    history,
    source: 'fmp',
    ts: new Date().toISOString(),
  };
  setCache(cacheKey, out, TWELVE_HOURS);
  return Response.json(out);
}
