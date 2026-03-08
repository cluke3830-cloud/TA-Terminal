export const dynamic = 'force-dynamic';

const FMP = 'https://financialmodelingprep.com/stable';

async function fmpFetch(path, key) {
  const sep = path.includes('?') ? '&' : '?';
  const r = await fetch(`${FMP}/${path}${sep}apikey=${key}`);
  if (!r.ok) return null;
  try { return await r.json(); } catch { return null; }
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const symbol = (searchParams.get('symbol') || 'NVDA').toUpperCase();
  const key = process.env.FMP_API_KEY;
  if (!key) return Response.json({ error: 'FMP_API_KEY not set' }, { status: 500 });

  try {
    // Parallel fetch: earnings calendar + historical earnings + quarterly income
    const [calendar, income] = await Promise.all([
      fmpFetch(`earning-calendar?symbol=${symbol}`, key),
      fmpFetch(`income-statement?symbol=${symbol}&period=quarter&limit=12`, key),
    ]);

    // Also try historical earning calendar (may be premium)
    const history = await fmpFetch(`historical/earning_calendar/${symbol}?limit=12`, key);

    return Response.json({
      calendar: Array.isArray(calendar) ? calendar.filter(e => e.symbol === symbol).slice(0, 5) : [],
      history: Array.isArray(history) ? history.slice(0, 12) : [],
      quarterly_income: Array.isArray(income) ? income : [],
    });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
