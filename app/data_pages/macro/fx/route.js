import { getCached, setCache } from '../../_cache';

// Frankfurter API: free, unlimited, no key, ECB daily fixings.
// Strategy: fetch a single 45-day time series, then pick anchor dates from
// the actual data. This avoids the trap where today's UTC date == latest
// fixing date (ECB publishes ~16:00 CET, so for several hours each day the
// "latest" rate IS today's date and asking for "1 day ago" returns the same).

const CURR = ['USD', 'EUR', 'JPY', 'GBP', 'CNY', 'AUD', 'CAD', 'CHF', 'NZD', 'MXN', 'KRW'];
const NON_USD = CURR.filter((c) => c !== 'USD');

function isoDaysAgo(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

async function fetchSeries(start, symbols) {
  const url = `https://api.frankfurter.dev/v1/${start}..?base=USD&symbols=${symbols.join(',')}`;
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`Frankfurter timeseries: ${r.status}`);
  const j = await r.json();
  if (!j.rates) throw new Error('Frankfurter: no rates in response');
  // j.rates is { 'YYYY-MM-DD': { CCY: rate, ... }, ... }
  return Object.entries(j.rates)
    .map(([date, rates]) => ({ date, rates }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// Pick the rate snapshot that's closest to (latestDate - daysBack) but strictly older.
function pickAnchor(series, latestDate, daysBack) {
  const target = new Date(`${latestDate}T00:00:00Z`);
  target.setUTCDate(target.getUTCDate() - daysBack);
  const targetIso = target.toISOString().slice(0, 10);
  // Find the most recent series entry whose date <= targetIso.
  let best = null;
  for (const entry of series) {
    if (entry.date <= targetIso) best = entry;
    else break;
  }
  return best || series[0];
}

// Pct change of currency C vs USD over the window. Frankfurter rates are
// 1 USD = X C; if X drops, C strengthened vs USD.
// Returns: positive number = C strengthened relative to USD over window.
function currencyVsUsdPct(latestRates, priorRates) {
  const out = { USD: 0 };
  for (const c of NON_USD) {
    const lr = latestRates[c];
    const pr = priorRates[c];
    if (lr == null || pr == null || pr === 0) { out[c] = null; continue; }
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
    // Fetch 45 days back so we always have anchors for 1m + buffer
    const series = await fetchSeries(isoDaysAgo(45), NON_USD);
    if (series.length === 0) throw new Error('Frankfurter returned empty series');

    const latest = series[series.length - 1];
    const a24h = pickAnchor(series, latest.date, 1);  // most recent strictly older entry
    const a1w  = pickAnchor(series, latest.date, 7);
    const a1m  = pickAnchor(series, latest.date, 30);

    const usdRates = { USD: 1, ...latest.rates };

    const valuesMatrix = {};
    for (const a of CURR) {
      valuesMatrix[a] = {};
      for (const b of CURR) {
        if (a === b) { valuesMatrix[a][b] = 1; continue; }
        const ra = usdRates[a]; const rb = usdRates[b];
        valuesMatrix[a][b] = (ra && rb) ? +(rb / ra).toFixed(5) : null;
      }
    }

    const chg24h = currencyVsUsdPct(latest.rates, a24h.rates);
    const chg1w  = currencyVsUsdPct(latest.rates, a1w.rates);
    const chg1m  = currencyVsUsdPct(latest.rates, a1m.rates);

    const matrices = {
      '24h': buildMatrix(CURR, chg24h),
      '1w':  buildMatrix(CURR, chg1w),
      '1m':  buildMatrix(CURR, chg1m),
    };

    let dxy = null;
    if (usdRates.EUR && usdRates.JPY && usdRates.GBP && usdRates.CAD && usdRates.CHF) {
      // Need SEK for the official basket; fetch separately if not in main pull.
      let sekRate = usdRates.SEK;
      if (!sekRate) {
        try {
          const sekSeries = await fetchSeries(isoDaysAgo(7), ['SEK']);
          sekRate = sekSeries[sekSeries.length - 1]?.rates?.SEK;
        } catch (_) { /* skip DXY */ }
      }
      if (sekRate) {
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
    }

    const dxyChange24h = chg24h.EUR != null ? -chg24h.EUR : 0;

    const data = {
      currencies: CURR,
      matrices,
      values: valuesMatrix,
      usdRates,
      pairChanges: chg24h,
      dxy,
      dxyChange24h: +dxyChange24h.toFixed(2),
      anchors: { latest: latest.date, '24h': a24h.date, '1w': a1w.date, '1m': a1m.date },
      source: 'frankfurter (ECB)',
      lastUpdated: new Date().toISOString(),
    };
    setCache('macro:fx', data, 30 * 60 * 1000);
    return Response.json(data);
  } catch (e) {
    return Response.json({ error: e.message || 'Frankfurter fetch failed' }, { status: 500 });
  }
}