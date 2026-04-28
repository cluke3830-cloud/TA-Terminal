import { getCached, setCache } from '../../_cache';

const SERIES = [
  { id: 'DGS1MO', label: '1M', mat: 1 / 12 },
  { id: 'DGS3MO', label: '3M', mat: 3 / 12 },
  { id: 'DGS6MO', label: '6M', mat: 6 / 12 },
  { id: 'DGS1', label: '1Y', mat: 1 },
  { id: 'DGS2', label: '2Y', mat: 2 },
  { id: 'DGS5', label: '5Y', mat: 5 },
  { id: 'DGS7', label: '7Y', mat: 7 },
  { id: 'DGS10', label: '10Y', mat: 10 },
  { id: 'DGS20', label: '20Y', mat: 20 },
  { id: 'DGS30', label: '30Y', mat: 30 },
];

async function fredLatest(seriesId, key, anchorDate = null) {
  const params = new URLSearchParams({
    series_id: seriesId,
    api_key: key,
    file_type: 'json',
    sort_order: 'desc',
    limit: '20',
  });
  if (anchorDate) {
    params.set('observation_end', anchorDate);
    params.set('sort_order', 'desc');
    params.set('limit', '20');
  }
  const url = `https://api.stlouisfed.org/fred/series/observations?${params}`;
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) return null;
  const j = await r.json();
  const valid = (j.observations || []).find((o) => o.value && o.value !== '.');
  return valid ? parseFloat(valid.value) : null;
}

function fmtAnchor(yearsAgo) {
  const d = new Date();
  d.setFullYear(d.getFullYear() - yearsAgo);
  return d.toISOString().slice(0, 10);
}

export async function GET() {
  const cached = getCached('macro:yields');
  if (cached) return Response.json(cached);

  const KEY = process.env.FRED_API_KEY;
  if (!KEY) return Response.json({ error: 'FRED_API_KEY not configured' }, { status: 500 });

  try {
    const anchors = { '1y': fmtAnchor(1), '2y': fmtAnchor(2), '5y': fmtAnchor(5) };

    const tasks = [];
    SERIES.forEach((s) => tasks.push(fredLatest(s.id, KEY).then((v) => ({ key: 'current', s, v }))));
    Object.entries(anchors).forEach(([k, d]) => {
      SERIES.forEach((s) => tasks.push(fredLatest(s.id, KEY, d).then((v) => ({ key: k, s, v }))));
    });
    tasks.push(fredLatest('DFF', KEY).then((v) => ({ key: 'dff', v })));
    tasks.push(fredLatest('CPIAUCSL', KEY).then((v) => ({ key: 'cpi', v })));

    const results = await Promise.all(tasks);

    const buckets = { current: [], '1y': [], '2y': [], '5y': [] };
    let dff = null;
    let cpi = null;
    for (const r of results) {
      if (r.key === 'dff') { dff = r.v; continue; }
      if (r.key === 'cpi') { cpi = r.v; continue; }
      buckets[r.key].push({ label: r.s.label, maturity: r.s.mat, yield: r.v });
    }
    Object.values(buckets).forEach((arr) => arr.sort((a, b) => a.maturity - b.maturity));

    const cur = buckets.current;
    const y2 = cur.find((p) => p.label === '2Y')?.yield;
    const y5 = cur.find((p) => p.label === '5Y')?.yield;
    const y10 = cur.find((p) => p.label === '10Y')?.yield;
    const y30 = cur.find((p) => p.label === '30Y')?.yield;
    const spread_10_2 = y10 != null && y2 != null ? +(y10 - y2).toFixed(3) : null;
    const spread_30_5 = y30 != null && y5 != null ? +(y30 - y5).toFixed(3) : null;
    const inversion = spread_10_2 != null && spread_10_2 < 0;

    const data = {
      current: cur,
      historical: { '1y': buckets['1y'], '2y': buckets['2y'], '5y': buckets['5y'] },
      spread_10_2,
      spread_30_5,
      inversion,
      fedFundsRate: dff,
      cpiLatest: cpi,
      lastUpdated: new Date().toISOString(),
    };
    setCache('macro:yields', data);
    return Response.json(data);
  } catch (e) {
    return Response.json({ error: e.message || 'FRED fetch failed' }, { status: 500 });
  }
}