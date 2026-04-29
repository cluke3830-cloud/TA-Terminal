export const dynamic = 'force-dynamic';

import { getCached, setCache } from '../_cache';
import YahooFinance from 'yahoo-finance2';

const yahoo = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

const FMP = 'https://financialmodelingprep.com/stable';

function num(v) { return v?.raw ?? (typeof v === 'number' ? v : null); }
function isoDate(d) {
  if (!d) return null;
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  if (typeof d === 'string') return d.slice(0, 10);
  if (d?.fmt) return d.fmt;
  return null;
}

async function fmpFin(symbol, key) {
  if (!key) return null;
  const get = async (path) => {
    try {
      const r = await fetch(`${FMP}/${path}${path.includes('?') ? '&' : '?'}apikey=${key}`);
      if (!r.ok) return null;
      const j = await r.json();
      if (j?.['Error Message']) return null;
      return j;
    } catch { return null; }
  };
  const [profile, ratios, income, balance, cashflow] = await Promise.all([
    get(`profile?symbol=${symbol}`),
    get(`ratios-ttm?symbol=${symbol}`),
    get(`income-statement?symbol=${symbol}&period=quarter&limit=5`),
    get(`balance-sheet-statement?symbol=${symbol}&period=quarter&limit=4`),
    get(`cash-flow-statement?symbol=${symbol}&period=quarter&limit=4`),
  ]);
  const arr = (d) => (Array.isArray(d) ? d : []);
  if (!profile && !ratios && arr(income).length === 0) return null;
  return {
    profile: arr(profile)[0] || {},
    ratios: arr(ratios)[0] || {},
    income: arr(income),
    balance: arr(balance),
    cashflow: arr(cashflow),
  };
}

async function yahooFin(symbol) {
  const m = await yahoo.quoteSummary(symbol, {
    modules: [
      'price', 'summaryProfile', 'financialData', 'defaultKeyStatistics', 'summaryDetail',
      'incomeStatementHistoryQuarterly', 'balanceSheetHistoryQuarterly', 'cashflowStatementHistoryQuarterly',
    ],
  }).catch(() => null);
  if (!m) return null;

  const fd = m.financialData || {};
  const ks = m.defaultKeyStatistics || {};
  const sd = m.summaryDetail || {};
  const profile = {
    companyName: m.price?.longName || m.price?.shortName || symbol,
    name: m.price?.shortName || m.price?.longName || symbol,
    industry: m.summaryProfile?.industry,
    sector: m.summaryProfile?.sector,
  };
  let peTtm = num(sd.trailingPE);
  if (peTtm == null) {
    const eps = num(ks.trailingEps);
    const price = num(m.price?.regularMarketPrice);
    if (eps && price) peTtm = price / eps;
  }
  const debtEq = num(fd.debtToEquity);
  const ratios = {
    priceToEarningsRatioTTM: peTtm,
    priceToBookRatioTTM: num(ks.priceToBook),
    priceToSalesRatioTTM: num(sd.priceToSalesTrailing12Months),
    debtToEquityRatioTTM: debtEq != null ? debtEq / 100 : null,
    debtToAssetsRatioTTM: null,
    currentRatioTTM: num(fd.currentRatio),
    priceToFreeCashFlowRatioTTM: null,
    grossProfitMarginTTM: num(fd.grossMargins),
    netProfitMarginTTM: num(fd.profitMargins),
  };

  const buildPeriod = (date) => {
    const dStr = isoDate(date);
    if (!dStr) return { period: 'Q', date: dStr };
    const month = parseInt(dStr.slice(5, 7), 10);
    const period = `Q${Math.ceil(month / 3)}`;
    return { period, date: dStr };
  };

  const income = (m.incomeStatementHistoryQuarterly?.incomeStatementHistory || []).map((s) => ({
    ...buildPeriod(s.endDate),
    revenue: num(s.totalRevenue),
    netIncome: num(s.netIncome),
    eps: null,
  }));
  const balance = (m.balanceSheetHistoryQuarterly?.balanceSheetStatements || []).map((s) => ({
    ...buildPeriod(s.endDate),
    totalAssets: num(s.totalAssets),
    totalDebt: num(s.shortLongTermDebt) != null && num(s.longTermDebt) != null ? num(s.shortLongTermDebt) + num(s.longTermDebt) : (num(s.longTermDebt) ?? num(s.shortLongTermDebt)),
    totalStockholdersEquity: num(s.totalStockholderEquity),
  }));
  const cashflow = (m.cashflowStatementHistoryQuarterly?.cashflowStatements || []).map((s) => {
    const op = num(s.totalCashFromOperatingActivities);
    const capex = num(s.capitalExpenditures);
    return {
      ...buildPeriod(s.endDate),
      operatingCashFlow: op,
      capitalExpenditure: capex,
      freeCashFlow: op != null && capex != null ? op + capex : null,
    };
  });

  return { profile, ratios, income, balance, cashflow };
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const symbol = (searchParams.get('symbol') || 'NVDA').toUpperCase();

  const cacheKey = `fin:${symbol}`;
  const cached = getCached(cacheKey);
  if (cached) return Response.json(cached);

  let result = null;
  let source = 'fmp';
  try { result = await fmpFin(symbol, process.env.FMP_API_KEY); } catch (_) {}
  if (!result) {
    try { result = await yahooFin(symbol); source = 'yahoo'; } catch (_) {}
  }
  if (!result) {
    const empty = { profile: {}, ratios: {}, income: [], balance: [], cashflow: [], source: 'unavailable' };
    setCache(cacheKey, empty, 5 * 60 * 1000);
    return Response.json(empty);
  }
  result.source = source;
  setCache(cacheKey, result, 60 * 60 * 1000);
  return Response.json(result);
}