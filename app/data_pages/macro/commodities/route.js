import { getCached, setCache } from '../../_cache';

const COMM = [
  { symbol: 'CLUSD',     name: 'WTI Crude',     unit: 'USD/bbl',   cat: 'energy' },
  { symbol: 'BZUSD',     name: 'Brent Crude',   unit: 'USD/bbl',   cat: 'energy' },
  { symbol: 'NGUSD',     name: 'Natural Gas',   unit: 'USD/MMBtu', cat: 'energy' },
  { symbol: 'HOUSD',     name: 'Heating Oil',   unit: 'USD/gal',   cat: 'energy' },
  { symbol: 'RBUSD',     name: 'RBOB Gasoline', unit: 'USD/gal',   cat: 'energy' },
  { symbol: 'GCUSD',     name: 'Gold',          unit: 'USD/oz',    cat: 'metal'  },
  { symbol: 'SIUSD',     name: 'Silver',        unit: 'USD/oz',    cat: 'metal'  },
  { symbol: 'HGUSD',     name: 'Copper',        unit: 'USD/lb',    cat: 'metal'  },
  { symbol: 'PLUSD',     name: 'Platinum',      unit: 'USD/oz',    cat: 'metal'  },
  { symbol: 'PAUSD',     name: 'Palladium',     unit: 'USD/oz',    cat: 'metal'  },
  { symbol: 'ZCUSD',     name: 'Corn',          unit: 'USD/bu',    cat: 'agri'   },
  { symbol: 'ZWUSD',     name: 'Wheat',         unit: 'USD/bu',    cat: 'agri'   },
  { symbol: 'ZSUSD',     name: 'Soybeans',      unit: 'USD/bu',    cat: 'agri'   },
];

const URANIUM_PROXY = { symbol: 'URA', name: 'Uranium (URA ETF)', unit: 'USD', cat: 'energy' };
const LITHIUM_PROXY = { symbol: 'LIT', name: 'Lithium (LIT ETF)', unit: 'USD', cat: 'metal' };

async function fmpQuote(symbol, key) {
  try {
    const r = await fetch(`https://financialmodelingprep.com/stable/quote?symbol=${symbol}&apikey=${key}`, { cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json();
    return Array.isArray(j) && j[0] ? j[0] : null;
  } catch (_) { return null; }
}

async function fmpHistory(symbol, key) {
  try {
    const r = await fetch(`https://financialmodelingprep.com/stable/historical-price-eod/light?symbol=${symbol}&apikey=${key}`, { cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json();
    if (!Array.isArray(j)) return null;
    return j.map((p) => ({ date: p.date, price: p.price ?? p.close })).filter((p) => p.price != null);
  } catch (_) { return null; }
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
    const sorted = data
      .map((d) => ({ date: d.period, price: parseFloat(d.price) }))
      .filter((d) => !isNaN(d.price))
      .sort((a, b) => a.date.localeCompare(b.date));
    if (sorted.length === 0) return null;
    return sorted;
  } catch (_) { return null; }
}

export async function GET() {
  const cached = getCached('macro:commodities');
  if (cached) return Response.json(cached);

  const KEY = process.env.FMP_API_KEY;
  const EIA = process.env.EIA_API_KEY;
  if (!KEY) return Response.json({ error: 'FMP_API_KEY not configured' }, { status: 500 });

  try {
    const all = [...COMM, URANIUM_PROXY, LITHIUM_PROXY];
    const quotes = await Promise.all(all.map((c) => fmpQuote(c.symbol, KEY)));
    const histories = await Promise.all(all.map((c) => fmpHistory(c.symbol, KEY)));

    const commodities = all.map((c, i) => {
      const q = quotes[i];
      const stats = deriveStats(histories[i]);
      const price = q?.price ?? (stats.sparkline.length ? stats.sparkline[stats.sparkline.length - 1] : null);
      return {
        symbol: c.symbol,
        name: c.name,
        unit: c.unit,
        category: c.cat,
        price,
        change: q?.change ?? null,
        changePct: q?.changesPercentage != null ? +q.changesPercentage.toFixed(2) : null,
        sparkline: stats.sparkline.length > 1 ? stats.sparkline : (price != null ? [price, price] : []),
        ytdPct: stats.ytdPct,
        weekHigh52: stats.weekHigh52,
        weekLow52: stats.weekLow52,
        pctFromHigh: stats.pctFromHigh,
      };
    });

    const elec = EIA ? await eiaElectricity(EIA) : null;
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
      });
    }

    const data = { commodities, lastUpdated: new Date().toISOString() };
    setCache('macro:commodities', data, 60 * 60 * 1000); // 60 min — 14 commodities × 2 calls each
    return Response.json(data);
  } catch (e) {
    return Response.json({ error: e.message || 'Commodity fetch failed' }, { status: 500 });
  }
}