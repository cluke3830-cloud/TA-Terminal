'use client';

import { useEffect, useState } from 'react';

export default function MacroFlightsWidget() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    fetch('/data_pages/macro/flights')
      .then((r) => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
      .then(setData)
      .catch((e) => setErr(String(e)));
  }, []);

  if (err) return <div className="err">⚠ {err}</div>;
  if (!data) return <div className="loading"><div className="spinner" />Loading flights…</div>;

  const flights = data.flights || data.states || data.items || [];
  return (
    <div className="macro-widget">
      <div className="macro-title">Flights tracked · {flights.length || 0} live</div>
      {flights.length === 0 ? (
        <div className="loading">No flight data</div>
      ) : (
        <table className="dt">
          <thead><tr><th>Callsign</th><th>Country</th><th>Alt</th><th>Vel</th></tr></thead>
          <tbody>
            {flights.slice(0, 12).map((f, i) => (
              <tr key={i}>
                <td>{f.callsign || f.icao24 || f.id}</td>
                <td>{f.origin_country || f.country}</td>
                <td>{f.altitude != null ? `${Math.round(f.altitude)}m` : (f.baro_altitude != null ? `${Math.round(f.baro_altitude)}m` : '—')}</td>
                <td>{f.velocity != null ? `${Math.round(f.velocity * 3.6)} km/h` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}