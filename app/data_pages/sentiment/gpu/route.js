// Proxies a batch of headline texts to the FinBERT endpoint on the gpu-service.
// MC_GPU_URL is reused since it points at the same MI300X box.

const DEFAULT_TIMEOUT_MS = 28_000; // FinBERT cold start can brush 30s

export async function POST(request) {
  const base = process.env.MC_GPU_URL;
  if (!base) {
    return Response.json(
      { error: 'GPU offline', detail: 'Set MC_GPU_URL to the FinBERT-enabled gpu-service.', offline: true },
      { status: 503 },
    );
  }

  let body;
  try { body = await request.json(); } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const r = await fetch(`${base.replace(/\/$/, '')}/finbert/score`, {
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
    return Response.json(await r.json());
  } catch (e) {
    clearTimeout(timer);
    return Response.json(
      { error: e?.name === 'AbortError' ? 'Upstream timeout' : (e?.message || 'GPU service unreachable'), offline: true },
      { status: 502 },
    );
  }
}