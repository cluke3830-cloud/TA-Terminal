// Proxies the MC pricer request to the ROCm-backed FastAPI service.
// MC_GPU_URL points at the box running gpu-service/main.py (default
// http://localhost:8000). When unset, this route returns 503 + a clear
// "GPU offline" payload so the frontend can show a badge instead of erroring.

const DEFAULT_TIMEOUT_MS = 15_000;

export async function POST(request) {
  const base = process.env.MC_GPU_URL;
  if (!base) {
    return Response.json(
      {
        error: 'GPU offline',
        detail: 'Set MC_GPU_URL to the ROCm pricing service (e.g. http://mi300x:8000).',
        offline: true,
      },
      { status: 503 },
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const r = await fetch(`${base.replace(/\/$/, '')}/mc/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
      cache: 'no-store',
    });
    clearTimeout(timer);
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      return Response.json({ error: `Upstream ${r.status}`, detail: text }, { status: 502 });
    }
    const j = await r.json();
    return Response.json(j);
  } catch (e) {
    clearTimeout(timer);
    return Response.json(
      { error: e?.name === 'AbortError' ? 'Upstream timeout' : (e?.message || 'GPU service unreachable'), offline: true },
      { status: 502 },
    );
  }
}
