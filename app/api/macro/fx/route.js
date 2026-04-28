import { getCached, setCache } from '../../_cache';

const CURR = ['USD', 'EUR', 'JPY', 'GBP', 'CNY', 'AUD', 'CAD', 'CHF'];
const DXY_CURR = ['EUR', 'JPY', 'GBP', 'CAD', 'SEK', 'CHF'];

async function fmpFx(symbol, key) {
  try {
    const r = await fetch(`https://financialmodelingprep.com/stable/quote?symbol=${symbol}&apikey=${key}`, { cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json();
    return Array.isArray(j) && j[0] ? j[0] : null;
  } catch (_) { return null; }
}

// Returns the rate of (1 BASE = X QUOTE)
async function getRate(base, quote, key, cache) {
  if (base === quote) return 1;
  const k = `${base}${quote}`;
  if (cache[k] != null) return cache[k];
  // Try direct
  const direct = await fmpFx(`${base}${quote}`, key);
  if (direct?.price) {
    cache[k] = direct.price;
    cache[`${quote}${base}`] = 1 / direct.price;
    return direct.price;
  }
  // Try inverse
  const inv = await fmpFx(`${quote}${base}`, key);
  if (inv?.price) {
    cache[k] = 1 / inv.price;
    cache[`${quote}${base}`] = inv.price;
    return cache[k];
  }
  return null;
}

export async function GET() {
  const cached = getCached('macro:fx');
  if (cached) return Response.json(cached);

  const KEY = process.env.FMP_API_KEY;
  if (!KEY) return Response.json({ error: 'FMP_API_KEY not configured' }, { status: 500 });

  try {
    const rateCache = {};
    // Fetch rates of every currency vs USD (1 USD = X CCY)
    const usdRates = { USD: 1 };
    await Promise.all(CURR.filter((c) => c !== 'USD').map(async (c) => {
      const r = await getRate('USD', c, KEY, rateCache);
      usdRates[c] = r;
    }));
    // SEK separately for DXY
    if (!usdRates.SEK) {
      usdRates.SEK = await getRate('USD', 'SEK', KEY, rateCache);
    }

    // 24h change percentages for each pair vs USD (use FMP quote data)
    const pairChanges = {};
    await Promise.all(CURR.filter((c) => c !== 'USD').map(async (c) => {
      const q = await fmpFx(`USD${c}`, KEY);
      if (q && q.changesPercentage != null) {
        pairChanges[c] = +q.changesPercentage.toFixed(3);
      } else {
        const inv = await fmpFx(`${c}USD`, KEY);
        if (inv && inv.changesPercentage != null) pairChanges[c] = -inv.changesPercentage;
        else pairChanges[c] = 0;
      }
    }));

    // Build matrix: matrix[A][B] = strength of A relative to B
    // Convention: matrix[A][B] = (rate_USD_A) / (rate_USD_B) inverse: how many B units per A
    // Display in % change, where positive means A appreciated vs B over 24h
    const matrix = {};
    const valuesMatrix = {};
    for (const a of CURR) {
      matrix[a] = {};
      valuesMatrix[a] = {};
      for (const b of CURR) {
        if (a === b) {
          matrix[a][b] = 0;
          valuesMatrix[a][b] = 1;
          continue;
        }
        // Cross rate: 1 A = (1/rate_USD_A) USD = (1/rate_USD_A) * rate_USD_B in B
        const ra = usdRates[a]; const rb = usdRates[b];
        if (ra == null || rb == null) {
          matrix[a][b] = null;
          valuesMatrix[a][b] = null;
          continue;
        }
        // Strength = % change of A vs B over 24h.
        // changeA_vs_USD = -pairChanges[a]  (since pairChanges[c] = USD/c change → if USD up, c down)
        // For non-USD pair vs USD: a vs usd = -pairChanges[a]
        // For USD: 0
        const aChg = a === 'USD' ? 0 : -(pairChanges[a] ?? 0);
        const bChg = b === 'USD' ? 0 : -(pairChanges[b] ?? 0);
        matrix[a][b] = +(aChg - bChg).toFixed(2);
        valuesMatrix[a][b] = +(rb / ra).toFixed(5);
      }
    }

    // DXY computation via ICE formula
    let dxy = null;
    if (usdRates.EUR && usdRates.JPY && usdRates.GBP && usdRates.CAD && usdRates.SEK && usdRates.CHF) {
      dxy = 50.14348112
        * Math.pow(usdRates.EUR, 0.576) // Note: ICE uses EUR/USD^-0.576, so USD/EUR^0.576
        * Math.pow(usdRates.JPY, 0.136)
        * Math.pow(usdRates.GBP, 0.119)
        * Math.pow(usdRates.CAD, 0.091)
        * Math.pow(usdRates.SEK, 0.042)
        * Math.pow(usdRates.CHF, 0.036);
      // Wait - check formula sign. Official: DXY = 50.14348112 × (EURUSD^-0.576) × (USDJPY^0.136) × (GBPUSD^-0.119) × (USDCAD^0.091) × (USDSEK^0.042) × (USDCHF^0.036)
      // So we need EUR/USD = 1/usdRates.EUR (since usdRates.EUR is USD/EUR).
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

    // Average DXY change ≈ -aChange of EUR (rough proxy, since EUR is dominant)
    const dxyChange24h = -(matrix.USD?.EUR ?? 0);

    const data = {
      currencies: CURR,
      matrix,        // % change matrix (24h relative strength)
      values: valuesMatrix, // raw exchange rates
      usdRates,
      pairChanges,
      dxy,
      dxyChange24h: +dxyChange24h.toFixed(2),
      lastUpdated: new Date().toISOString(),
    };
    setCache('macro:fx', data);
    return Response.json(data);
  } catch (e) {
    return Response.json({ error: e.message || 'FX fetch failed' }, { status: 500 });
  }
}