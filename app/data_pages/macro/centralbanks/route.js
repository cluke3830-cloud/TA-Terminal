export const dynamic = 'force-dynamic';

import { loadCentralBanks } from '../../_lib/banks';

export async function GET() {
  try {
    return Response.json(await loadCentralBanks());
  } catch (e) {
    return Response.json({ error: `Central bank rates unavailable: ${e.message || 'BIS request failed'}` }, { status: 502 });
  }
}
