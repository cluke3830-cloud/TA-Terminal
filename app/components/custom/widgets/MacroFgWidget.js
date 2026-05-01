'use client';

import { useEffect, useState } from 'react';

function FearGreedGauge({ score, label, color }) {
  const angle = -90 + (score / 100) * 180;
  const cx = 200, cy = 180, r = 140;
  const arcPath = (a0, a1) => {
    const rad = (a) => ((a - 90) * Math.PI) / 180;
    const x0 = cx + r * Math.cos(rad(a0));
    const y0 = cy + r * Math.sin(rad(a0));
    const x1 = cx + r * Math.cos(rad(a1));
    const y1 = cy + r * Math.sin(rad(a1));
    return `M ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y1}`;
  };
  const zones = [
    { from: 0, to: 36, color: '#ff3355' },
    { from: 36, to: 72, color: '#ff8833' },
    { from: 72, to: 108, color: '#ffc700' },
    { from: 108, to: 144, color: '#00d4ff' },
    { from: 144, to: 180, color: '#00f59b' },
  ];
  return (
    <svg viewBox="0 0 400 230" xmlns="http://www.w3.org/2000/svg">
      {zones.map((z, i) => (
        <path key={i} d={arcPath(z.from, z.to)} fill="none" stroke={z.color} strokeWidth={20} strokeLinecap="butt" opacity="0.9" />
      ))}
      {[0, 25, 50, 75, 100].map((v) => {
        const a = -90 + (v / 100) * 180;
        const rad = ((a - 90) * Math.PI) / 180;
        const x1 = cx + (r - 28) * Math.cos(rad);
        const y1 = cy + (r - 28) * Math.sin(rad);
        const x2 = cx + (r - 14) * Math.cos(rad);
        const y2 = cy + (r - 14) * Math.sin(rad);
        const tx = cx + (r - 44) * Math.cos(rad);
        const ty = cy + (r - 44) * Math.sin(rad);
        return (
          <g key={v}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#3a3a4d" strokeWidth={1} />
            <text x={tx} y={ty + 3} fontFamily="Geist Mono" fontSize="9" fill="#7a7a90" textAnchor="middle">{v}</text>
          </g>
        );
      })}
      <g transform={`rotate(${angle} ${cx} ${cy})`}>
        <line x1={cx} y1={cy} x2={cx} y2={cy - r + 32} stroke={color} strokeWidth={3} strokeLinecap="round" />
        <circle cx={cx} cy={cy} r={9} fill={color} />
        <circle cx={cx} cy={cy} r={4} fill="#050508" />
      </g>
      <text x={cx} y={cy + 35} fontFamily="Geist Mono" fontSize="42" fontWeight="700" fill={color} textAnchor="middle">{Math.round(score)}</text>
      <text x={cx} y={cy + 60} fontFamily="Geist Mono" fontSize="12" fontWeight="600" fill="#cccce0" textAnchor="middle" letterSpacing="3">{label}</text>
    </svg>
  );
}

export default function MacroFgWidget() {
  const [fg, setFg] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch('/data_pages/macro/feargreed')
      .then((r) => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
      .then((j) => { if (!cancelled) setFg(j); })
      .catch((e) => { if (!cancelled) setErr(String(e)); });
    return () => { cancelled = true; };
  }, []);

  if (err) return <div className="err">⚠ {err}</div>;
  if (!fg) return <div className="loading"><div className="spinner" />Computing macro composite…</div>;

  return (
    <div style={{ padding: '8px 14px 14px' }}>
      <div className="fg-wrap">
        <div className="fg-gauge">
          <FearGreedGauge score={fg.score} label={fg.label} color={fg.color} />
        </div>
        <div className="fg-cmp">
          {(fg.components || []).map((c) => {
            const barColor = c.score < 40 ? '#ff3355' : c.score > 60 ? '#00f59b' : '#ffc700';
            return (
              <div key={c.name} className="fg-row">
                <div>
                  <div className="fg-row-n">{c.name}</div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--smoke)', marginTop: 2 }}>{c.desc}</div>
                </div>
                <div className="fg-row-bar"><div className="fg-row-bar-f" style={{ width: c.score + '%', background: barColor }} /></div>
                <div className="fg-row-s" style={{ color: barColor }}>{c.score.toFixed(0)}</div>
                <div className="fg-row-w">W: {(c.weight * 100).toFixed(0)}%</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}