const FLIGHT_TTL = 60 * 1000;
const cache = { data: null, ts: 0 };

const OPENSKY_URL = 'https://opensky-network.org/api/states/all';
const ADSBFI_URL = 'https://opendata.adsb.fi/api/v2/mil';

async function fromOpenSky() {
  const headers = { 'User-Agent': 'QuantumTerminal/1.0' };
  if (process.env.OPENSKY_USERNAME && process.env.OPENSKY_PASSWORD) {
    const tok = Buffer.from(`${process.env.OPENSKY_USERNAME}:${process.env.OPENSKY_PASSWORD}`).toString('base64');
    headers.Authorization = `Basic ${tok}`;
  }
  const ctrl = AbortSignal.timeout(8000);
  const r = await fetch(OPENSKY_URL, { cache: 'no-store', headers, signal: ctrl });
  if (!r.ok) throw new Error(`OpenSky HTTP ${r.status}`);
  const j = await r.json();
  const states = j.states || [];
  const filtered = states
    .filter((s) => s[5] != null && s[6] != null)
    .map((s) => ({
      lat: +s[6].toFixed(3),
      lon: +s[5].toFixed(3),
      alt: s[7] != null ? Math.round(s[7]) : 0,
      vel: s[9] != null ? Math.round(s[9]) : null,
      country: s[2] || '',
      callsign: (s[1] || '').trim(),
    }))
    .sort((a, b) => b.alt - a.alt)
    .slice(0, 10000);
  return { aircraft: filtered, count: filtered.length, total: states.length, source: 'OpenSky' };
}

async function fromAdsbFi() {
  // adsb.fi exposes a free public endpoint with worldwide military traffic, no
  // auth, no rate limit. Useful when OpenSky is throttling.
  const ctrl = AbortSignal.timeout(8000);
  const r = await fetch(ADSBFI_URL, { cache: 'no-store', signal: ctrl });
  if (!r.ok) throw new Error(`adsb.fi HTTP ${r.status}`);
  const j = await r.json();
  const list = (j.ac || j.aircraft || []).filter((a) => a.lat != null && a.lon != null);
  const filtered = list.map((a) => ({
    lat: +a.lat.toFixed(3),
    lon: +a.lon.toFixed(3),
    alt: a.alt_baro != null && Number.isFinite(+a.alt_baro) ? Math.round(+a.alt_baro * 0.3048) : 0,
    vel: a.gs != null ? Math.round(+a.gs * 0.5144) : null,
    country: a.r || '',
    callsign: (a.flight || '').trim(),
  }));
  return { aircraft: filtered, count: filtered.length, total: filtered.length, source: 'adsb.fi' };
}

// Synthetic fleet so the world map always has something to show even if every
// upstream feed is unreachable. Concentrated around major air corridors.
function syntheticFleet() {
  const corridors = [
    { lat: 40.6, lon: -73.8, spread: 35, n: 60 },   // North Atlantic / Eastern US
    { lat: 51.5, lon: 0, spread: 22, n: 70 },        // Western Europe
    { lat: 35, lon: 105, spread: 28, n: 60 },        // East Asia
    { lat: 25, lon: 55, spread: 18, n: 25 },         // Middle East
    { lat: -10, lon: -55, spread: 25, n: 18 },       // South America
    { lat: -25, lon: 135, spread: 25, n: 17 },       // Australia / SE Asia
    { lat: 0, lon: 35, spread: 22, n: 10 },          // Africa
  ];
  const out = [];
  let idx = 0;
  for (const c of corridors) {
    for (let i = 0; i < c.n; i++) {
      const lat = +(c.lat + (Math.random() - 0.5) * c.spread).toFixed(3);
      const lon = +(c.lon + (Math.random() - 0.5) * c.spread * 1.5).toFixed(3);
      out.push({
        lat, lon,
        alt: Math.round(7000 + Math.random() * 5000),
        vel: Math.round(180 + Math.random() * 80),
        country: '',
        callsign: `SIM${(1000 + idx++).toString()}`,
      });
    }
  }
  return { aircraft: out, count: out.length, total: out.length, source: 'synthetic' };
}

export async function GET() {
  if (cache.data && Date.now() - cache.ts < FLIGHT_TTL) {
    return Response.json(cache.data);
  }
  const errors = [];
  for (const fn of [fromOpenSky, fromAdsbFi]) {
    try {
      const data = await fn();
      if (data.aircraft.length > 0) {
        const out = { ...data, timestamp: Date.now() };
        cache.data = out; cache.ts = Date.now();
        return Response.json(out);
      }
    } catch (e) {
      errors.push(`${fn.name}: ${e.message || e}`);
    }
  }
  const fallback = { ...syntheticFleet(), timestamp: Date.now(), error: errors.join(' · ') || 'live feeds unavailable' };
  cache.data = fallback; cache.ts = Date.now();
  return Response.json(fallback);
}