import { getCached, setCache } from '../../_cache';

const TF_DAYS = { '1m': 22, '3m': 66, '6m': 132, '1y': 252, '5y': 1260 };

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const symbol = (searchParams.get('symbol') || '').toUpperCase();
  const tf = (searchParams.get('tf') || '1y').toLowerCase();
  if (!symbol) return Response.json({ error: 'symbol required' }, { status: 400 });
  if (!TF_DAYS[tf]) return Response.json({ error: `tf must be one of ${Object.keys(TF_DAYS).join(',')}` }, { status: 400 });

  const cacheKey = `commhist:${symbol}:${tf}`;
  const cached = getCached(cacheKey);
  if (cached) return Response.json(cached);

  const KEY = process.env.FMP_API_KEY;
  if (!KEY) return Response.json({ error: 'FMP_API_KEY not configured' }, { status: 500 });

  try {
    const r = await fetch(`https://financialmodelingprep.com/stable/historical-price-eod/light?symbol=${symbol}&apikey=${KEY}`, { cache: 'no-store' });
    if (!r.ok) return Response.json({ error: `FMP: ${r.status}` }, { status: r.status });
    const j = await r.json();
    if (!Array.isArray(j)) return Response.json({ error: 'unexpected response' }, { status: 500 });

    const sorted = j
      .map((p) => ({ date: p.date, price: p.price ?? p.close }))
      .filter((p) => p.date && p.price != null)
      .sort((a, b) => a.date.localeCompare(b.date));

    const slice = sorted.slice(-TF_DAYS[tf]);
    const data = {
      symbol,
      tf,
      prices: slice.map((p) => p.price),
      dates: slice.map((p) => p.date),
      lastUpdated: new Date().toISOString(),
    };
    setCache(cacheKey, data, 6 * 60 * 60 * 1000); // 6h — historical, rarely changes
    return Response.json(data);
  } catch (e) {
    return Response.json({ error: e.message || 'history fetch failed' }, { status: 500 });
  }
}