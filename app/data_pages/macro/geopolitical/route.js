export const dynamic = 'force-dynamic';

import { getCached, setCache } from '../../_cache';
import { getJson } from '../../_lib/http';

// Two map layers, both read live. Neither is a hand-kept list.
//
//   view=risk  World Bank Worldwide Governance Indicators, "Political
//              Stability and Absence of Violence/Terrorism" (GOV_WGI_PV.EST).
//              The estimate runs from about -2.5 (least stable) to +2.5. The
//              map shows it as risk on a 0 to 10 scale: risk = (2.5 - estimate) * 2.
//              It is a yearly survey-based score, so it moves slowly and does
//              not react to this week's news.
//
//   view=oil   US Energy Information Administration, international data:
//              proved reserves of crude oil, billion barrels, latest year per
//              country. Needs EIA_API_KEY. The page shows this layer only
//              when the EIA answers; there is no stored copy to fall back on.

const HOUR = 60 * 60 * 1000;

async function loadRisk() {
  const hit = getCached('macro:geo:risk');
  if (hit) return hit;
  const j = await getJson(
    'https://api.worldbank.org/v2/country/all/indicator/GOV_WGI_PV.EST?format=json&mrnev=1&per_page=400', {}, 9000,
  );
  if (!Array.isArray(j) || !Array.isArray(j[1])) throw new Error('World Bank: unexpected response shape');
  const data = j[1]
    .filter((d) => d.value != null && d.countryiso3code && d.countryiso3code.length === 3)
    .map((d) => ({
      iso3: d.countryiso3code,
      country: d.country.value,
      estimate: +d.value.toFixed(2),
      score: +Math.min(10, Math.max(0, (2.5 - d.value) * 2)).toFixed(1),
      year: d.date,
      factors: [], // read by page code from before 2.1; kept so an old open tab cannot crash
    }))
    .sort((a, b) => b.score - a.score);
  if (data.length === 0) throw new Error('World Bank: no governance rows');
  const out = {
    kind: 'risk',
    data,
    year: data.map((d) => d.year).sort().pop(),
    source: 'World Bank Worldwide Governance Indicators: Political Stability and Absence of Violence',
    scale: 'risk = (2.5 - WGI estimate) x 2, so 0 is most stable and 10 least stable',
    lastUpdated: new Date().toISOString(),
  };
  setCache('macro:geo:risk', out, 12 * HOUR);
  return out;
}

async function loadOil() {
  const hit = getCached('macro:geo:oil');
  if (hit) return hit;
  // A failed call is remembered for 30 minutes so that every page view does
  // not wait on a source that is not answering.
  const failed = getCached('macro:geo:oil:failed');
  if (failed) throw new Error(failed);
  try {
    return await fetchOil();
  } catch (e) {
    setCache('macro:geo:oil:failed', e.message || 'EIA request failed', 30 * 60 * 1000);
    throw e;
  }
}

async function fetchOil() {
  const key = process.env.EIA_API_KEY;
  if (!key) throw new Error('EIA_API_KEY not configured');
  const startYear = new Date().getUTCFullYear() - 3;
  const params = new URLSearchParams();
  params.set('api_key', key);
  params.set('frequency', 'annual');
  params.set('data[0]', 'value');
  params.append('facets[activityId][]', '6');   // reserves
  params.append('facets[productId][]', '57');   // crude oil including lease condensate
  params.append('facets[unit][]', 'BB');        // billion barrels
  params.set('start', String(startYear));
  params.set('sort[0][column]', 'period');
  params.set('sort[0][direction]', 'desc');
  params.set('offset', '0');
  params.set('length', '1500');
  const j = await getJson(`https://api.eia.gov/v2/international/data/?${params}`, {}, 9000);
  const rows = j?.response?.data;
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('EIA: no reserve rows');

  // Rows arrive newest first: keep each area's first usable value.
  const latest = new Map();
  for (const r of rows) {
    const v = parseFloat(r.value);
    if (!Number.isFinite(v) || latest.has(r.countryRegionId)) continue;
    latest.set(r.countryRegionId, { id: r.countryRegionId, name: r.countryRegionName, reserves: v, year: String(r.period) });
  }
  const world = latest.get('WORL') || null;
  const opec = latest.get('OPEC') || null;
  const data = [...latest.values()]
    // Countries carry a 3-letter ISO code; aggregates use 4 letters.
    .filter((r) => r.id && r.id.length === 3 && r.reserves > 0)
    .map((r) => ({ iso3: r.id, country: r.name, reserves: +r.reserves.toFixed(1), year: r.year }))
    .sort((a, b) => b.reserves - a.reserves);
  if (data.length === 0) throw new Error('EIA: no country rows');
  const out = {
    kind: 'oil',
    data,
    year: data[0].year,
    opecSharePct: world && opec && world.reserves > 0 ? +((opec.reserves / world.reserves) * 100).toFixed(1) : null,
    source: 'US Energy Information Administration, international proved crude oil reserves',
    lastUpdated: new Date().toISOString(),
  };
  setCache('macro:geo:oil', out, 12 * HOUR);
  return out;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const view = searchParams.get('view') || 'risk';
  try {
    return Response.json(view === 'oil' ? await loadOil() : await loadRisk());
  } catch (e) {
    return Response.json({ kind: view, data: [], error: e.message || 'unavailable' }, { status: 502 });
  }
}
