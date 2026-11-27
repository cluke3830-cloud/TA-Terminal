export const dynamic = 'force-dynamic';

import { getCached, setCache } from '../../_cache';
import { getJson } from '../../_lib/http';

// Reserve currency shares: IMF COFER (Currency Composition of Official
// Foreign Exchange Reserves), world total, share of allocated reserves, latest
// quarter the IMF has published. Reserve holders: World Bank, total reserves
// including gold, latest year per country. Both are read live with no key and
// both carry the period they refer to. Nothing here is typed in.

const COLORS = {
  USD: '#00d4ff', EUR: '#9955ff', JPY: '#ff8833', GBP: '#3377ff', CNY: '#ff3355',
  CAD: '#00f59b', AUD: '#ffc700', CHF: '#7a7a90', Other: '#3a3a4d',
};
const ORDER = ['USD', 'EUR', 'JPY', 'GBP', 'CNY', 'CAD', 'AUD', 'CHF', 'Other'];

// World (G001) · allocated reserves (AFXRA) · every currency · share (SHRO_PT) · quarterly
const COFER_URL = 'https://api.imf.org/external/sdmx/2.1/data/IMF.STA,COFER/G001.AFXRA..SHRO_PT.Q?lastNObservations=1';

export function parseCofer(j) {
  const dims = j?.structure?.dimensions;
  const series = j?.dataSets?.[0]?.series;
  if (!dims || !series) throw new Error('IMF COFER: unexpected response shape');
  const curIdx = dims.series.findIndex((d) => d.id === 'FXR_CURRENCY');
  const curVals = dims.series[curIdx].values;
  const periods = dims.observation[0].values;

  const rows = [];
  for (const [key, s] of Object.entries(series)) {
    const code = curVals[+key.split(':')[curIdx]]?.id || '';
    for (const [obsKey, obs] of Object.entries(s.observations || {})) {
      const value = parseFloat(obs[0]);
      const period = periods[+obsKey]?.id;
      if (Number.isFinite(value) && period) rows.push({ code, period, value });
    }
  }
  // Each series reports its own last quarter (the Deutsche mark's is 1998).
  // Keep only the newest quarter.
  const latest = rows.map((r) => r.period).sort().pop();
  const composition = rows
    .filter((r) => r.period === latest && r.code !== 'CI_T')
    .map((r) => {
      const ccy = r.code === 'CI_OTHC' ? 'Other' : r.code.replace('CI_', '');
      return { currency: ccy, share: +r.value.toFixed(1), color: COLORS[ccy] || '#3a3a4d' };
    })
    .filter((r) => ORDER.includes(r.currency))
    .sort((a, b) => ORDER.indexOf(a.currency) - ORDER.indexOf(b.currency));
  if (composition.length === 0) throw new Error('IMF COFER: no shares for the latest quarter');
  return { composition, period: latest };
}

async function worldBankReserves() {
  const j = await getJson(
    'https://api.worldbank.org/v2/country/all/indicator/FI.RES.TOTL.CD?format=json&mrnev=1&per_page=300', {}, 9000,
  );
  if (!Array.isArray(j) || !Array.isArray(j[1])) throw new Error('World Bank: unexpected response shape');
  return j[1]
    // Aggregates (World, regions, income groups) have no 3-letter ISO code.
    .filter((d) => d.value != null && d.countryiso3code && d.countryiso3code.length === 3 && d.country?.id?.length === 2 && !/^[0-9XZ]/.test(d.country.id))
    .map((d) => ({
      country: d.country.value,
      iso3: d.countryiso3code,
      reserves: +(d.value / 1e9).toFixed(1),
      year: d.date,
    }))
    .sort((a, b) => b.reserves - a.reserves);
}

export async function GET() {
  const cached = getCached('macro:flows');
  if (cached) return Response.json(cached);

  const errors = {};
  const [cofer, holders] = await Promise.all([
    getJson(COFER_URL, { headers: { Accept: 'application/json' } }, 9000).then(parseCofer)
      .catch((e) => { errors.cofer = e.message; return null; }),
    worldBankReserves().catch((e) => { errors.reserves = e.message; return null; }),
  ]);

  if (!cofer && !holders) {
    return Response.json({ error: 'Reserve data unavailable', errors }, { status: 502 });
  }

  const data = {
    reserveComposition: cofer ? cofer.composition : [],
    compositionPeriod: cofer ? cofer.period : null,
    compositionSource: 'IMF COFER, world, share of allocated reserves',
    reserveHolders: holders ? holders.slice(0, 50) : [],
    holdersSource: 'World Bank, total reserves including gold (FI.RES.TOTL.CD)',
    errors: Object.keys(errors).length ? errors : undefined,
    lastUpdated: new Date().toISOString(),
  };
  setCache('macro:flows', data, Object.keys(errors).length ? 5 * 60 * 1000 : 6 * 60 * 60 * 1000);
  return Response.json(data);
}
