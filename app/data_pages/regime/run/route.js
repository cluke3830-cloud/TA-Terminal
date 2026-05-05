// Proxies /regime/run requests to the FastAPI gpu-service that wraps
// regime_dashboard.py.  REGIME_API_URL takes priority; falls back to
// MC_GPU_URL since both endpoints live on the same FastAPI process.
//
// First call on a cold ticker runs HMM + LSTM training and can take
// 2-3 minutes — the timeout below is intentionally generous. Cached
// runs return in <100ms.

const DEFAULT_TIMEOUT_MS = 240_000;

function resolveBase() {
  return process.env.REGIME_API_URL || process.env.MC_GPU_URL || null;
}

export async function GET(request) {
  const base = resolveBase();
  if (!base) {
    return Response.json(
      {
        error: 'Regime engine offline',
        detail: 'Set REGIME_API_URL (or MC_GPU_URL) to the FastAPI service running gpu-service/main.py.',
        offline: true,
      },
      { status: 503 },
    );
  }

  const { searchParams } = new URL(request.url);
  const ticker = (searchParams.get('ticker') || 'SPY').toUpperCase().trim();
  const force = searchParams.get('force') === '1' || searchParams.get('force') === 'true';

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const r = await fetch(`${base.replace(/\/$/, '')}/regime/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ticker, force }),
      signal: ctrl.signal,
      cache: 'no-store',
    });
    clearTimeout(timer);
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      return Response.json(
        { error: `Upstream ${r.status}`, detail: text },
        { status: 502 },
      );
    }
    const j = await r.json();
    return Response.json(j, {
      headers: {
        // Browser cache 60s, edge serves stale up to 5min while revalidating.
        'cache-control': 'private, max-age=60, stale-while-revalidate=300',
      },
    });
  } catch (e) {
    clearTimeout(timer);
    return Response.json(
      {
        error: e?.name === 'AbortError' ? 'Upstream timeout (HMM+LSTM training can take 2-3min on cold tickers)' : (e?.message || 'Regime service unreachable'),
        offline: true,
      },
      { status: 502 },
    );
  }
}
