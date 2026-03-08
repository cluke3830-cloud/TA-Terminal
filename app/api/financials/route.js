export const dynamic = 'force-dynamic';

const FMP3 = 'https://financialmodelingprep.com/api/v3';

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

  const q = s => `${FMP3}/${s}&apikey=${key}`;

  try {
    const [profile, ratios, income, balance, cashflow] = await Promise.all([
      fmpGet(q(`profile/${symbol}?`)),
      fmpGet(q(`ratios-ttm/${symbol}?`)),
      fmpGet(q(`income-statement/${symbol}?period=quarter&limit=8`)),
      fmpGet(q(`balance-sheet-statement/${symbol}?period=quarter&limit=4`)),
      fmpGet(q(`cash-flow-statement/${symbol}?period=quarter&limit=4`)),
    ]);

    const arr = d => (Array.isArray(d) ? d : []);

    return Response.json({
      profile: arr(profile)[0] || {},
      ratios: arr(ratios)[0] || {},
      income: arr(income),
      balance: arr(balance),
      cashflow: arr(cashflow),
    });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
