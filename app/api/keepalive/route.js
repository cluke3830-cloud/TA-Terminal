// Vercel Cron hits this every 10 minutes to keep the Render regime-service warm.
// Render free tier sleeps after 15 min of inactivity — this prevents that.
// Schedule is set in vercel.json: "*/10 * * * *"

export const runtime = 'nodejs';

function resolveBase() {
  return process.env.REGIME_API_URL || process.env.MC_GPU_URL || null;
}

export async function GET(request) {
  const base = resolveBase();
  if (!base) {
    return Response.json({ ok: false, reason: 'REGIME_API_URL not set' }, { status: 200 });
  }

  const start = Date.now();
  try {
    const r = await fetch(`${base.replace(/\/$/, '')}/health`, {
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    });
    const j = await r.json().catch(() => ({}));
    return Response.json({ ok: r.ok, status: r.status, ms: Date.now() - start, regime: j });
  } catch (e) {
    return Response.json({ ok: false, error: e?.message, ms: Date.now() - start }, { status: 200 });
  }
}