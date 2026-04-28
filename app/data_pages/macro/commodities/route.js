import { getCached, setCache } from '../../_cache';

const COMM = [
  { symbol: 'CLUSD',     name: 'WTI Crude',   unit: 'USD/bbl', cat: 'energy', fmpAlt: 'CL=F' },
  { symbol: 'BZUSD',     name: 'Brent Crude', unit: 'USD/bbl', cat: 'energy', fmpAlt: 'BZ=F' },
  { symbol: 'NGUSD',     name: 'Natural Gas', unit: 'USD/MMBtu', cat: 'energy', fmpAlt: 'NG=F' },
  { symbol: 'HGUSD',     name: 'Copper',      unit: 'USD/lb',  cat: 'metal',  fmpAlt: 'HG=F' },
  { symbol: 'GCUSD',     name: 'Gold',        unit: 'USD/oz',  cat: 'metal',  fmpAlt: 'GC=F' },
  { symbol: 'SIUSD',     name: 'Silver',      unit: 'USD/oz',  cat: 'metal',  fmpAlt: 'SI=F' },
];

const URANIUM_PROXY = { symbol: 'URA', name: 'Uranium (URA ETF)', unit: 'USD', cat: 'energy' };

async function fmpQuote(symbol, key) {
  try {
    const r = await fetch(`https://financialmodelingprep.com/stable/quote?symbol=${symbol}&apikey=${key}`, { cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json();
    return Array.isArray(j) && j[0] ? j[0] : null;
  } catch (_) { return null; }
}

async function fmpHistory(symbol, key, days = 30) {
  try {
    const r = await fetch(`https://financialmodelingprep.com/stable/historical-price-eod/light?symbol=${symbol}&apikey=${key}`, { cache: 'no-store' });
    if (!r.ok) return [];
    const j = await r.json();
    if (!Array.isArray(j)) return [];
    return j.slice(0, days).reverse().map((p) => p.price ?? p.close);
  } catch (_) { return []; }
}

async function eiaElectricity(key) {
  try {
    const url = `https://api.eia.gov/v2/electricity/wholesale/prices/data/?api_key=${key}&frequency=daily&data[0]=price&sort[0][column]=period&sort[0][direction]=desc&offset=0&length=30`;
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json();
    const data = j?.response?.data;
    if (!Array.isArray(data) || data.length === 0) return null;
    const prices = data.map((d) => parseFloat(d.price)).filter((p) => !isNaN(p));
    if (prices.length === 0) return null;
    return { latest: prices[0], history: prices.slice(0, 30).reverse() };
  } catch (_) { return null; }
}

export async function GET() {
  const cached = getCached('macro:commodities');
  if (cached) return Response.json(cached);

  const KEY = process.env.FMP_API_KEY;
  const EIA = process.env.EIA_API_KEY;
  if (!KEY) return Response.json({ error: 'FMP_API_KEY not configured' }, { status: 500 });

  try {
    const quotes = await Promise.all(COMM.map((c) => fmpQuote(c.symbol, KEY)));
    const histories = await Promise.all(COMM.map((c) => fmpHistory(c.symbol, KEY, 30)));
    const uraQuote = await fmpQuote(URANIUM_PROXY.symbol, KEY);
    const uraHist = await fmpHistory(URANIUM_PROXY.symbol, KEY, 30);
    const elec = EIA ? await eiaElectricity(EIA) : null;

    const commodities = COMM.map((c, i) => {
      const q = quotes[i];
      const h = histories[i];
      const price = q?.price ?? null;
      const change = q?.change ?? null;
      const changePct = q?.changesPercentage ?? null;
      return {
        symbol: c.symbol,
        name: c.name,
        unit: c.unit,
        category: c.cat,
        price,
        change,
        changePct: changePct != null ? +changePct.toFixed(2) : null,
        sparkline: h && h.length > 1 ? h : (price != null ? [price, price] : []),
      };
    });

    if (uraQuote && uraQuote.price != null) {
      commodities.push({
        symbol: URANIUM_PROXY.symbol,
        name: URANIUM_PROXY.name,
        unit: URANIUM_PROXY.unit,
        category: 'energy',
        price: uraQuote.price,
        change: uraQuote.change,
        changePct: uraQuote.changesPercentage != null ? +uraQuote.changesPercentage.toFixed(2) : null,
        sparkline: uraHist && uraHist.length > 1 ? uraHist : [uraQuote.price, uraQuote.price],
      });
    }

    if (elec) {
      commodities.push({
        symbol: 'ELEC',
        name: 'US Electricity',
        unit: 'USD/MWh',
        category: 'power',
        price: elec.latest,
        change: elec.history.length > 1 ? +(elec.latest - elec.history[elec.history.length - 2]).toFixed(2) : null,
        changePct: null,
        sparkline: elec.history,
      });
    }

    const data = { commodities, lastUpdated: new Date().toISOString() };
    setCache('macro:commodities', data);
    return Response.json(data);
  } catch (e) {
    return Response.json({ error: e.message || 'Commodity fetch failed' }, { status: 500 });
  }
}