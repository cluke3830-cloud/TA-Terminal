export const dynamic = 'force-dynamic';

const FMP = 'https://financialmodelingprep.com/stable';
const FMP3 = 'https://financialmodelingprep.com/api/v3'; // some endpoints still v3

async function fmpGet(url, key) {
  const sep = url.includes('?') ? '&' : '?';
  try {
    const r = await fetch(`${url}${sep}apikey=${key}`);
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
    // Try multiple FMP endpoints — some may be premium-only, so we handle nulls
    const [targets, consensus, news, upgrades] = await Promise.all([
      fmpGet(`${FMP}/price-target-summary?symbol=${symbol}`, key),
      fmpGet(`${FMP}/price-target-consensus?symbol=${symbol}`, key),
      fmpGet(`${FMP3}/stock_news?tickers=${symbol}&limit=5`, key),
      fmpGet(`${FMP}/upgrades-downgrades-consensus?symbol=${symbol}`, key),
    ]);

    return Response.json({
      targets: Array.isArray(targets) ? targets[0] || null : targets || null,
      consensus: Array.isArray(consensus) ? consensus[0] || null : consensus || null,
      upgrades: Array.isArray(upgrades) ? upgrades[0] || null : upgrades || null,
      news: Array.isArray(news) ? news.slice(0, 5) : [],
    });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
