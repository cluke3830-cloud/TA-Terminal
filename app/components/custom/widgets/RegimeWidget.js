'use client';

import { useEffect, useRef, useState } from 'react';

const REGIME_NAMES = {
  0: 'Calm Trend', 1: 'Volatile Trend', 2: 'Low-Vol Range',
  3: 'High-Vol Churn', 4: 'Correction', 5: 'Crisis',
};
const REGIME_COLORS = {
  0: '#00ff88', 1: '#ff6600', 2: '#66aaff',
  3: '#aaaaaa', 4: '#ffaa33', 5: '#ff0033',
};

function ProbabilityStrip({ probs }) {
  const total = probs.reduce((s, v) => s + v, 0) || 1;
  return (
    <div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--fog)', letterSpacing: '.7px', textTransform: 'uppercase', marginBottom: 5 }}>
        Current Probability Distribution
      </div>
      <div style={{ display: 'flex', height: 26, borderRadius: 4, overflow: 'hidden', border: '1px solid var(--carbon)' }}>
        {probs.map((p, r) => {
          const pct = (p / total) * 100;
          if (pct < 0.5) return null;
          return (
            <div key={r}
              title={`${REGIME_NAMES[r]}: ${(p * 100).toFixed(1)}%`}
              style={{
                width: `${pct}%`,
                background: REGIME_COLORS[r],
                opacity: 0.85,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: 'var(--mono)',
                fontSize: 9,
                fontWeight: 700,
                color: '#050508',
                letterSpacing: '.3px',
                transition: 'opacity .2s, width .35s ease',
              }}>
              {pct >= 12 ? `${pct.toFixed(0)}%` : ''}
            </div>
          );
        })}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4, marginTop: 6 }}>
        {[0, 1, 2, 3, 4, 5].map((r) => (
          <div key={r} style={{ display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--mist)', letterSpacing: '.2px' }}>
            <span style={{ width: 8, height: 8, background: REGIME_COLORS[r], borderRadius: 2, flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{REGIME_NAMES[r]}</span>
            <span style={{ marginLeft: 'auto', color: 'var(--cloud)', fontWeight: 600 }}>{((probs[r] || 0) * 100).toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MiniTimeline({ fig }) {
  const ref = useRef(null);
  const [plotlyReady, setPlotlyReady] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.Plotly) { setPlotlyReady(true); return; }
    const t = setInterval(() => { if (window.Plotly) { setPlotlyReady(true); clearInterval(t); } }, 150);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!plotlyReady || !ref.current || !fig) return;
    const layout = {
      ...(fig.layout || {}),
      margin: { l: 28, r: 6, t: 6, b: 22 },
      height: 130,
      paper_bgcolor: 'transparent',
      plot_bgcolor: 'transparent',
      showlegend: false,
      xaxis: { ...(fig.layout?.xaxis || {}), tickfont: { size: 9, color: '#7a7a90', family: 'Geist Mono' }, gridcolor: 'rgba(255,255,255,0.04)' },
      yaxis: { ...(fig.layout?.yaxis || {}), tickfont: { size: 9, color: '#7a7a90', family: 'Geist Mono' }, gridcolor: 'rgba(255,255,255,0.04)' },
    };
    window.Plotly.react(ref.current, fig.data || [], layout, { displayModeBar: false, responsive: true });
    return () => { try { window.Plotly?.purge(ref.current); } catch {} };
  }, [plotlyReady, fig]);

  return <div ref={ref} style={{ width: '100%', minHeight: 130 }} />;
}

export default function RegimeWidget({ params }) {
  const symbol = (params?.symbol || 'NVDA').toUpperCase();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [offline, setOffline] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let interval = null;
    setData(null); setErr(''); setOffline(false); setElapsed(0);
    const startedAt = Date.now();
    interval = setInterval(() => {
      if (!cancelled) setElapsed((Date.now() - startedAt) / 1000);
    }, 1000);

    fetch(`/data_pages/regime/run?ticker=${symbol}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) {
          if (j?.offline) setOffline(true);
          throw new Error(j?.error || `HTTP ${r.status}`);
        }
        return j;
      })
      .then((j) => { if (!cancelled) setData(j); })
      .catch((e) => { if (!cancelled) setErr(String(e.message || e)); })
      .finally(() => { if (interval) clearInterval(interval); });

    return () => { cancelled = true; if (interval) clearInterval(interval); };
  }, [symbol]);

  if (err && !data) {
    return (
      <div style={{ padding: '14px', fontFamily: 'var(--mono)' }}>
        <div style={{ fontSize: 11, color: '#ff3355', fontWeight: 600, letterSpacing: '.4px', marginBottom: 6 }}>
          {offline ? 'GPU droplet offline' : '⚠ Regime engine error'}
        </div>
        <div style={{ fontSize: 10, color: 'var(--mist)', lineHeight: 1.6 }}>
          {offline ? 'The regime classifier runs on the AMD MI300X droplet. Bring it back online to compute regimes.' : err}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ padding: '20px 14px', fontFamily: 'var(--mono)' }}>
        <div className="loading"><div className="spinner" /> Training HMM + LSTM ensemble for {symbol}…</div>
        <div style={{ fontSize: 9, color: 'var(--fog)', marginTop: 8, letterSpacing: '.4px', lineHeight: 1.6 }}>
          Elapsed {elapsed.toFixed(0)}s · First run on a new ticker takes 2–3 min · Subsequent runs cached &lt;100ms
        </div>
      </div>
    );
  }

  const info = data.info || {};
  const meta = data.meta || {};
  const figs = data.figs || {};
  const cur = info.cur ?? 0;
  const conf = info.conf ?? 0;
  const probs = Array.isArray(info.probs) ? info.probs : [0, 0, 0, 0, 0, 0];
  const name = meta.regimeNames?.[cur] ?? REGIME_NAMES[cur] ?? `Regime ${cur}`;
  const color = meta.regimeColors?.[cur] ?? REGIME_COLORS[cur] ?? '#888';
  const action = meta.regimeActions?.[cur] ?? '';
  const desc = meta.regimeDescriptions?.[cur] ?? '';
  const daysIn = info.days_in ?? 0;
  const lastDate = info.last_date || '';

  const modelTag = ['Rules',
    info.has_hmm && 'HMM',
    info.has_lstm && 'LSTM+Attn',
    info.has_trans && 'TransDet',
  ].filter(Boolean).join(' + ');

  return (
    <div style={{ padding: '12px 14px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 700, color: 'var(--cloud)', letterSpacing: '.6px' }}>{symbol}</span>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--fog)', letterSpacing: '.6px' }}>· {lastDate}</span>
        </div>
        <span className="amd-badge">{modelTag} · MI300X</span>
      </div>

      <div style={{
        padding: '14px 16px',
        background: `linear-gradient(90deg, ${color}18, transparent 70%)`,
        border: `1px solid ${color}40`,
        borderLeft: `3px solid ${color}`,
        borderRadius: 6,
      }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--fog)', letterSpacing: '.8px', textTransform: 'uppercase', marginBottom: 4 }}>
          Current Regime
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 18, fontWeight: 700, color, letterSpacing: '.4px' }}>{name}</span>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--mist)', letterSpacing: '.3px' }}>
            {(conf * 100).toFixed(0)}% conf · day {daysIn}
          </span>
        </div>
        {desc && (
          <div style={{ fontFamily: 'var(--sans)', fontSize: 12, color: 'var(--cloud)', marginTop: 4, lineHeight: 1.5 }}>
            {desc}
          </div>
        )}
      </div>

      <ProbabilityStrip probs={probs} />

      {figs.probs && (
        <div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--fog)', letterSpacing: '.7px', textTransform: 'uppercase', marginBottom: 4 }}>
            Regime Probability Series
          </div>
          <MiniTimeline fig={figs.probs} />
        </div>
      )}

      {action && (
        <div style={{
          fontFamily: 'var(--mono)',
          fontSize: 11,
          color: 'var(--cloud)',
          background: 'var(--obsidian)',
          padding: '8px 12px',
          borderLeft: `2px solid ${color}`,
          borderRadius: 3,
          letterSpacing: '.2px',
          lineHeight: 1.5,
        }}>
          <span style={{ color: 'var(--fog)', fontSize: 9, letterSpacing: '.7px', textTransform: 'uppercase', marginRight: 6 }}>Playbook:</span>
          {action}
        </div>
      )}
    </div>
  );
}