export const dynamic = 'force-dynamic';

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const symbol = (searchParams.get('symbol') || 'NVDA').toUpperCase();
  const timeframe = searchParams.get('timeframe') || '1Min';
  const days = Math.min(parseInt(searchParams.get('days') || '5'), 30);

  const key = process.env.ALPACA_API_KEY;
  const secret = process.env.ALPACA_SECRET_KEY;
  if (!key || !secret) return Response.json({ error: 'Alpaca keys not set' }, { status: 500 });

  try {
    const end = new Date();
    const start = new Date(end.getTime() - days * 864e5);
    const params = new URLSearchParams({
      start: start.toISOString(), end: end.toISOString(),
      timeframe, feed: 'iex', limit: '10000', sort: 'asc',
    });

    const res = await fetch(
      `https://data.alpaca.markets/v2/stocks/${encodeURIComponent(symbol)}/bars?${params}`,
      { headers: { 'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': secret } }
    );

    if (!res.ok) return Response.json({ error: `Alpaca: ${res.status}` }, { status: res.status });
    const data = await res.json();
    return Response.json({ symbol, bars: data.bars || [], count: (data.bars || []).length, timeframe });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
