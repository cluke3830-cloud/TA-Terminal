'use client';

import { useEffect, useState } from 'react';

export default function MacroFgWidget() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    fetch('/data_pages/macro/feargreed')
      .then((r) => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
      .then(setData)
      .catch((e) => setErr(String(e)));
  }, []);

  if (err) return <div className="err">⚠ {err}</div>;
  if (!data) return <div className="loading"><div className="spinner" />Loading…</div>;

  const score = data.score ?? data.now ?? data.value ?? null;
  const label = data.label || data.classification || (score != null ? scoreLabel(score) : '');

  return (
    <div className="fg-widget">
      <div className={`fg-score fg-${labelClass(score)}`}>{score != null ? Math.round(score) : '—'}</div>
      <div className="fg-label">{label}</div>
      {data.previous && <div className="fg-prev">prev: {Math.round(data.previous)} ({data.previousLabel || ''})</div>}
    </div>
  );
}

function scoreLabel(s) {
  if (s >= 75) return 'Extreme Greed';
  if (s >= 55) return 'Greed';
  if (s >= 45) return 'Neutral';
  if (s >= 25) return 'Fear';
  return 'Extreme Fear';
}
function labelClass(s) {
  if (s == null) return 'neutral';
  if (s >= 60) return 'greed';
  if (s <= 40) return 'fear';
  return 'neutral';
}