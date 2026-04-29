import { getCached, setCache } from '../../_cache';

// Frankfurter API: free, unlimited, no key, ECB daily fixings.
// Docs: https://www.frankfurter.dev
//
// Why this beats FMP for FX: a complete 10-currency, 4-date snapshot is
// just 4 HTTP calls vs ~30 FMP calls, and there's no daily quota.
// Trade-off: ECB doesn't publish weekend/holiday rates; the API returns
// the most recent business day's rate, so weekend "24h change" is
// actually Fri→Mon. Acceptable for a strength matrix.

const CURR = ['USD', 'EUR', 'JPY', 'GBP', 'CNY', 'AUD', 'CAD', 'CHF', 'NZD', 'MXN', 'KRW'];
const NON_USD = CURR.filter((c) => c !== 'USD');

async function frankfurterAt(date, symbols) {
  // date: 'YYYY-MM-DD' or 'latest'
  const url = `https://api.frankfurter.dev/v1/${date}?base=USD&symbols=${symbols.join(',')}`;
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`Frankfurter ${date}: ${r.status}`);
  const j = await r.json();
  return { date: j.date, rates: j.rates || {} };
}

function isoDaysAgo(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

// Pct change of currency C vs USD over the window.
// Frankfurter rates are 1 USD = X C. If X drops, C strengthened vs USD.
// Returns: positive number = C strengthened relative to USD over window.
function currencyVsUsdPct(latestRates, priorRates) {
  const out = { USD: 0 };
  for (const c of NON_USD) {
    const lr = latestRates[c];
    const pr = priorRates[c];
    if (lr == null || pr == null || pr === 0) { out[c] = null; continue; }
    // C/USD change = (1/lr - 1/pr) / (1/pr) = (pr - lr) / lr
    out[c] = +(((pr - lr) / lr) * 100).toFixed(3);
  }
  return out;
}

function buildMatrix(currencies, currencyChanges) {
  const matrix = {};
  for (const a of currencies) {
    matrix[a] = {};
    for (const b of currencies) {
      if (a === b) { matrix[a][b] = 0; continue; }
      const aChg = currencyChanges[a];
      const bChg = currencyChanges[b];
      if (aChg == null || bChg == null) { matrix[a][b] = null; continue; }
      matrix[a][b] = +(aChg - bChg).toFixed(2);
    }
  }
  return matrix;
}

export async function GET() {
  const cached = getCached('macro:fx');
  if (cached) return Response.json(cached);

  try {
    // Frankfurter rolls weekend/holiday queries forward to the most recent
    // business day, so we ask for slightly larger windows to be safe.
    const [latest, d1, d7, d30] = await Promise.all([
      frankfurterAt('latest', NON_USD),
      frankfurterAt(isoDaysAgo(1), NON_USD),
      frankfurterAt(isoDaysAgo(7), NON_USD),
      frankfurterAt(isoDaysAgo(30), NON_USD),
    ]);

    const usdRates = { USD: 1, ...latest.rates }; // 1 USD = X C

    // Spot cross-rates: 1 A = (rate_USD_B / rate_USD_A) units of B
    const valuesMatrix = {};
    for (const a of CURR) {
      valuesMatrix[a] = {};
      for (const b of CURR) {
        if (a === b) { valuesMatrix[a][b] = 1; continue; }
        const ra = usdRates[a]; const rb = usdRates[b];
        valuesMatrix[a][b] = (ra && rb) ? +(rb / ra).toFixed(5) : null;
      }
    }

    // Per-currency % change vs USD over each window
    const chg24h = currencyVsUsdPct(latest.rates, d1.rates);
    const chg1w  = currencyVsUsdPct(latest.rates, d7.rates);
    const chg1m  = currencyVsUsdPct(latest.rates, d30.rates);

    const matrices = {
      '24h': buildMatrix(CURR, chg24h),
      '1w':  buildMatrix(CURR, chg1w),
      '1m':  buildMatrix(CURR, chg1m),
    };

    // DXY via official ICE formula. Need EUR/USD, USD/JPY, GBP/USD,
    // USD/CAD, USD/SEK, USD/CHF — request SEK separately if not in main pull.
    let sekRate = usdRates.SEK;
    if (!sekRate) {
      try {
        const sek = await frankfurterAt('latest', ['SEK']);
        sekRate = sek.rates.SEK;
      } catch (_) { /* leave null */ }
    }

    let dxy = null;
    if (usdRates.EUR && usdRates.JPY && usdRates.GBP && usdRates.CAD && sekRate && usdRates.CHF) {
      const eurUsd = 1 / usdRates.EUR;
      const gbpUsd = 1 / usdRates.GBP;
      dxy = 50.14348112
        * Math.pow(eurUsd, -0.576)
        * Math.pow(usdRates.JPY, 0.136)
        * Math.pow(gbpUsd, -0.119)
        * Math.pow(usdRates.CAD, 0.091)
        * Math.pow(sekRate, 0.042)
        * Math.pow(usdRates.CHF, 0.036);
      dxy = +dxy.toFixed(2);
    }

    // DXY 24h change: -USD's net move vs the basket. USD = 0 in our convention,
    // so use the negative weighted-average move of basket currencies vs USD.
    // Simple proxy: -EUR move (EUR is dominant in DXY).
    const dxyChange24h = chg24h.EUR != null ? -chg24h.EUR : 0;

    const data = {
      currencies: CURR,
      matrices,
      values: valuesMatrix,
      usdRates,
      pairChanges: chg24h, // back-compat field used by Fear & Greed aggregator
      dxy,
      dxyChange24h: +dxyChange24h.toFixed(2),
      source: 'frankfurter (ECB)',
      asOf: latest.date,
      lastUpdated: new Date().toISOString(),
    };
    setCache('macro:fx', data, 30 * 60 * 1000);
    return Response.json(data);
  } catch (e) {
    return Response.json({ error: e.message || 'Frankfurter fetch failed' }, { status: 500 });
  }
}