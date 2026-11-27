export const dynamic = 'force-dynamic';

import { getCached, setCache } from '../../_cache';
import YahooFinance from 'yahoo-finance2';
import { fetchWithTimeout, withTimeout, pooled } from '../../_lib/http';

// Yahoo first (no key, futures delayed about 10 minutes); FMP fills a symbol
// Yahoo misses. Every upstream call has a timeout and at most five run at
// once, so one slow source cannot hold the whole route until it is killed.
// A commodity with no data comes back with empty fields, not a guess.

const yahoo = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

const COMM = [
  { symbol: 'CLUSD', yahoo: 'CL=F', name: 'WTI Crude',     unit: 'USD/bbl',   cat: 'energy' },
  { symbol: 'BZUSD', yahoo: 'BZ=F', name: 'Brent Crude',   unit: 'USD/bbl',   cat: 'energy' },
  { symbol: 'NGUSD', yahoo: 'NG=F', name: 'Natural Gas',   unit: 'USD/MMBtu', cat: 'energy' },
  { symbol: 'HOUSD', yahoo: 'HO=F', name: 'Heating Oil',   unit: 'USD/gal',   cat: 'energy' },
  { symbol: 'RBUSD', yahoo: 'RB=F', name: 'RBOB Gasoline', unit: 'USD/gal',   cat: 'energy' },
  { symbol: 'GCUSD', yahoo: 'GC=F', name: 'Gold',          unit: 'USD/oz',    cat: 'metal'  },
  { symbol: 'SIUSD', yahoo: 'SI=F', name: 'Silver',        unit: 'USD/oz',    cat: 'metal'  },
  { symbol: 'HGUSD', yahoo: 'HG=F', name: 'Copper',        unit: 'USD/lb',    cat: 'metal'  },
  { symbol: 'PLUSD', yahoo: 'PL=F', name: 'Platinum',      unit: 'USD/oz',    cat: 'metal'  },
  { symbol: 'PAUSD', yahoo: 'PA=F', name: 'Palladium',     unit: 'USD/oz',    cat: 'metal'  },
  { symbol: 'ZCUSD', yahoo: 'ZC=F', name: 'Corn',          unit: 'USD/bu',    cat: 'agri'   },
  { symbol: 'ZWUSD', yahoo: 'ZW=F', name: 'Wheat',         unit: 'USD/bu',    cat: 'agri'   },
  { symbol: 'ZSUSD', yahoo: 'ZS=F', name: 'Soybeans',      unit: 'USD/bu',    cat: 'agri'   },
  { symbol: 'URA',   yahoo: 'URA',  name: 'Uranium (URA ETF)', unit: 'USD',   cat: 'energy' },
  { symbol: 'LIT',   yahoo: 'LIT',  name: 'Lithium (LIT ETF)', unit: 'USD',   cat: 'metal'  },
];

async function fmpQuote(symbol, key) {
  if (!key) return null;
  try {
    const r = await fetchWithTimeout(`https://financialmodelingprep.com/stable/quote?symbol=${symbol}&apikey=${key}`, {}, 5000);
    if (!r.ok) return null;
    const j = await r.json();
    if (j && j['Error Message']) return null;
    return Array.isArray(j) && j[0] ? j[0] : null;
  } catch (_) { return null; }
}

async function fmpHistory(symbol, key) {
  if (!key) return null;
  try {
    const r = await fetchWithTimeout(`https://financialmodelingprep.com/stable/historical-price-eod/light?symbol=${symbol}&apikey=${key}`, {}, 5000);
    if (!r.ok) return null;
    const j = await r.json();
    if (!Array.isArray(j) || j.length === 0) return null;
    return j.map((p) => ({ date: p.date, price: p.price ?? p.close })).filter((p) => p.date && p.price != null);
  } catch (_) { return null; }
}

async function yahooQuoteAndHistory(yahooSymbol) {
  try {
    const oneYearAgo = new Date();
    oneYearAgo.setUTCFullYear(oneYearAgo.getUTCFullYear() - 1);
    oneYearAgo.setUTCDate(oneYearAgo.getUTCDate() - 30); // small buffer for YTD anchor

    const [q, hist] = await Promise.all([
      withTimeout(yahoo.quote(yahooSymbol), 6000, 'Yahoo quote').catch(() => null),
      withTimeout(yahoo.chart(yahooSymbol, { period1: oneYearAgo, interval: '1d' }), 7000, 'Yahoo chart').catch(() => null),
    ]);

    const quote = q ? {
      price: q.regularMarketPrice ?? null,
      change: q.regularMarketChange ?? null,
      changesPercentage: q.regularMarketChangePercent ?? null,
    } : null;

    const history = hist?.quotes
      ? hist.quotes
          .map((p) => ({
            date: p.date instanceof Date ? p.date.toISOString().slice(0, 10) : String(p.date).slice(0, 10),
            price: p.close ?? p.adjclose ?? null,
          }))
          .filter((p) => p.date && p.price != null)
      : null;

    return { quote, history };
  } catch (_) {
    return { quote: null, history: null };
  }
}

function deriveStats(history) {
  if (!history || history.length < 2) return { sparkline: [], ytdPct: null, weekHigh52: null, weekLow52: null, pctFromHigh: null };
  const yearStart = `${new Date().getUTCFullYear()}-01-01`;
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
  const last = sorted[sorted.length - 1].price;

  const yoy = sorted.slice(-252);
  const weekHigh52 = Math.max(...yoy.map((p) => p.price));
  const weekLow52 = Math.min(...yoy.map((p) => p.price));
  const pctFromHigh = weekHigh52 > 0 ? +(((last - weekHigh52) / weekHigh52) * 100).toFixed(2) : null;

  const ytdAnchor = sorted.find((p) => p.date >= yearStart) || sorted[0];
  const ytdPct = ytdAnchor && ytdAnchor.price > 0 ? +(((last - ytdAnchor.price) / ytdAnchor.price) * 100).toFixed(2) : null;

  const sparkline = sorted.slice(-30).map((p) => p.price);
  return { sparkline, ytdPct, weekHigh52: +weekHigh52.toFixed(2), weekLow52: +weekLow52.toFixed(2), pctFromHigh };
}

async function eiaElectricity(key) {
  try {
    const url = `https://api.eia.gov/v2/electricity/wholesale/prices/data/?api_key=${key}&frequency=daily&data[0]=price&sort[0][column]=period&sort[0][direction]=desc&offset=0&length=260`;
    const r = await fetchWithTimeout(url, {}, 6000);
    if (!r.ok) return null;
    const j = await r.json();
    const data = j?.response?.data;
    if (!Array.isArray(data) || data.length === 0) return null;
    const sorted = data
      .map((d) => ({ date: d.period, price: parseFloat(d.price) }))
      .filter((d) => !isNaN(d.price))
      .sort((a, b) => a.date.localeCompare(b.date));
    return sorted.length > 0 ? sorted : null;
  } catch (_) { return null; }
}

async function fetchOne(c, KEY) {
  // Yahoo first (unlimited, near-real-time).
  const y = await yahooQuoteAndHistory(c.yahoo);
  let quote = y.quote;
  let history = y.history;
  let source = (quote && quote.price != null) || (history && history.length > 1) ? 'yahoo' : null;

  // FMP fallback when Yahoo is missing data.
  if (!quote || quote.price == null || !history || history.length < 2) {
    const [fmpQ, fmpH] = await Promise.all([fmpQuote(c.symbol, KEY), fmpHistory(c.symbol, KEY)]);
    if ((!quote || quote.price == null) && fmpQ) {
      quote = { price: fmpQ.price, change: fmpQ.change, changesPercentage: fmpQ.changesPercentage };
    }
    if ((!history || history.length < 2) && fmpH) history = fmpH;
    if (!source && ((quote && quote.price != null) || (history && history.length > 1))) source = 'fmp';
  }

  return { c, quote, history, source: source || 'unknown' };
}

export async function GET() {
  const cached = getCached('macro:commodities');
  if (cached) return Response.json(cached);

  const KEY = process.env.FMP_API_KEY;
  const EIA = process.env.EIA_API_KEY;

  try {
    const results = (await pooled(COMM.map((c) => () => fetchOne(c, KEY)), 5))
      .map((r, i) => r || { c: COMM[i], quote: null, history: null, source: 'unavailable' });

    const commodities = results.map(({ c, quote, history, source }) => {
      const stats = deriveStats(history);
      const sp = stats.sparkline;
      const price = quote?.price ?? (sp.length ? sp[sp.length - 1] : null);
      // No live quote: the day's change is the last close against the one before.
      const histChange = quote?.change == null && sp.length > 1 ? sp[sp.length - 1] - sp[sp.length - 2] : null;
      const histChangePct = histChange != null && sp[sp.length - 2] > 0 ? (histChange / sp[sp.length - 2]) * 100 : null;
      return {
        symbol: c.symbol,
        name: c.name,
        unit: c.unit,
        category: c.cat,
        price,
        change: quote?.change ?? histChange,
        changePct: quote?.changesPercentage != null ? +Number(quote.changesPercentage).toFixed(2)
          : (histChangePct != null ? +histChangePct.toFixed(2) : null),
        sparkline: stats.sparkline.length > 1 ? stats.sparkline : [],
        ytdPct: stats.ytdPct,
        weekHigh52: stats.weekHigh52,
        weekLow52: stats.weekLow52,
        pctFromHigh: stats.pctFromHigh,
        source,
      };
    });

    const elec = EIA ? await eiaElectricity(EIA) : null; // has its own 6 s timeout
    if (elec && elec.length > 0) {
      const stats = deriveStats(elec);
      commodities.push({
        symbol: 'ELEC',
        name: 'US Electricity',
        unit: 'USD/MWh',
        category: 'power',
        price: elec[elec.length - 1].price,
        change: elec.length > 1 ? +(elec[elec.length - 1].price - elec[elec.length - 2].price).toFixed(2) : null,
        changePct: null,
        sparkline: stats.sparkline,
        ytdPct: stats.ytdPct,
        weekHigh52: stats.weekHigh52,
        weekLow52: stats.weekLow52,
        pctFromHigh: stats.pctFromHigh,
        source: 'eia',
      });
    }

    const data = { commodities, lastUpdated: new Date().toISOString() };
    setCache('macro:commodities', data, 30 * 1000); // 30s — live-feel updates
    return Response.json(data);
  } catch (e) {
    return Response.json({ error: e.message || 'Commodity fetch failed' }, { status: 500 });
  }
}