export const dynamic = 'force-dynamic';

// Optional plain-language regime summary from a self-hosted LLM endpoint
// (LLM_REGIME_URL, a gpu-service instance). When it is not configured the
// page simply does not show the summary box. No address is built in.
const BASE = process.env.LLM_REGIME_URL || process.env.AMD_TELEMETRY_URL || null;

export async function POST(req) {
  if (!BASE) return Response.json({ summary: null, offline: true });
  try {
    const body = await req.json();
    const r = await fetch(`${BASE.replace(/\/$/, '')}/llm/regime-summary`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return Response.json(await r.json());
  } catch (e) {
    return Response.json({ error: e.message, summary: null });
  }
}
