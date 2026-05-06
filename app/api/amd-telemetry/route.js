export const dynamic = 'force-dynamic';

const AMD_DROPLET = process.env.AMD_TELEMETRY_URL || 'http://134.199.197.24:8000';

export async function GET() {
  try {
    const r = await fetch(`${AMD_DROPLET}/telemetry`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) throw new Error(`status ${r.status}`);
    const data = await r.json();
    return Response.json({ ...data, status: 'online' });
  } catch (e) {
    return Response.json({
      gpu: 'AMD Instinct MI300X',
      status: 'offline',
      temp_c: null,
      power_w: null,
      gpu_util_pct: null,
      vram_used_pct: null,
      rocm_version: '7.1',
      error: e.message,
    });
  }
}