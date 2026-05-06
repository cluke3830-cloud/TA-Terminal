export const dynamic = 'force-dynamic';

import YahooFinance from 'yahoo-finance2';
import { getCached, setCache } from '../_cache';

const yahoo = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
const FMP = 'https://financialmodelingprep.com/stable';

async function yahooNews(symbol) {
  try {
    const s = await yahoo.search(symbol, { newsCount: 10, quotesCount: 0 });
    return (s?.news || []).map((n) => ({
      title: n.title,
      url: n.link,
      source: 'yahoo',
      site: n.publisher,
      date: n.providerPublishTime ? new Date(n.providerPublishTime * 1000).toISOString() : null,
    }));
  } catch { return []; }
}

async function fmpNews(symbol, key) {
  if (!key) return [];
  try {
    const r = await fetch(`${FMP}/stock-news?tickers=${symbol}&limit=10&apikey=${key}`);
    if (!r.ok) return [];
    const arr = await r.json();
    if (!Array.isArray(arr)) return [];
    return arr.map((n) => ({
      title: n.title,
      url: n.url,
      source: 'fmp',
      site: n.site,
      date: n.publishedDate ? new Date(n.publishedDate).toISOString() : null,
    }));
  } catch { return []; }
}

async function scoreSentiment(origin, titles) {
  if (!titles.length) return [];
  try {
    const r = await fetch(`${origin}/data_pages/sentiment/gpu`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts: titles }),
    });
    if (!r.ok) return [];
    const j = await r.json();
    return j.results || [];
  } catch { return []; }
}

// Lexicon-based sentiment fallback when FinBERT GPU is offline.
// Loughran-McDonald financial sentiment word list (subset of strong signals).
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
  'downgrade','downgrades','downgraded','negative','warning','warns','warned','cut','cuts','cuts','cut',
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
  const total = pos + neg;
  if (total === 0) return { positive: 0.0, negative: 0.0, neutral: 1.0 };
  // Normalize against word count; clamp to keep magnitudes reasonable
  const wordCount = Math.max(words.length, 1);
  const posScore = Math.min(pos / wordCount * 4, 1);
  const negScore = Math.min(neg / wordCount * 4, 1);
  const neuScore = Math.max(1 - posScore - negScore, 0);
  return { positive: +posScore.toFixed(3), negative: +negScore.toFixed(3), neutral: +neuScore.toFixed(3) };
}

function rolling(articles, days) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const recent = articles.filter((a) => a.date && new Date(a.date).getTime() >= cutoff && a.sentiment);
  if (!recent.length) return null;
  const s = recent.reduce((sum, a) => sum + (a.sentiment.positive - a.sentiment.negative), 0);
  return +(s / recent.length).toFixed(4);
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const symbol = (searchParams.get('symbol') || 'AMD').toUpperCase();
  const cacheKey = `news:${symbol}`;
  const cached = getCached(cacheKey);
  if (cached) return Response.json(cached);

  const [yhoo, fmp] = await Promise.all([
    yahooNews(symbol),
    fmpNews(symbol, process.env.FMP_API_KEY),
  ]);

  // Dedupe by title.
  const seen = new Set();
  const merged = [...yhoo, ...fmp].filter((a) => {
    if (!a.title || seen.has(a.title)) return false;
    seen.add(a.title);
    return true;
  });
  // Sort by date desc.
  merged.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  const origin = new URL(req.url).origin;
  const titles = merged.map((a) => a.title);
  const gpuScores = await scoreSentiment(origin, titles);
  const usingFinBERT = gpuScores.length > 0;
  const scores = usingFinBERT ? gpuScores : titles.map(lexiconScore);
  const articles = merged.map((a, i) => ({
    ...a,
    sentiment: scores[i] || null,
  }));

  const result = {
    symbol,
    articles,
    rolling: {
      d7: rolling(articles, 7),
      d30: rolling(articles, 30),
    },
    sentimentAvailable: scores.length > 0,
    sentimentSource: usingFinBERT ? 'finbert' : 'lexicon',
    ts: new Date().toISOString(),
  };
  setCache(cacheKey, result, 15 * 60 * 1000);
  return Response.json(result);
}