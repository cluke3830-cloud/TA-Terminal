export const dynamic = 'force-dynamic';

const AMD_DROPLET = process.env.AMD_TELEMETRY_URL || 'http://134.199.197.24:8000';

export async function POST(req) {
  try {
    const body = await req.json();
    const r = await fetch(`${AMD_DROPLET}/llm/regime-summary`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(35000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    return Response.json(data);
  } catch (e) {
    return Response.json({ error: e.message, summary: null });
  }
}