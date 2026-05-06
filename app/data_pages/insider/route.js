// Insider transactions via SEC EDGAR Form 4 filings — no API key required.
// Flow: ticker → CIK → submissions JSON → Form 4 XML files → parsed transactions.
// EDGAR rate limit: 10 req/sec. Batching keeps us well under that.

export const dynamic = 'force-dynamic';

import { getCached, setCache } from '../_cache';
import { getCIK, EDGAR_HEADERS, parseForm4XML, batchFetch } from '../_edgar';

const SIX_HOURS = 6 * 60 * 60 * 1000;
const MAX_FILINGS = 30;

function summarize(rows) {
  let buyCount = 0, sellCount = 0, netShares = 0, netUSD = 0, buyUSD = 0, sellUSD = 0;
  const insiderMap = new Map();

  for (const r of rows) {
    const k = r.insider || 'unknown';
    if (!insiderMap.has(k)) {
      insiderMap.set(k, { name: k, title: r.title, buys: 0, sells: 0, netShares: 0, netUSD: 0 });
    }
    const agg = insiderMap.get(k);

    if (r.type === 'BUY') {
      buyCount++; buyUSD += r.value;
      netShares += r.shares; netUSD += r.value;
      agg.buys++; agg.netShares += r.shares; agg.netUSD += r.value;
    } else if (r.type === 'SELL') {
      sellCount++; sellUSD += r.value;
      netShares -= r.shares; netUSD -= r.value;
      agg.sells++; agg.netShares -= r.shares; agg.netUSD -= r.value;
    }
    if (r.title && !agg.title) agg.title = r.title;
  }

  return {
    counts: { buy: buyCount, sell: sellCount, total: buyCount + sellCount },
    netShares, netUSD, buyUSD, sellUSD,
    uniqueInsiders: insiderMap.size,
    aggregateByInsider: [...insiderMap.values()]
      .sort((a, b) => Math.abs(b.netUSD) - Math.abs(a.netUSD))
      .slice(0, 12),
  };
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const symbol = (searchParams.get('symbol') || '').toUpperCase();
  const days = Math.min(365, Math.max(7, parseInt(searchParams.get('days') || '90', 10)));

  if (!symbol) return Response.json({ error: 'symbol required' }, { status: 400 });

  const cacheKey = `insider:edgar:${symbol}:${days}`;
  const hit = getCached(cacheKey);
  if (hit) return Response.json(hit);

  const empty = {
    symbol, days,
    transactions: [],
    summary: {
      counts: { buy: 0, sell: 0, total: 0 },
      netShares: 0, netUSD: 0, buyUSD: 0, sellUSD: 0,
      uniqueInsiders: 0, aggregateByInsider: [],
    },
    source: 'edgar',
    ts: new Date().toISOString(),
  };

  const cik = await getCIK(symbol);
  if (!cik) {
    setCache(cacheKey, empty, 30 * 60 * 1000);
    return Response.json(empty);
  }

  // Fetch submissions index for this company
  let submissions;
  try {
    const r = await fetch(
      `https://data.sec.gov/submissions/CIK${cik}.json`,
      { headers: EDGAR_HEADERS }
    );
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    submissions = await r.json();
  } catch {
    setCache(cacheKey, empty, 15 * 60 * 1000);
    return Response.json(empty);
  }

  const recent = submissions?.filings?.recent;
  if (!recent?.form) {
    setCache(cacheKey, empty, SIX_HOURS);
    return Response.json(empty);
  }

  // Collect Form 4 filings within the date window that have an XML primary doc
  const cutoff = Date.now() - days * 24 * 3600 * 1000;
  const filings = [];

  for (let i = 0; i < recent.form.length && filings.length < MAX_FILINGS; i++) {
    if (recent.form[i] !== '4') continue;
    const filed = recent.filingDate?.[i];
    if (!filed || new Date(filed).getTime() < cutoff) continue;
    const primaryDoc = recent.primaryDocument?.[i];
    if (!primaryDoc?.endsWith('.xml')) continue;
    filings.push({ acc: recent.accessionNumber[i], primaryDoc });
  }

  if (!filings.length) {
    setCache(cacheKey, empty, SIX_HOURS);
    return Response.json(empty);
  }

  // Fetch and parse Form 4 XMLs in batches (5 at a time, ~600ms gap = ~8 req/sec)
  const tasks = filings.map(f => () => parseForm4XML(cik, f.acc, f.primaryDoc));
  const parsed = await batchFetch(tasks, 5, 600);

  const allRows = parsed.flat().filter(r => r.date && r.insider);
  const transactions = [...allRows]
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .slice(0, 80);

  const out = {
    symbol, days,
    transactions,
    summary: summarize(allRows),
    source: 'edgar',
    ts: new Date().toISOString(),
  };

  setCache(cacheKey, out, SIX_HOURS);
  return Response.json(out);
}