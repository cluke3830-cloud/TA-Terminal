export const dynamic = 'force-dynamic';

import { getCached, setCache } from '../_cache';

const FMP = 'https://financialmodelingprep.com';
const SIX_HOURS = 6 * 60 * 60 * 1000;
const ONE_DAY = 24 * 60 * 60 * 1000;

// SEC EDGAR requires a descriptive User-Agent (10 req/sec hard cap).
const SEC_UA = 'Quantum Stock Terminal contact@quantum-terminal.dev';

// ── FMP primary path ────────────────────────────────────────────────────────
async function fmpInsider(symbol, key, daysBack) {
  if (!key) return null;
  const cutoff = Date.now() - daysBack * 24 * 60 * 60 * 1000;
  // FMP free-tier (post-Aug-2025): /stable/insider-trading/search is the path
  // that actually returns rich Form 4 transaction-level data. The legacy
  // v3/v4 paths return "Legacy Endpoint" errors for new keys.
  const paths = [
    `${FMP}/stable/insider-trading/search?symbol=${symbol}&limit=100&apikey=${key}`,
    `${FMP}/stable/insider-trading?symbol=${symbol}&limit=100&apikey=${key}`,
    `${FMP}/api/v4/insider-trading?symbol=${symbol}&page=0&apikey=${key}`,
  ];
  for (const url of paths) {
    try {
      const r = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!r.ok) continue;
      const j = await r.json();
      if (!Array.isArray(j) || j.length === 0) continue;
      // Normalize -> { date, insider, title, type, shares, price, value, link }
      const rows = j.map((it) => {
        const date = it.transactionDate || it.filingDate || it.date;
        const shares = +(it.securitiesTransacted ?? it.shares ?? 0);
        const price = +(it.price ?? it.transactionPrice ?? 0);
        // FMP returns combo strings like "S-Sale", "P-Purchase", "M-Exercise",
        // "F-InKindTaxLiability", "G-Gift". `acquisitionOrDisposition` carries
        // the canonical A/D flag.
        const code = String(it.transactionType || it.acquisitionOrDisposition || it.typeOfTransaction || '').toUpperCase();
        // SEC Form 4 codes: P=open-market purchase, S=open-market sale,
        // A=grant, M=option exercise, F=tax-withholding, G=gift, etc.
        // We treat A-letter codes containing P or "Purchase" as buys.
        let type = 'OTHER';
        if (/(^|-)P($|-)|PURCHASE|BUY|ACQUIRE/.test(code)) type = 'BUY';
        else if (/(^|-)S($|-)|SALE|SELL|DISPOSE/.test(code)) type = 'SELL';
        return {
          date: typeof date === 'string' ? date.slice(0, 10) : null,
          insider: it.reportingName || it.insiderName || it.name || null,
          title: it.typeOfOwner || it.relationship || it.officerTitle || null,
          type,
          rawCode: code,
          shares: isFinite(shares) ? shares : 0,
          price: isFinite(price) ? price : 0,
          value: (isFinite(shares) && isFinite(price)) ? shares * price : 0,
          link: it.link || it.url || null,
        };
      })
        .filter((r) => r.date && r.insider)
        .filter((r) => new Date(r.date).getTime() >= cutoff);
      if (rows.length === 0) continue;
      return { rows, source: 'fmp' };
    } catch { /* try next */ }
  }
  return null;
}

// ── EDGAR fallback (filing list only — values not parsed from XML) ──────────
let TICKER_MAP = null;
let TICKER_MAP_TS = 0;
async function loadTickerMap() {
  if (TICKER_MAP && (Date.now() - TICKER_MAP_TS) < 24 * ONE_DAY) return TICKER_MAP;
  try {
    const r = await fetch('https://www.sec.gov/files/company_tickers.json', {
      headers: { 'User-Agent': SEC_UA, Accept: 'application/json' },
    });
    if (!r.ok) return null;
    const j = await r.json();
    const m = new Map();
    Object.values(j).forEach((row) => {
      if (row?.ticker && row?.cik_str != null) m.set(row.ticker.toUpperCase(), String(row.cik_str).padStart(10, '0'));
    });
    TICKER_MAP = m;
    TICKER_MAP_TS = Date.now();
    return m;
  } catch { return null; }
}

async function edgarFilings(symbol, daysBack) {
  const map = await loadTickerMap();
  const cik = map?.get(symbol);
  if (!cik) return null;
  try {
    const r = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, {
      headers: { 'User-Agent': SEC_UA, Accept: 'application/json' },
    });
    if (!r.ok) return null;
    const j = await r.json();
    const recent = j?.filings?.recent;
    if (!recent || !Array.isArray(recent.form)) return null;
    const cutoff = Date.now() - daysBack * 24 * 60 * 60 * 1000;
    const rows = [];
    for (let i = 0; i < recent.form.length; i++) {
      if (recent.form[i] !== '4') continue;
      const filed = recent.filingDate?.[i];
      if (!filed || new Date(filed).getTime() < cutoff) continue;
      const acc = recent.accessionNumber?.[i] || '';
      const accNoDash = acc.replace(/-/g, '');
      rows.push({
        date: filed,
        insider: recent.primaryDocDescription?.[i] || 'see filing',
        title: null,
        type: 'OTHER',
        rawCode: 'FORM-4',
        shares: 0,
        price: 0,
        value: 0,
        link: acc ? `https://www.sec.gov/Archives/edgar/data/${parseInt(cik, 10)}/${accNoDash}/${acc}-index.htm` : null,
      });
    }
    return { rows, source: 'edgar' };
  } catch { return null; }
}

function summarize(rows) {
  let buyCount = 0, sellCount = 0;
  let netShares = 0, netUSD = 0;
  let buyUSD = 0, sellUSD = 0;
  const insiderMap = new Map();
  for (const r of rows) {
    const k = r.insider || 'unknown';
    if (!insiderMap.has(k)) insiderMap.set(k, { name: k, title: r.title, buys: 0, sells: 0, netShares: 0, netUSD: 0 });
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
  const aggregateByInsider = [...insiderMap.values()]
    .sort((a, b) => Math.abs(b.netUSD) - Math.abs(a.netUSD))
    .slice(0, 12);
  return {
    counts: { buy: buyCount, sell: sellCount, total: buyCount + sellCount },
    netShares, netUSD, buyUSD, sellUSD,
    uniqueInsiders: insiderMap.size,
    aggregateByInsider,
  };
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const symbol = (searchParams.get('symbol') || '').toUpperCase();
  const days = Math.min(365, Math.max(7, parseInt(searchParams.get('days') || '90', 10)));
  if (!symbol) return Response.json({ error: 'symbol required' }, { status: 400 });

  const cacheKey = `insider:${symbol}:${days}`;
  const cached = getCached(cacheKey);
  if (cached) return Response.json(cached);

  let result = null;
  try { result = await fmpInsider(symbol, process.env.FMP_API_KEY, days); } catch {}
  if (!result || !result.rows.length) {
    try { result = await edgarFilings(symbol, days); } catch {}
  }
  if (!result || !result.rows.length) {
    const empty = { symbol, days, transactions: [], summary: { counts: { buy: 0, sell: 0, total: 0 }, netShares: 0, netUSD: 0, buyUSD: 0, sellUSD: 0, uniqueInsiders: 0, aggregateByInsider: [] }, source: 'unavailable', ts: new Date().toISOString() };
    setCache(cacheKey, empty, 30 * 60 * 1000);
    return Response.json(empty);
  }

  // Sort newest first, cap at 80 rows for the table.
  const transactions = [...result.rows].sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 80);
  const summary = summarize(result.rows);

  const out = {
    symbol, days,
    transactions,
    summary,
    source: result.source,
    ts: new Date().toISOString(),
  };
  setCache(cacheKey, out, SIX_HOURS);
  return Response.json(out);
}
