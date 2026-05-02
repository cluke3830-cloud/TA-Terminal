import { getCached, setCache } from '../../_cache';
import YahooFinance from 'yahoo-finance2';

// Data strategy:
//   Current prices  → FMP batch (one API call, real-time, correct USD units for all symbols)
//   Historical data → Yahoo chart (unlimited, accurate for sparklines/stats)
//   ETFs (URA/LIT)  → Alpaca snapshot + bars (real-time US equity feed, zero delay)
//   Fallback chain  → Yahoo quote → FMP per-symbol if batch missed it
//
// Why FMP as primary for futures: Yahoo Finance returns grain futures (ZC/ZW/ZS)
// and copper (HG) in exchange-native cents, not USD. FMP normalises everything
// to USD, eliminating the cents-vs-dollars mismatch.
//
// Cache: 5 min keeps FMP daily usage well under the 250 req/day free-tier cap
// (one batch call per TTL = max 288/day, ~144 typical).

const yahoo = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

// divisor: Yahoo chart returns some futures in exchange-native cents.
// Applied to history only so sparklines stay on the same scale as FMP prices.
// - HG (Copper):            CME quotes in cents/lb  → ÷100 → USD/lb
// - ZC/ZW/ZS (Grains):     CBOT quotes in cents/bu → ÷100 → USD/bu
const COMM = [
  { symbol: 'CLUSD', yahoo: 'CL=F', name: 'WTI Crude',         unit: 'USD/bbl',   cat: 'energy' },
  { symbol: 'BZUSD', yahoo: 'BZ=F', name: 'Brent Crude',       unit: 'USD/bbl',   cat: 'energy' },
  { symbol: 'NGUSD', yahoo: 'NG=F', name: 'Natural Gas',       unit: 'USD/MMBtu', cat: 'energy' },
  { symbol: 'HOUSD', yahoo: 'HO=F', name: 'Heating Oil',       unit: 'USD/gal',   cat: 'energy' },
  { symbol: 'RBUSD', yahoo: 'RB=F', name: 'RBOB Gasoline',     unit: 'USD/gal',   cat: 'energy' },
  { symbol: 'GCUSD', yahoo: 'GC=F', name: 'Gold',              unit: 'USD/oz',    cat: 'metal'  },
  { symbol: 'SIUSD', yahoo: 'SI=F', name: 'Silver',            unit: 'USD/oz',    cat: 'metal'  },
  { symbol: 'HGUSD', yahoo: 'HG=F', name: 'Copper',            unit: 'USD/lb',    cat: 'metal',  divisor: 100 },
  { symbol: 'PLUSD', yahoo: 'PL=F', name: 'Platinum',          unit: 'USD/oz',    cat: 'metal'  },
  { symbol: 'PAUSD', yahoo: 'PA=F', name: 'Palladium',         unit: 'USD/oz',    cat: 'metal'  },
  { symbol: 'ZCUSD', yahoo: 'ZC=F', name: 'Corn',              unit: 'USD/bu',    cat: 'agri',   divisor: 100 },
  { symbol: 'ZWUSD', yahoo: 'ZW=F', name: 'Wheat',             unit: 'USD/bu',    cat: 'agri',   divisor: 100 },
  { symbol: 'ZSUSD', yahoo: 'ZS=F', name: 'Soybeans',          unit: 'USD/bu',    cat: 'agri',   divisor: 100 },
  { symbol: 'URA',   yahoo: 'URA',  alpaca: 'URA', name: 'Uranium (URA ETF)',  unit: 'USD', cat: 'energy' },
  { symbol: 'LIT',   yahoo: 'LIT',  alpaca: 'LIT', name: 'Lithium (LIT ETF)', unit: 'USD', cat: 'metal'  },
];

// ─── FMP ────────────────────────────────────────────────────────────────────

async function fmpBatchQuotes(symbols, key) {
  if (!key) return {};
  try {
    const r = await fetch(
      `https://financialmodelingprep.com/stable/quote?symbol=${symbols.join(',')}&apikey=${key}`,
      { cache: 'no-store' }
    );
    if (!r.ok) return {};
    const j = await r.json();
    if (!Array.isArray(j)) return {};
    const map = {};
    for (const q of j) {
      if (q.symbol && q.price != null) {
        map[q.symbol] = {
          price: q.price,
          change: q.change ?? null,
          changesPercentage: q.changesPercentage ?? null,
        };
      }
    }
    return map;
  } catch (_) { return {}; }
}

async function fmpHistory(symbol, key) {
  if (!key) return null;
  try {
    const r = await fetch(
      `https://financialmodelingprep.com/stable/historical-price-eod/light?symbol=${symbol}&apikey=${key}`,
      { cache: 'no-store' }
    );
    if (!r.ok) return null;
    const j = await r.json();
    if (!Array.isArray(j) || j.length === 0) return null;
    return j
      .map((p) => ({ date: p.date, price: p.price ?? p.close }))
      .filter((p) => p.date && p.price != null);
  } catch (_) { return null; }
}

// ─── Yahoo (history + quote fallback) ───────────────────────────────────────

async function yahooHistory(yahooSymbol, divisor = 1) {
  try {
    const oneYearAgo = new Date();
    oneYearAgo.setUTCFullYear(oneYearAgo.getUTCFullYear() - 1);
    oneYearAgo.setUTCDate(oneYearAgo.getUTCDate() - 30);
    const hist = await yahoo.chart(yahooSymbol, { period1: oneYearAgo, interval: '1d' }).catch(() => null);
    if (!hist?.quotes?.length) return null;
    return hist.quotes
      .map((p) => {
        const raw = p.close ?? p.adjclose ?? null;
        return {
          date: p.date instanceof Date ? p.date.toISOString().slice(0, 10) : String(p.date).slice(0, 10),
          price: raw != null ? raw / divisor : null,
        };
      })
      .filter((p) => p.date && p.price != null);
  } catch (_) { return null; }
}

async function yahooQuote(yahooSymbol, divisor = 1) {
  try {
    const q = await yahoo.quote(yahooSymbol).catch(() => null);
    if (!q) return null;
    const raw = q.regularMarketPrice;
    const rawChange = q.regularMarketChange;
    return {
      price: raw != null ? raw / divisor : null,
      change: rawChange != null ? rawChange / divisor : null,
      changesPercentage: q.regularMarketChangePercent ?? null,
    };
  } catch (_) { return null; }
}

// ─── Alpaca (real-time ETF snapshot + daily bars) ───────────────────────────

async function alpacaQuoteAndHistory(symbol, key, secret) {
  if (!key || !secret) return { quote: null, history: null };
  try {
    const headers = {
      'APCA-API-KEY-ID': key,
      'APCA-API-SECRET-KEY': secret,
    };
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const startDate = oneYearAgo.toISOString().slice(0, 10);

    const [snapRes, barsRes] = await Promise.all([
      fetch(`https://data.alpaca.markets/v2/stocks/${symbol}/snapshot?feed=iex`, { headers, cache: 'no-store' }),
      fetch(`https://data.alpaca.markets/v2/stocks/${symbol}/bars?timeframe=1Day&start=${startDate}&limit=365&feed=iex&adjustment=all`, { headers, cache: 'no-store' }),
    ]);

    let quote = null;
    if (snapRes.ok) {
      const snap = await snapRes.json();
      const price = snap.latestTrade?.p ?? snap.dailyBar?.c ?? snap.latestQuote?.ap ?? null;
      const prevClose = snap.prevDailyBar?.c ?? null;
      if (price != null) {
        const change = prevClose != null ? +(price - prevClose).toFixed(4) : null;
        const changesPercentage = prevClose != null && prevClose > 0
          ? +((price - prevClose) / prevClose * 100).toFixed(4)
          : null;
        quote = { price, change, changesPercentage };
      }
    }

    let history = null;
    if (barsRes.ok) {
      const j = await barsRes.json();
      if (j.bars?.length) {
        history = j.bars
          .map((b) => ({ date: b.t.slice(0, 10), price: b.c }))
          .filter((p) => p.date && p.price != null);
      }
    }

    return { quote, history };
  } catch (_) { return { quote: null, history: null }; }
}

// ─── Stats ──────────────────────────────────────────────────────────────────

function deriveStats(history) {
  if (!history || history.length < 2) {
    return { sparkline: [], ytdPct: null, weekHigh52: null, weekLow52: null, pctFromHigh: null };
  }
  const yearStart = `${new Date().getUTCFullYear()}-01-01`;
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
  const last = sorted[sorted.length - 1].price;

  const yoy = sorted.slice(-252);
  const weekHigh52 = Math.max(...yoy.map((p) => p.price));
  const weekLow52 = Math.min(...yoy.map((p) => p.price));
  const pctFromHigh = weekHigh52 > 0 ? +(((last - weekHigh52) / weekHigh52) * 100).toFixed(2) : null;

  const ytdAnchor = sorted.find((p) => p.date >= yearStart) || sorted[0];
  const ytdPct = ytdAnchor && ytdAnchor.price > 0
    ? +(((last - ytdAnchor.price) / ytdAnchor.price) * 100).toFixed(2)
    : null;

  const sparkline = sorted.slice(-30).map((p) => p.price);
  return {
    sparkline,
    ytdPct,
    weekHigh52: +weekHigh52.toFixed(2),
    weekLow52: +weekLow52.toFixed(2),
    pctFromHigh,
  };
}

// ─── EIA electricity ────────────────────────────────────────────────────────

async function eiaElectricity(key) {
  try {
    const url = `https://api.eia.gov/v2/electricity/wholesale/prices/data/?api_key=${key}&frequency=daily&data[0]=price&sort[0][column]=period&sort[0][direction]=desc&offset=0&length=260`;
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json();
    const data = j?.response?.data;
    if (!Array.isArray(data) || data.length === 0) return null;
    return data
      .map((d) => ({ date: d.period, price: parseFloat(d.price) }))
      .filter((d) => !isNaN(d.price))
      .sort((a, b) => a.date.localeCompare(b.date));
  } catch (_) { return null; }
}

// ─── Route ──────────────────────────────────────────────────────────────────

export async function GET() {
  const cached = getCached('macro:commodities');
  if (cached) return Response.json(cached);

  const FMP_KEY = process.env.FMP_API_KEY;
  const EIA_KEY = process.env.EIA_API_KEY;
  const ALPACA_KEY = process.env.ALPACA_API_KEY;
  const ALPACA_SECRET = process.env.ALPACA_SECRET_KEY;

  try {
    // Separate futures from ETFs
    const futures = COMM.filter((c) => !c.alpaca);
    const etfs = COMM.filter((c) => c.alpaca);

    // 1. FMP batch for all futures current prices (single API call)
    const fmpSymbols = futures.map((c) => c.symbol);
    const [fmpQuotes, yahooHistories] = await Promise.all([
      fmpBatchQuotes(fmpSymbols, FMP_KEY),
      Promise.all(futures.map((c) =>
        yahooHistory(c.yahoo, c.divisor ?? 1).then((h) => ({ symbol: c.symbol, h }))
      )),
    ]);

    const histMap = Object.fromEntries(yahooHistories.map(({ symbol, h }) => [symbol, h]));

    // For any futures FMP missed, fall back to Yahoo quote
    const misses = futures.filter((c) => !fmpQuotes[c.symbol]);
    if (misses.length > 0) {
      await Promise.all(misses.map(async (c) => {
        const q = await yahooQuote(c.yahoo, c.divisor ?? 1);
        if (q?.price != null) fmpQuotes[c.symbol] = { ...q, _src: 'yahoo' };
      }));
    }

    // 2. Build futures entries
    const commodities = futures.map((c) => {
      const quote = fmpQuotes[c.symbol];
      const history = histMap[c.symbol];
      const stats = deriveStats(history);
      const price = quote?.price ?? (stats.sparkline.length ? stats.sparkline[stats.sparkline.length - 1] : null);
      const source = quote?._src ?? (quote ? 'fmp' : (stats.sparkline.length ? 'yahoo-hist' : 'unknown'));
      return {
        symbol: c.symbol,
        name: c.name,
        unit: c.unit,
        category: c.cat,
        price,
        change: quote?.change ?? null,
        changePct: quote?.changesPercentage != null ? +Number(quote.changesPercentage).toFixed(2) : null,
        sparkline: stats.sparkline.length > 1 ? stats.sparkline : (price != null ? [price, price] : []),
        ytdPct: stats.ytdPct,
        weekHigh52: stats.weekHigh52,
        weekLow52: stats.weekLow52,
        pctFromHigh: stats.pctFromHigh,
        source,
      };
    });

    // 3. ETFs via Alpaca with Yahoo fallback
    const etfResults = await Promise.all(etfs.map(async (e) => {
      const alp = await alpacaQuoteAndHistory(e.alpaca, ALPACA_KEY, ALPACA_SECRET);
      let quote = alp.quote;
      let history = alp.history;
      let source = (quote?.price != null || history?.length > 1) ? 'alpaca' : null;

      if (!quote?.price || !history?.length) {
        const [yq, yh] = await Promise.all([yahooQuote(e.yahoo), yahooHistory(e.yahoo)]);
        if (!quote?.price && yq?.price != null) { quote = yq; source = source ?? 'yahoo'; }
        if (!history?.length && yh?.length > 1) { history = yh; source = source ?? 'yahoo'; }
      }

      const stats = deriveStats(history);
      const price = quote?.price ?? (stats.sparkline.length ? stats.sparkline[stats.sparkline.length - 1] : null);
      return {
        symbol: e.symbol,
        name: e.name,
        unit: e.unit,
        category: e.cat,
        price,
        change: quote?.change ?? null,
        changePct: quote?.changesPercentage != null ? +Number(quote.changesPercentage).toFixed(2) : null,
        sparkline: stats.sparkline.length > 1 ? stats.sparkline : (price != null ? [price, price] : []),
        ytdPct: stats.ytdPct,
        weekHigh52: stats.weekHigh52,
        weekLow52: stats.weekLow52,
        pctFromHigh: stats.pctFromHigh,
        source: source ?? 'unknown',
      };
    }));

    commodities.push(...etfResults);

    // 4. EIA electricity
    const elec = EIA_KEY ? await eiaElectricity(EIA_KEY) : null;
    if (elec?.length > 0) {
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
    // 5 min cache: FMP batch = 1 req per TTL, safe under 250 req/day free tier
    setCache('macro:commodities', data, 5 * 60 * 1000);
    return Response.json(data);
  } catch (e) {
    return Response.json({ error: e.message || 'Commodity fetch failed' }, { status: 500 });
  }
}