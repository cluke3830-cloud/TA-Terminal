export const dynamic = 'force-dynamic';

import { getRiskFree } from '../../_lib/rates';

// The risk-free rate the pricers start from: today's 3-month Treasury yield.
// The Monte Carlo and portfolio pages read this for their default; the user
// can still type another value.
export async function GET() {
  try {
    const rf = await getRiskFree();
    if (!rf) {
      return Response.json(
        { error: 'No live Treasury rate is available right now', rate: null },
        { status: 503 },
      );
    }
    return Response.json({ ...rf, lastUpdated: new Date().toISOString() });
  } catch (e) {
    return Response.json({ error: e.message || 'rate lookup failed', rate: null }, { status: 503 });
  }
}
