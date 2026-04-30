'use client';
import { useState, useEffect, useRef, useMemo } from 'react';

const Load = ({ t = 'Loading...' }) => <div className="loading"><div className="spinner" />{t}</div>;
const Err = ({ m }) => <div className="err">⚠ {m}</div>;

export default function SentimentRolling({ sym, plotlyReady }) {
  const ref = useRef(null);
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setErr(null);
    fetch(`/data_pages/news?symbol=${sym}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) { if (d.error) setErr(d.error); else setData(d); } })
      .catch((e) => !cancelled && setErr(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [sym]);

  // Build per-day mean sentiment from articles.
  const series = useMemo(() => {
    if (!data?.articles?.length) return [];
    const byDay = {};
    data.articles.forEach((a) => {
      if (!a.date || !a.sentiment) return;
      const d = a.date.slice(0, 10);
      const s = a.sentiment.positive - a.sentiment.negative;
      (byDay[d] = byDay[d] || []).push(s);
    });
    return Object.entries(byDay)
      .map(([d, arr]) => ({ d, s: arr.reduce((a, b) => a + b, 0) / arr.length }))
      .sort((a, b) => a.d.localeCompare(b.d));
  }, [data]);

  useEffect(() => {
    if (!plotlyReady || !ref.current) return;
    if (!series.length) {
      window.Plotly.purge(ref.current);
      return;
    }
    window.Plotly.newPlot(ref.current, [{
      x: series.map((p) => p.d),
      y: series.map((p) => p.s),
      type: 'scatter', mode: 'lines+markers',
      line: { color: '#9955ff', width: 2, shape: 'spline' },
      marker: {
        size: 8,
        color: series.map((p) => p.s > 0.1 ? '#00f59b' : p.s < -0.1 ? '#ff3355' : '#eab308'),
      },
      hovertemplate: '%{x}<br>Sentiment: %{y:+.2f}<extra></extra>',
    }, {
      x: series.map((p) => p.d), y: series.map(() => 0),
      type: 'scatter', mode: 'lines',
      line: { color: 'rgba(255,255,255,0.2)', width: 1, dash: 'dot' },
      hoverinfo: 'skip', showlegend: false,
    }], {
      paper_bgcolor: '#111117', plot_bgcolor: '#111117',
      font: { color: '#a0a0b4', family: 'Geist Mono', size: 10 },
      margin: { l: 50, r: 20, t: 32, b: 40 },
      title: { text: `${sym} News Sentiment · FinBERT (positive − negative)`, font: { size: 12, color: '#a0a0b4' } },
      xaxis: { gridcolor: '#282835' },
      yaxis: { title: 'Sentiment score', gridcolor: '#282835', zeroline: false },
      showlegend: false,
    }, { responsive: true, displayModeBar: false });
  }, [series, plotlyReady, sym]);

  if (loading) return <Load t={`Scoring ${sym} headlines on FinBERT…`} />;
  if (err) return <Err m={err} />;
  if (!data?.sentimentAvailable) {
    return (
      <div className="card-b">
        <div className="loading" style={{ padding: 24, flexDirection: 'column', gap: 6 }}>
          FinBERT offline · headlines fetched but unscored
          <span style={{ fontSize: 10, color: 'var(--ash)' }}>
            Set MC_GPU_URL on a box running gpu-service with transformers installed.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="card-b">
      <div style={{ padding: '0 14px 8px', display: 'flex', gap: 18, fontSize: 11, fontFamily: 'var(--mono)', flexWrap: 'wrap' }}>
        <span>7d rolling: <b className={(data.rolling?.d7 ?? 0) >= 0 ? 'vg' : 'vr'}>{data.rolling?.d7?.toFixed(3) ?? '—'}</b></span>
        <span>30d rolling: <b className={(data.rolling?.d30 ?? 0) >= 0 ? 'vg' : 'vr'}>{data.rolling?.d30?.toFixed(3) ?? '—'}</b></span>
        <span style={{ color: 'var(--ash)' }}>{data.articles?.length || 0} headlines scored</span>
      </div>
      <div ref={ref} style={{ height: 280 }} />
      {data.articles?.length > 0 && (
        <div style={{ padding: '8px 14px 12px' }}>
          <div className="sl">Recent scored headlines</div>
          {data.articles.slice(0, 6).map((a, i) => {
            const s = a.sentiment ? (a.sentiment.positive - a.sentiment.negative) : null;
            const cls = s == null ? '' : (s > 0.1 ? 'vg' : s < -0.1 ? 'vr' : 'vy');
            return (
              <div key={i} className="ni" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <span className={`badge ${s > 0.1 ? 'b-g' : s < -0.1 ? 'b-p' : 'b-c'}`} style={{ minWidth: 60, textAlign: 'center' }}>
                  {a.sentiment?.label?.toUpperCase() || '—'}
                </span>
                <a href={a.url} target="_blank" rel="noopener noreferrer" className="nl" style={{ flex: 1 }}>{a.title}</a>
                <span className={`nm ${cls}`} style={{ fontFamily: 'var(--mono)' }}>{s != null ? `${s >= 0 ? '+' : ''}${s.toFixed(2)}` : '—'}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}