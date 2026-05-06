// Financial statements via SEC EDGAR XBRL API — no API key required.
// Primary: EDGAR companyconcept (official, free, unlimited).
// Price-based ratios (P/E, P/B, P/S, P/FCF) come from EDGAR fundamentals
// combined with the latest Alpaca trade price + EDGAR shares outstanding.

export const dynamic = 'force-dynamic';

import { getCached, setCache } from '../_cache';
import { getCIK, bestConcept, bestConceptShares, bestConceptUnit, quarterly, matchVal, periodLabel } from '../_edgar';

const HOUR = 60 * 60 * 1000;

// Latest trade price from Alpaca IEX feed — used for market-cap based ratios.
async function getCurrentPrice(symbol) {
  const key = process.env.ALPACA_API_KEY;
  const secret = process.env.ALPACA_SECRET_KEY;
  if (!key || !secret) return null;
  try {
    const r = await fetch(
      `https://data.alpaca.markets/v2/stocks/${encodeURIComponent(symbol)}/trades/latest?feed=iex`,
      { headers: { 'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': secret } }
    );
    if (!r.ok) return null;
    const j = await r.json();
    return j?.trade?.p ?? null;
  } catch { return null; }
}

// Get the most recent annual (10-K, fp=FY) entry from a concept's data
function latestFY(data) {
  if (!data?.length) return null;
  return data
    .filter(e => e.form === '10-K' && e.fp === 'FY')
    .sort((a, b) => b.end.localeCompare(a.end))[0] ?? null;
}

// Get the most recent value of any kind (point-in-time concepts like shares)
function latestVal(data) {
  if (!data?.length) return null;
  return [...data].sort((a, b) => b.end.localeCompare(a.end))[0]?.val ?? null;
}

export async function loadFin(symbol) {
  symbol = (symbol || '').toUpperCase();
  if (!symbol) return null;

  const cacheKey = `fin:edgar:${symbol}`;
  const hit = getCached(cacheKey);
  if (hit) return hit;

  const cik = await getCIK(symbol);
  if (!cik) {
    const empty = { profile: {}, ratios: {}, income: [], balance: [], cashflow: [], source: 'unavailable' };
    setCache(cacheKey, empty, 5 * 60 * 1000);
    return empty;
  }

  // Fetch XBRL concepts in batches of 3 to stay under EDGAR's 10 req/sec limit.
  // Each bestConcept() may make 1-4 sequential requests internally.
  const conceptDefs = [
    () => bestConcept(cik, 'Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'SalesRevenueNet', 'RevenueFromContractWithCustomerIncludingAssessedTax'),
    () => bestConcept(cik, 'NetIncomeLoss', 'ProfitLoss'),
    () => bestConcept(cik, 'Assets'),
    () => bestConcept(cik, 'LongTermDebt', 'LongTermDebtNoncurrent'),
    () => bestConcept(cik, 'StockholdersEquity', 'StockholdersEquityAttributableToParent'),
    () => bestConcept(cik, 'NetCashProvidedByUsedInOperatingActivities'),
    () => bestConcept(cik,
      'PaymentsToAcquirePropertyPlantAndEquipment',
      'PaymentsToAcquireProductiveAssets',
      'PaymentsForCapitalImprovements',
      'PaymentsToAcquireOtherProductiveAssets',
    ),
    () => bestConcept(cik, 'GrossProfit'),
    () => bestConcept(cik, 'AssetsCurrent'),
    () => bestConcept(cik, 'LiabilitiesCurrent'),
    () => bestConceptShares(cik, 'EarningsPerShareDiluted', 'EarningsPerShareBasic'),
    () => bestConceptUnit(cik, 'shares',
      'CommonStockSharesOutstanding',
      'EntityCommonStockSharesOutstanding',
      'WeightedAverageNumberOfDilutedSharesOutstanding',
    ),
  ];

  // Fire price fetch in parallel with concepts
  const pricePromise = getCurrentPrice(symbol);

  const results = [];
  for (let i = 0; i < conceptDefs.length; i += 3) {
    const batch = await Promise.all(conceptDefs.slice(i, i + 3).map(fn => fn()));
    results.push(...batch);
    if (i + 3 < conceptDefs.length) await new Promise(r => setTimeout(r, 400));
  }
  const [rev, ni, assets, debt, equity, opCF, capex, gp, curA, curL, eps, sharesOut] = results;
  const price = await pricePromise;

  // ── Income statement ──────────────────────────────────────────────────────
  const revQ = quarterly(rev);
  const income = revQ.map(e => ({
    period: periodLabel(e),
    date: e.end,
    revenue: e.val,
    netIncome: matchVal(ni, e.end),
    eps: matchVal(eps, e.end),
  }));

  // ── Balance sheet ─────────────────────────────────────────────────────────
  const assetsQ = quarterly(assets);
  const balance = assetsQ.map(e => ({
    period: periodLabel(e),
    date: e.end,
    totalAssets: e.val,
    totalDebt: matchVal(debt, e.end),
    totalStockholdersEquity: matchVal(equity, e.end),
  }));

  // ── Cash flow ─────────────────────────────────────────────────────────────
  const opCFQ = quarterly(opCF);
  const cashflow = opCFQ.map(e => {
    const capexRaw = matchVal(capex, e.end);
    const capexAdj = capexRaw != null ? -Math.abs(capexRaw) : null;
    return {
      period: periodLabel(e),
      date: e.end,
      operatingCashFlow: e.val,
      capitalExpenditure: capexAdj,
      freeCashFlow: e.val != null && capexAdj != null ? e.val + capexAdj : null,
    };
  });

  // ── Ratios ────────────────────────────────────────────────────────────────
  const b0 = balance[0] ?? {};
  const gpVal = quarterly(gp)[0]?.val ?? null;
  const revVal = revQ[0]?.val ?? null;
  const curAVal = quarterly(curA)[0]?.val ?? null;
  const curLVal = quarterly(curL)[0]?.val ?? null;

  // Latest annual values for price-based ratios (used as TTM proxy)
  const fyRev   = latestFY(rev)?.val ?? null;
  const fyNI    = latestFY(ni)?.val  ?? null;
  const fyOpCF  = latestFY(opCF)?.val   ?? null;
  const fyCapEx = latestFY(capex)?.val  ?? null;
  const fyEPS   = latestFY(eps)?.val ?? null;
  const fyFCF   = (fyOpCF != null && fyCapEx != null) ? fyOpCF - Math.abs(fyCapEx) : null;
  const sharesOutVal = latestVal(sharesOut);
  const marketCap = (price && sharesOutVal) ? price * sharesOutVal : null;

  const ratios = {
    priceToEarningsRatioTTM:
      price && fyEPS ? price / fyEPS : null,
    priceToBookRatioTTM:
      marketCap && b0.totalStockholdersEquity ? marketCap / b0.totalStockholdersEquity : null,
    priceToSalesRatioTTM:
      marketCap && fyRev ? marketCap / fyRev : null,
    debtToEquityRatioTTM:
      b0.totalDebt != null && b0.totalStockholdersEquity
        ? b0.totalDebt / b0.totalStockholdersEquity
        : null,
    debtToAssetsRatioTTM:
      b0.totalDebt != null && b0.totalAssets
        ? b0.totalDebt / b0.totalAssets
        : null,
    currentRatioTTM: curAVal && curLVal ? curAVal / curLVal : null,
    priceToFreeCashFlowRatioTTM:
      marketCap && fyFCF ? marketCap / fyFCF : null,
    grossProfitMarginTTM: gpVal && revVal ? gpVal / revVal : null,
    netProfitMarginTTM: fyRev ? fyNI / fyRev : null,
  };

  const result = {
    profile: { companyName: symbol, name: symbol },
    ratios,
    income,
    balance,
    cashflow,
    marketCap,
    price,
    sharesOutstanding: sharesOutVal,
    source: 'edgar',
  };

  setCache(cacheKey, result, HOUR);
  return result;
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const symbol = (searchParams.get('symbol') || 'NVDA').toUpperCase();
  return Response.json(await loadFin(symbol));
}