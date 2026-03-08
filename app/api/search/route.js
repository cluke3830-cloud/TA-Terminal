export const dynamic = 'force-dynamic';

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q') || '';
  const key = process.env.FMP_API_KEY;
  if (!key || !q) return Response.json({ results: [] });

  try {
    const r = await fetch(
      `https://financialmodelingprep.com/stable/search-name?query=${encodeURIComponent(q)}&apikey=${key}`
    );
    if (!r.ok) return Response.json({ results: [] });
    const data = await r.json();
    const results = (Array.isArray(data) ? data : [])
      .filter(x => x.exchangeShortName === 'NASDAQ' || x.exchangeShortName === 'NYSE' || x.exchangeShortName === 'AMEX')
      .slice(0, 8)
      .map(x => ({ symbol: x.symbol, name: x.name || x.companyName || '' }));
    return Response.json({ results });
  } catch {
    return Response.json({ results: [] });
  }
}
