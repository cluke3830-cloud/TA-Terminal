export const dynamic = 'force-dynamic';

import { loadOptionSurface } from '../_lib/optionsChain';

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const { status, body } = await loadOptionSurface(searchParams.get('symbol'));
  return Response.json(body, { status });
}
