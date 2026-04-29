import { getCached, setCache } from '../../_cache';
import YahooFinance from 'yahoo-finance2';

const yahoo = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

const TF_DAYS = { '1m': 22, '3m': 66, '6m': 132, '1y': 252, '5y': 1260 };

// FMP symbol → Yahoo symbol map for the same commodities used in /macro/commodities.
const YAHOO_MAP = {
  CLUSD: 'CL=F', BZUSD: 'BZ=F', NGUSD: 'NG=F', HOUSD: 'HO=F', RBUSD: 'RB=F',
  GCUSD: 'GC=F', SIUSD: 'SI=F', HGUSD: 'HG=F', PLUSD: 'PL=F', PAUSD: 'PA=F',
  ZCUSD: 'ZC=F', ZWUSD: 'ZW=F', ZSUSD: 'ZS=F',
  URA: 'URA', LIT: 'LIT',
};

async function fmpFetch(symbol, key) {
  if (!key) return null;
  try {
    const r = await fetch(`https://financialmodelingprep.com/stable/historical-price-eod/light?symbol=${symbol}&apikey=${key}`, { cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json();
    if (!Array.isArray(j) || j.length === 0) return null;
    return j
      .map((p) => ({ date: p.date, price: p.price ?? p.close }))
      .filter((p) => p.date && p.price != null)
      .sort((a, b) => a.date.localeCompare(b.date));
  } catch (_) { return null; }
}

async function yahooFetch(yahooSymbol, daysBack) {
  try {
    const start = new Date();
    start.setUTCDate(start.getUTCDate() - Math.ceil(daysBack * 1.6 + 30));
    const hist = await yahoo.chart(yahooSymbol, { period1: start, interval: '1d' });
    if (!hist?.quotes?.length) return null;
    return hist.quotes
      .map((p) => ({
        date: p.date instanceof Date ? p.date.toISOString().slice(0, 10) : String(p.date).slice(0, 10),
        price: p.close ?? p.adjclose ?? null,
      }))
      .filter((p) => p.date && p.price != null);
  } catch (_) { return null; }
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const symbol = (searchParams.get('symbol') || '').toUpperCase();
  const tf = (searchParams.get('tf') || '1y').toLowerCase();
  if (!symbol) return Response.json({ error: 'symbol required' }, { status: 400 });
  if (!TF_DAYS[tf]) return Response.json({ error: `tf must be one of ${Object.keys(TF_DAYS).join(',')}` }, { status: 400 });

  const cacheKey = `commhist:${symbol}:${tf}`;
  const cached = getCached(cacheKey);
  if (cached) return Response.json(cached);

  const KEY = process.env.FMP_API_KEY;
  const wantDays = TF_DAYS[tf];

  // Try FMP first, fall back to Yahoo.
  let series = await fmpFetch(symbol, KEY);
  let source = 'fmp';
  if (!series || series.length < 2) {
    const yahooSymbol = YAHOO_MAP[symbol] || symbol;
    series = await yahooFetch(yahooSymbol, wantDays);
    source = 'yahoo';
  }

  if (!series || series.length === 0) {
    return Response.json({ error: 'no historical data found' }, { status: 404 });
  }

  const slice = series.slice(-wantDays);
  const data = {
    symbol,
    tf,
    prices: slice.map((p) => p.price),
    dates: slice.map((p) => p.date),
    source,
    lastUpdated: new Date().toISOString(),
  };
  setCache(cacheKey, data, 6 * 60 * 60 * 1000); // 6h
  return Response.json(data);
}