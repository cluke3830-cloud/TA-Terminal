import { getCached, setCache } from '../../_cache';

const FLIGHT_TTL = 60 * 1000; // 60s
const cache = { data: null, ts: 0 };

export async function GET() {
  if (cache.data && Date.now() - cache.ts < FLIGHT_TTL) {
    return Response.json(cache.data);
  }

  try {
    const r = await fetch('https://opensky-network.org/api/states/all', {
      cache: 'no-store',
      headers: { 'User-Agent': 'QuantumTerminal/1.0' },
    });
    if (!r.ok) {
      const fallback = { aircraft: [], count: 0, error: 'OpenSky unavailable', timestamp: Date.now() };
      return Response.json(fallback);
    }
    const j = await r.json();
    const states = j.states || [];

    // OpenSky state vector indices:
    // 0:icao24, 1:callsign, 2:origin_country, 5:lon, 6:lat, 7:baro_alt, 9:velocity
    // No altitude floor — keep landings, take-offs, regional traffic. Slice
    // to 10k aircraft so the world map looks dense without exploding payload.
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

    const data = {
      aircraft: filtered,
      count: filtered.length,
      total: states.length,
      timestamp: Date.now(),
    };
    cache.data = data;
    cache.ts = Date.now();
    return Response.json(data);
  } catch (e) {
    return Response.json({ aircraft: [], count: 0, error: e.message || 'fetch failed', timestamp: Date.now() });
  }
}