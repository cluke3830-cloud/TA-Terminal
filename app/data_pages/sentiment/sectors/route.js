export const dynamic = 'force-dynamic';

import YahooFinance from 'yahoo-finance2';
import { getCached, setCache } from '../../_cache';
import { SECTOR_BELLWETHERS, colorFor } from '../../../lib/sectors';

const yahoo = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

async function fetchHeadlines(symbol) {
  try {
    const s = await yahoo.search(symbol, { newsCount: 4, quotesCount: 0 });
    return (s?.news || []).map((n) => n.title).filter(Boolean);
  } catch { return []; }
}

async function score(origin, texts) {
  if (!texts.length) return [];
  try {
    const r = await fetch(`${origin}/data_pages/sentiment/gpu`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts }),
    });
    if (!r.ok) return [];
    const j = await r.json();
    return j.results || [];
  } catch { return []; }
}

export async function GET(req) {
  const cacheKey = 'sentiment:sectors';
  const cached = getCached(cacheKey);
  if (cached) return Response.json(cached);

  const origin = new URL(req.url).origin;
  const sectorEntries = Object.entries(SECTOR_BELLWETHERS);

  // Fetch headlines for all bellwethers (chunked to be polite to Yahoo).
  const sectorHeadlines = {};
  for (const [sector, tickers] of sectorEntries) {
    const lists = await Promise.all(tickers.map(fetchHeadlines));
    sectorHeadlines[sector] = lists.flat();
  }

  // Batch all titles into one FinBERT call.
  const flat = [];
  const indexBySector = {};
  for (const [sector, titles] of Object.entries(sectorHeadlines)) {
    indexBySector[sector] = [];
    for (const t of titles) {
      indexBySector[sector].push(flat.length);
      flat.push(t);
    }
  }
  const scored = await score(origin, flat);

  const sectors = sectorEntries.map(([sector]) => {
    const idx = indexBySector[sector];
    const sScores = idx.map((i) => scored[i]).filter(Boolean);
    if (!sScores.length) return { name: sector, score: null, color: colorFor(null), n: 0 };
    const meanS = sScores.reduce((s, x) => s + (x.positive - x.negative), 0) / sScores.length;
    return { name: sector, score: +meanS.toFixed(4), color: colorFor(meanS), n: sScores.length };
  });

  const result = {
    sectors,
    sentimentAvailable: scored.length > 0,
    ts: new Date().toISOString(),
  };
  setCache(cacheKey, result, 30 * 60 * 1000);
  return Response.json(result);
}