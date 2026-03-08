export const dynamic = 'force-dynamic';

const FMP = 'https://financialmodelingprep.com/stable';

async function fmpGet(path, key) {
  const sep = path.includes('?') ? '&' : '?';
  try {
    const r = await fetch(`${FMP}/${path}${sep}apikey=${key}`);
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
    const [profile, quote, ratios, income, balance, cashflow] = await Promise.all([
      fmpGet(`profile?symbol=${symbol}`, key),
      fmpGet(`quote?symbol=${symbol}`, key),
      fmpGet(`ratios-ttm?symbol=${symbol}`, key),
      fmpGet(`income-statement?symbol=${symbol}&period=quarter&limit=8`, key),
      fmpGet(`balance-sheet-statement?symbol=${symbol}&period=quarter&limit=4`, key),
      fmpGet(`cash-flow-statement?symbol=${symbol}&period=quarter&limit=4`, key),
    ]);

    const arr = d => (Array.isArray(d) ? d : []);

    return Response.json({
      profile: arr(profile)[0] || {},
      quote: arr(quote)[0] || {},
      ratios: arr(ratios)[0] || {},
      income: arr(income),
      balance: arr(balance),
      cashflow: arr(cashflow),
    });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
