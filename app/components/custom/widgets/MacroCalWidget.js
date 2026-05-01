'use client';

import { useEffect, useState } from 'react';

export default function MacroCalWidget() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    fetch('/data_pages/macro/calendar')
      .then((r) => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
      .then(setData)
      .catch((e) => setErr(String(e)));
  }, []);

  if (err) return <div className="err">⚠ {err}</div>;
  if (!data) return <div className="loading"><div className="spinner" />Loading calendar…</div>;

  const events = data.events || data.calendar || [];
  if (events.length === 0) return <div className="loading">No calendar data</div>;

  return (
    <div className="macro-widget">
      <div className="macro-title">Economic calendar</div>
      <table className="dt">
        <thead><tr><th>Date</th><th>Country</th><th>Event</th><th>Imp.</th></tr></thead>
        <tbody>
          {events.slice(0, 14).map((e, i) => (
            <tr key={i}>
              <td>{(e.date || e.time || '').slice(0, 16)}</td>
              <td>{e.country || e.flag || '—'}</td>
              <td>{e.event || e.title || e.name}</td>
              <td>{e.importance || e.impact || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}