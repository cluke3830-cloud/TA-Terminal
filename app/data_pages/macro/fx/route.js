import { getCached, setCache } from '../../_cache';

const CURR = ['USD', 'EUR', 'JPY', 'GBP', 'CNY', 'AUD', 'CAD', 'CHF', 'NZD', 'MXN', 'KRW'];

async function fmpFx(symbol, key) {
  try {
    const r = await fetch(`https://financialmodelingprep.com/stable/quote?symbol=${symbol}&apikey=${key}`, { cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json();
    return Array.isArray(j) && j[0] ? j[0] : null;
  } catch (_) { return null; }
}

async function fmpFxHistory(symbol, key) {
  try {
    const r = await fetch(`https://financialmodelingprep.com/stable/historical-price-eod/light?symbol=${symbol}&apikey=${key}`, { cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json();
    if (!Array.isArray(j)) return null;
    return j
      .map((p) => ({ date: p.date, price: p.price ?? p.close }))
      .filter((p) => p.date && p.price != null)
      .sort((a, b) => a.date.localeCompare(b.date));
  } catch (_) { return null; }
}

async function getRate(base, quote, key, cache) {
  if (base === quote) return 1;
  const k = `${base}${quote}`;
  if (cache[k] != null) return cache[k];
  const direct = await fmpFx(`${base}${quote}`, key);
  if (direct?.price) {
    cache[k] = direct.price;
    cache[`${quote}${base}`] = 1 / direct.price;
    return direct.price;
  }
  const inv = await fmpFx(`${quote}${base}`, key);
  if (inv?.price) {
    cache[k] = 1 / inv.price;
    cache[`${quote}${base}`] = inv.price;
    return cache[k];
  }
  return null;
}

// For non-USD currency C, return USD/C % change over `days` calendar days back.
// Positive number = USD strengthened vs C over the window (i.e. C weakened).
async function pctChange(currency, days, key) {
  if (currency === 'USD') return 0;
  // Try USD{C}; if missing, fall back to {C}USD inverted.
  let hist = await fmpFxHistory(`USD${currency}`, key);
  let inverted = false;
  if (!hist || hist.length < 2) {
    hist = await fmpFxHistory(`${currency}USD`, key);
    inverted = true;
  }
  if (!hist || hist.length < 2) return null;

  const last = hist[hist.length - 1].price;
  // Find a price at least `days` calendar days before the latest sample.
  const lastDate = new Date(hist[hist.length - 1].date);
  const targetDate = new Date(lastDate.getTime() - days * 864e5);
  let prior = null;
  for (let i = hist.length - 1; i >= 0; i--) {
    if (new Date(hist[i].date) <= targetDate) { prior = hist[i].price; break; }
  }
  if (prior == null) prior = hist[0].price;
  if (!prior) return null;

  const raw = ((last - prior) / prior) * 100;
  return inverted ? -raw : raw; // {C}USD up means C strengthened, USD weakened.
}

function buildMatrix(currencies, pairChanges) {
  const matrix = {};
  for (const a of currencies) {
    matrix[a] = {};
    for (const b of currencies) {
      if (a === b) { matrix[a][b] = 0; continue; }
      const aChg = a === 'USD' ? 0 : -(pairChanges[a] ?? 0); // a vs USD
      const bChg = b === 'USD' ? 0 : -(pairChanges[b] ?? 0);
      const v = pairChanges[a] == null || pairChanges[b] == null ? null : aChg - bChg;
      matrix[a][b] = v != null ? +v.toFixed(2) : null;
    }
  }
  return matrix;
}

export async function GET() {
  const cached = getCached('macro:fx');
  if (cached) return Response.json(cached);

  const KEY = process.env.FMP_API_KEY;
  if (!KEY) return Response.json({ error: 'FMP_API_KEY not configured' }, { status: 500 });

  try {
    const rateCache = {};
    const usdRates = { USD: 1 };
    await Promise.all(CURR.filter((c) => c !== 'USD').map(async (c) => {
      usdRates[c] = await getRate('USD', c, KEY, rateCache);
    }));
    if (!usdRates.SEK) usdRates.SEK = await getRate('USD', 'SEK', KEY, rateCache);

    const valuesMatrix = {};
    for (const a of CURR) {
      valuesMatrix[a] = {};
      for (const b of CURR) {
        if (a === b) { valuesMatrix[a][b] = 1; continue; }
        const ra = usdRates[a]; const rb = usdRates[b];
        valuesMatrix[a][b] = (ra && rb) ? +(rb / ra).toFixed(5) : null;
      }
    }

    // 24h pairChanges from quote.changesPercentage
    const pairChanges24h = {};
    await Promise.all(CURR.filter((c) => c !== 'USD').map(async (c) => {
      const q = await fmpFx(`USD${c}`, KEY);
      if (q && q.changesPercentage != null) {
        pairChanges24h[c] = +q.changesPercentage.toFixed(3);
      } else {
        const inv = await fmpFx(`${c}USD`, KEY);
        if (inv && inv.changesPercentage != null) pairChanges24h[c] = -inv.changesPercentage;
        else pairChanges24h[c] = null;
      }
    }));

    // 1W and 1M from historical
    const pairChanges1w = {};
    const pairChanges1m = {};
    await Promise.all(CURR.filter((c) => c !== 'USD').map(async (c) => {
      pairChanges1w[c] = await pctChange(c, 7, KEY);
      pairChanges1m[c] = await pctChange(c, 30, KEY);
    }));

    const matrices = {
      '24h': buildMatrix(CURR, pairChanges24h),
      '1w':  buildMatrix(CURR, pairChanges1w),
      '1m':  buildMatrix(CURR, pairChanges1m),
    };

    let dxy = null;
    if (usdRates.EUR && usdRates.JPY && usdRates.GBP && usdRates.CAD && usdRates.SEK && usdRates.CHF) {
      const eurUsd = 1 / usdRates.EUR;
      const gbpUsd = 1 / usdRates.GBP;
      dxy = 50.14348112
        * Math.pow(eurUsd, -0.576)
        * Math.pow(usdRates.JPY, 0.136)
        * Math.pow(gbpUsd, -0.119)
        * Math.pow(usdRates.CAD, 0.091)
        * Math.pow(usdRates.SEK, 0.042)
        * Math.pow(usdRates.CHF, 0.036);
      dxy = +dxy.toFixed(2);
    }

    const dxyChange24h = matrices['24h'].USD?.EUR != null ? -matrices['24h'].USD.EUR : 0;

    const data = {
      currencies: CURR,
      matrices,
      values: valuesMatrix,
      usdRates,
      pairChanges: pairChanges24h,
      dxy,
      dxyChange24h: +dxyChange24h.toFixed(2),
      lastUpdated: new Date().toISOString(),
    };
    setCache('macro:fx', data, 30 * 60 * 1000); // 30 min — heavy: 11 currencies × 3 timeframes
    return Response.json(data);
  } catch (e) {
    return Response.json({ error: e.message || 'FX fetch failed' }, { status: 500 });
  }
}