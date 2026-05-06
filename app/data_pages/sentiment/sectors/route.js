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

async function scoreFinBERT(origin, texts) {
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

// Loughran-McDonald financial lexicon fallback when FinBERT GPU is offline.
const POS = new Set([
  'beat','beats','beating','exceed','exceeds','exceeded','surge','surges','surged','rally','rallies','rallied',
  'soar','soars','soared','jump','jumps','jumped','climb','climbs','climbed','gain','gains','gained',
  'growth','grow','grew','growing','strong','stronger','strongest','record','high','highs','outperform','outperforms',
  'upgrade','upgrades','upgraded','positive','profit','profits','profitable','breakthrough','milestone',
  'partnership','expansion','launches','launch','launched','wins','win','approved','approval','boost','boosts','boosted',
  'rises','rise','rose','rising','top','tops','topped','accelerate','accelerates','accelerated','optimistic','bullish',
]);
const NEG = new Set([
  'miss','misses','missed','missing','plunge','plunges','plunged','drop','drops','dropped','dropping',
  'fall','falls','fell','falling','crash','crashes','crashed','tumble','tumbles','tumbled','slide','slides','slid',
  'loss','losses','losing','lose','lost','weak','weaker','weakest','low','lows','underperform','underperforms',
  'downgrade','downgrades','downgraded','negative','warning','warns','warned','cut','cuts',
  'lawsuit','sues','sued','probe','investigation','recall','recalls','recalled','layoff','layoffs','fired',
  'concerns','concerned','risk','risks','decline','declines','declined','declining','bearish','pessimistic',
  'fraud','scandal','breach','hack','hacked','outage','disruption','crisis','collapse','bankruptcy',
]);

function lexiconScore(title) {
  if (!title) return null;
  const words = title.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  let pos = 0, neg = 0;
  for (const w of words) {
    if (POS.has(w)) pos++;
    else if (NEG.has(w)) neg++;
  }
  const wordCount = Math.max(words.length, 1);
  const posScore = Math.min(pos / wordCount * 4, 1);
  const negScore = Math.min(neg / wordCount * 4, 1);
  const neuScore = Math.max(1 - posScore - negScore, 0);
  return { positive: +posScore.toFixed(3), negative: +negScore.toFixed(3), neutral: +neuScore.toFixed(3) };
}

export async function GET(req) {
  const cacheKey = 'sentiment:sectors';
  const cached = getCached(cacheKey);
  if (cached) return Response.json(cached);

  const origin = new URL(req.url).origin;
  const sectorEntries = Object.entries(SECTOR_BELLWETHERS);

  const sectorHeadlines = {};
  for (const [sector, tickers] of sectorEntries) {
    const lists = await Promise.all(tickers.map(fetchHeadlines));
    sectorHeadlines[sector] = lists.flat();
  }

  const flat = [];
  const indexBySector = {};
  for (const [sector, titles] of Object.entries(sectorHeadlines)) {
    indexBySector[sector] = [];
    for (const t of titles) {
      indexBySector[sector].push(flat.length);
      flat.push(t);
    }
  }

  const finbertScores = await scoreFinBERT(origin, flat);
  const usingFinBERT = finbertScores.length > 0;
  const scored = usingFinBERT ? finbertScores : flat.map(lexiconScore);

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
    sentimentSource: usingFinBERT ? 'finbert' : 'lexicon',
    ts: new Date().toISOString(),
  };
  setCache(cacheKey, result, 30 * 60 * 1000);
  return Response.json(result);
}