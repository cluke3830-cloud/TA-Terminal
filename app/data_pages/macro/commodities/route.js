import { getCached, setCache } from '../../_cache';
import YahooFinance from 'yahoo-finance2';

// Yahoo Finance is free and unlimited (no API key required, no daily quota).
// Quotes have a ~15 min lag during market hours; this is the closest you get
// without paid market-data feeds.
//
// Unit divisors: CBOT grain futures (ZC/ZW/ZS) are quoted in exchange-native
// cents/bushel — Yahoo passes those through unmodified, so we divide by 100
// to land in USD/bu. Copper (HG=F) is already in USD/lb on Yahoo (verified
// against live ~$5/lb prices), so it does NOT need the divisor.
// This was the real source of the price mismatch on the dashboard.

const yahoo = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

const COMM = [
  { symbol: 'CLUSD', yahoo: 'CL=F', name: 'WTI Crude',         unit: 'USD/bbl',   cat: 'energy' },
  { symbol: 'BZUSD', yahoo: 'BZ=F', name: 'Brent Crude',       unit: 'USD/bbl',   cat: 'energy' },
  { symbol: 'NGUSD', yahoo: 'NG=F', name: 'Natural Gas',       unit: 'USD/MMBtu', cat: 'energy' },
  { symbol: 'HOUSD', yahoo: 'HO=F', name: 'Heating Oil',       unit: 'USD/gal',   cat: 'energy' },
  { symbol: 'RBUSD', yahoo: 'RB=F', name: 'RBOB Gasoline',     unit: 'USD/gal',   cat: 'energy' },
  { symbol: 'GCUSD', yahoo: 'GC=F', name: 'Gold',              unit: 'USD/oz',    cat: 'metal'  },
  { symbol: 'SIUSD', yahoo: 'SI=F', name: 'Silver',            unit: 'USD/oz',    cat: 'metal'  },
  { symbol: 'HGUSD', yahoo: 'HG=F', name: 'Copper',            unit: 'USD/lb',    cat: 'metal'  },
  { symbol: 'PLUSD', yahoo: 'PL=F', name: 'Platinum',          unit: 'USD/oz',    cat: 'metal'  },
  { symbol: 'PAUSD', yahoo: 'PA=F', name: 'Palladium',         unit: 'USD/oz',    cat: 'metal'  },
  { symbol: 'ZCUSD', yahoo: 'ZC=F', name: 'Corn',              unit: 'USD/bu',    cat: 'agri',   divisor: 100 },
  { symbol: 'ZWUSD', yahoo: 'ZW=F', name: 'Wheat',             unit: 'USD/bu',    cat: 'agri',   divisor: 100 },
  { symbol: 'ZSUSD', yahoo: 'ZS=F', name: 'Soybeans',          unit: 'USD/bu',    cat: 'agri',   divisor: 100 },
  { symbol: 'URA',   yahoo: 'URA',  name: 'Uranium (URA ETF)', unit: 'USD',       cat: 'energy' },
  { symbol: 'LIT',   yahoo: 'LIT',  name: 'Lithium (LIT ETF)', unit: 'USD',       cat: 'metal'  },
];

async function yahooQuoteAndHistory(yahooSymbol, divisor = 1) {
  try {
    const oneYearAgo = new Date();
    oneYearAgo.setUTCFullYear(oneYearAgo.getUTCFullYear() - 1);
    oneYearAgo.setUTCDate(oneYearAgo.getUTCDate() - 30);

    const [q, hist] = await Promise.all([
      yahoo.quote(yahooSymbol).catch(() => null),
      yahoo.chart(yahooSymbol, { period1: oneYearAgo, interval: '1d' }).catch(() => null),
    ]);

    const quote = q ? {
      price: q.regularMarketPrice != null ? q.regularMarketPrice / divisor : null,
      change: q.regularMarketChange != null ? q.regularMarketChange / divisor : null,
      changesPercentage: q.regularMarketChangePercent ?? null,
    } : null;

    const history = hist?.quotes
      ? hist.quotes
          .map((p) => {
            const raw = p.close ?? p.adjclose ?? null;
            return {
              date: p.date instanceof Date ? p.date.toISOString().slice(0, 10) : String(p.date).slice(0, 10),
              price: raw != null ? raw / divisor : null,
            };
          })
          .filter((p) => p.date && p.price != null)
      : null;

    return { quote, history };
  } catch (_) {
    return { quote: null, history: null };
  }
}

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

export async function GET() {
  const cached = getCached('macro:commodities');
  if (cached) return Response.json(cached);

  const EIA_KEY = process.env.EIA_API_KEY;

  try {
    const results = await Promise.all(
      COMM.map((c) => yahooQuoteAndHistory(c.yahoo, c.divisor ?? 1).then((r) => ({ c, ...r })))
    );

    const commodities = results.map(({ c, quote, history }) => {
      const stats = deriveStats(history);
      const price = quote?.price ?? (stats.sparkline.length ? stats.sparkline[stats.sparkline.length - 1] : null);
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
        source: 'yahoo',
      };
    });

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
    setCache('macro:commodities', data, 30 * 1000); // 30s — Yahoo is unlimited so we can keep it live
    return Response.json(data);
  } catch (e) {
    return Response.json({ error: e.message || 'Commodity fetch failed' }, { status: 500 });
  }
}