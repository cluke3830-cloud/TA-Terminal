export const dynamic = 'force-dynamic';

const FMP3 = 'https://financialmodelingprep.com/api/v3';
const FMP4 = 'https://financialmodelingprep.com/api/v4';

async function fmpGet(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const symbol = (searchParams.get('symbol') || 'NVDA').toUpperCase();
  const key = process.env.FMP_API_KEY;
  if (!key) return Response.json({ error: 'FMP_API_KEY not set' }, { status: 500 });

  try {
    const [targets, news, upgrades] = await Promise.all([
      fmpGet(`${FMP4}/price-target-summary?symbol=${symbol}&apikey=${key}`),
      fmpGet(`${FMP3}/stock_news?tickers=${symbol}&limit=5&apikey=${key}`),
      fmpGet(`${FMP4}/upgrades-downgrades-consensus?symbol=${symbol}&apikey=${key}`),
    ]);

    const first = d => (Array.isArray(d) ? d[0] || null : d || null);

    return Response.json({
      targets: first(targets),
      upgrades: first(upgrades),
      news: Array.isArray(news) ? news.slice(0, 5) : [],
    });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
