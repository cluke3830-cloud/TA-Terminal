'use client';
import { useState, useEffect } from 'react';

const Load = ({ t = 'Loading...' }) => <div className="loading"><div className="spinner" />{t}</div>;
const Err = ({ m }) => <div className="err">⚠ {m}</div>;

export default function SentimentHeatmap() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/data_pages/sentiment/sectors')
      .then((r) => r.json())
      .then((d) => { if (!cancelled) { if (d.error) setErr(d.error); else setData(d); } })
      .catch((e) => !cancelled && setErr(e.message));
    return () => { cancelled = true; };
  }, []);

  if (err) return <Err m={err} />;
  if (!data) return <Load t="Scoring sector headlines on FinBERT…" />;

  if (!data.sentimentAvailable) {
    return (
      <div className="loading" style={{ padding: 24, flexDirection: 'column', gap: 6 }}>
        FinBERT offline · headlines fetched but unscored
        <span style={{ fontSize: 10, color: 'var(--ash)' }}>
          Set MC_GPU_URL on a box running gpu-service with transformers installed.
        </span>
      </div>
    );
  }

  return (
    <div style={{ padding: '0 14px 14px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
        {data.sectors.map((s) => (
          <div
            key={s.name}
            style={{
              background: s.color,
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: 'var(--rs)',
              padding: '12px 14px',
              fontFamily: 'var(--mono)',
              minHeight: 70,
              display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
            }}
            title={`${s.n} headlines scored`}
          >
            <div style={{ fontSize: 11, color: '#cfcfdc', fontWeight: 600 }}>{s.name}</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ fontSize: 18, fontWeight: 700, color: '#ffffff' }}>
                {s.score == null ? '—' : `${s.score >= 0 ? '+' : ''}${s.score.toFixed(2)}`}
              </span>
              <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.6)' }}>n={s.n}</span>
            </div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 10, fontSize: 10, color: 'var(--ash)', fontFamily: 'var(--mono)' }}>
        Score = mean(positive − negative) per sector across bellwether headlines · &gt;+0.1 green, &lt;−0.1 red, else neutral
      </div>
    </div>
  );
}