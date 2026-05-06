// Financial statements via SEC EDGAR XBRL API — no API key required.
// Primary: EDGAR companyconcept (official, free, unlimited)
// Computes: income statement, balance sheet, cash flow, and available ratios.
// Price-based ratios (P/E, P/B, P/S) are null — EDGAR has no price data.

export const dynamic = 'force-dynamic';

import { getCached, setCache } from '../_cache';
import { getCIK, bestConcept, quarterly, matchVal, periodLabel } from '../_edgar';

const HOUR = 60 * 60 * 1000;

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

  // Fetch all needed XBRL concepts in parallel
  const [rev, ni, assets, debt, equity, opCF, capex, gp, curA, curL] = await Promise.all([
    bestConcept(cik,
      'Revenues',
      'RevenueFromContractWithCustomerExcludingAssessedTax',
      'SalesRevenueNet',
      'RevenueFromContractWithCustomerIncludingAssessedTax',
    ),
    bestConcept(cik, 'NetIncomeLoss', 'ProfitLoss'),
    bestConcept(cik, 'Assets'),
    bestConcept(cik, 'LongTermDebt', 'LongTermDebtNoncurrent'),
    bestConcept(cik, 'StockholdersEquity', 'StockholdersEquityAttributableToParent'),
    bestConcept(cik, 'NetCashProvidedByUsedInOperatingActivities'),
    bestConcept(cik, 'PaymentsToAcquirePropertyPlantAndEquipment'),
    bestConcept(cik, 'GrossProfit'),
    bestConcept(cik, 'AssetsCurrent'),
    bestConcept(cik, 'LiabilitiesCurrent'),
  ]);

  // ── Income statement ──────────────────────────────────────────────────────
  const revQ = quarterly(rev);
  const income = revQ.map(e => ({
    period: periodLabel(e),
    date: e.end,
    revenue: e.val,
    netIncome: matchVal(ni, e.end),
    eps: null,
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

  // ── Ratios (computed from EDGAR data; price-based ratios left null) ───────
  const b0 = balance[0] ?? {};
  const gpVal = quarterly(gp)[0]?.val ?? null;
  const revVal = revQ[0]?.val ?? null;
  const ttmNI = income.slice(0, 4).reduce((s, q) => s + (q.netIncome ?? 0), 0);
  const ttmRev = income.slice(0, 4).reduce((s, q) => s + (q.revenue ?? 0), 0);
  const curAVal = quarterly(curA)[0]?.val ?? null;
  const curLVal = quarterly(curL)[0]?.val ?? null;

  const ratios = {
    priceToEarningsRatioTTM: null,
    priceToBookRatioTTM: null,
    priceToSalesRatioTTM: null,
    debtToEquityRatioTTM:
      b0.totalDebt != null && b0.totalStockholdersEquity
        ? b0.totalDebt / b0.totalStockholdersEquity
        : null,
    debtToAssetsRatioTTM:
      b0.totalDebt != null && b0.totalAssets
        ? b0.totalDebt / b0.totalAssets
        : null,
    currentRatioTTM: curAVal && curLVal ? curAVal / curLVal : null,
    priceToFreeCashFlowRatioTTM: null,
    grossProfitMarginTTM: gpVal && revVal ? gpVal / revVal : null,
    netProfitMarginTTM: ttmRev ? ttmNI / ttmRev : null,
  };

  const result = {
    profile: { companyName: symbol, name: symbol },
    ratios,
    income,
    balance,
    cashflow,
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