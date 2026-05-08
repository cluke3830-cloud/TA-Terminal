'use client';

import { useEffect, useRef, useState, useMemo } from 'react';

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = Date.now();
  const diffH = (now - d.getTime()) / 3600e3;
  if (diffH < 1) return `${Math.max(1, Math.round(diffH * 60))}m ago`;
  if (diffH < 24) return `${Math.round(diffH)}h ago`;
  return `${Math.round(diffH / 24)}d ago`;
}

function buildSeries(articles) {
  const byDay = {};
  articles.forEach((a) => {
    if (!a.date || !a.sentiment) return;
    const d = a.date.slice(0, 10);
    const s = (a.sentiment.positive || 0) - (a.sentiment.negative || 0);
    (byDay[d] = byDay[d] || []).push(s);
  });
  return Object.entries(byDay)
    .map(([d, arr]) => ({ d, s: arr.reduce((a, b) => a + b, 0) / arr.length }))
    .sort((a, b) => a.d.localeCompare(b.d));
}

function NetSentimentGauge({ score, source }) {
  const clamp = Math.max(-1, Math.min(1, score));
  const pct = ((clamp + 1) / 2) * 100;
  const color = clamp > 0.1 ? '#00f59b' : clamp < -0.1 ? '#ff3355' : '#ffc700';
  const label = clamp > 0.3 ? 'STRONG POS' : clamp > 0.1 ? 'POSITIVE' : clamp > -0.1 ? 'NEUTRAL' : clamp > -0.3 ? 'NEGATIVE' : 'STRONG NEG';
  return (
    <div style={{ padding: '4px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--fog)', letterSpacing: '.7px', textTransform: 'uppercase' }}>Net Sentiment</span>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--fog)', letterSpacing: '.6px' }}>{source === 'finbert' ? 'FinBERT' : 'Lexicon fallback'}</span>
      </div>
      <div style={{ position: 'relative', height: 26, background: 'var(--obsidian)', border: '1px solid var(--carbon)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: '#3a3a4d', zIndex: 1 }} />
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: clamp >= 0 ? '50%' : `${pct}%`, width: clamp >= 0 ? `${pct - 50}%` : `${50 - pct}%`, background: color, opacity: 0.55, transition: 'all .35s ease', minWidth: 2 }} />
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700, color, letterSpacing: '.6px', zIndex: 2, textShadow: '0 0 6px rgba(0,0,0,0.85)' }}>
          {clamp >= 0 ? '+' : ''}{clamp.toFixed(2)} · {label}
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--mono)', fontSize: 8, color: 'var(--fog)', marginTop: 4, letterSpacing: '.5px' }}>
        <span>-1.0 BEAR</span>
        <span>0</span>
        <span>+1.0 BULL</span>
      </div>
    </div>
  );
}

function SentimentChart({ series, symbol, source }) {
  const ref = useRef(null);
  const [plotlyReady, setPlotlyReady] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.Plotly) { setPlotlyReady(true); return; }
    const t = setInterval(() => { if (window.Plotly) { setPlotlyReady(true); clearInterval(t); } }, 150);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!plotlyReady || !ref.current) return;
    if (!series.length) { try { window.Plotly.purge(ref.current); } catch {} return; }
    const x = series.map((p) => p.d);
    const y = series.map((p) => p.s);
    window.Plotly.newPlot(ref.current, [
      {
        x, y,
        type: 'scatter', mode: 'lines+markers',
        line: { color: '#9955ff', width: 2, shape: 'spline' },
        marker: {
          size: 8,
          color: y.map((v) => v > 0.1 ? '#00f59b' : v < -0.1 ? '#ff3355' : '#eab308'),
        },
        hovertemplate: '%{x}<br>Sentiment: %{y:+.2f}<extra></extra>',
      },
      {
        x, y: x.map(() => 0),
        type: 'scatter', mode: 'lines',
        line: { color: 'rgba(255,255,255,0.2)', width: 1, dash: 'dot' },
        hoverinfo: 'skip', showlegend: false,
      },
    ], {
      paper_bgcolor: '#111117', plot_bgcolor: '#111117',
      font: { color: '#a0a0b4', family: 'Geist Mono', size: 10 },
      margin: { l: 46, r: 14, t: 28, b: 36 },
      title: { text: `${symbol} · ${source === 'finbert' ? 'FinBERT' : 'Lexicon'} (positive − negative)`, font: { size: 11, color: '#a0a0b4' } },
      xaxis: { gridcolor: '#282835', tickfont: { size: 9, color: '#7a7a90', family: 'Geist Mono' } },
      yaxis: { title: 'Score', gridcolor: '#282835', zeroline: false, tickfont: { size: 9, color: '#7a7a90', family: 'Geist Mono' } },
      showlegend: false,
    }, { responsive: true, displayModeBar: false });
    return () => { try { window.Plotly?.purge(ref.current); } catch {} };
  }, [plotlyReady, series, symbol, source]);

  return <div ref={ref} style={{ width: '100%', height: 220 }} />;
}

export default function NewsSentimentWidget({ params }) {
  const symbol = (params?.symbol || 'NVDA').toUpperCase();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let cancelled = false;
    setData(null); setErr('');
    fetch(`/data_pages/news?symbol=${symbol}`)
      .then((r) => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
      .then((j) => { if (!cancelled) setData(j); })
      .catch((e) => { if (!cancelled) setErr(String(e)); });
    return () => { cancelled = true; };
  }, [symbol]);

  const series = useMemo(() => buildSeries(data?.articles || []), [data]);

  if (err) return <div className="err">⚠ {err}</div>;
  if (!data) return <div className="loading"><div className="spinner" />Scoring news on AMD MI300X…</div>;

  const articles = data.articles || [];
  const scored = articles.filter((a) => a.sentiment);
  const recent = scored.slice(0, 50);
  const netScore = recent.length
    ? recent.reduce((s, a) => s + ((a.sentiment.positive || 0) - (a.sentiment.negative || 0)), 0) / recent.length
    : 0;
  const top5 = articles.slice(0, 5);
  const usingFinBERT = data.sentimentSource === 'finbert';
  const r7 = data.rolling?.d7 ?? null;
  const r30 = data.rolling?.d30 ?? null;

  return (
    <div style={{ padding: '10px 14px 12px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 700, color: 'var(--cloud)', letterSpacing: '.6px' }}>{symbol}</span>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--fog)', letterSpacing: '.6px' }}>· {scored.length} headlines · 7d/30d rolling</span>
        </div>
        <span className="amd-badge">{usingFinBERT ? 'FinBERT · MI300X' : 'Lexicon Fallback'}</span>
      </div>

      <NetSentimentGauge score={netScore} source={data.sentimentSource} />

      <div style={{ display: 'flex', gap: 18, fontFamily: 'var(--mono)', fontSize: 11, flexWrap: 'wrap', paddingBottom: 2 }}>
        <span>7d rolling: <b style={{ color: r7 == null ? 'var(--fog)' : r7 >= 0 ? '#00f59b' : '#ff3355' }}>{r7 != null ? (r7 >= 0 ? '+' : '') + r7.toFixed(3) : '—'}</b></span>
        <span>30d rolling: <b style={{ color: r30 == null ? 'var(--fog)' : r30 >= 0 ? '#00f59b' : '#ff3355' }}>{r30 != null ? (r30 >= 0 ? '+' : '') + r30.toFixed(3) : '—'}</b></span>
        <span style={{ color: 'var(--fog)' }}>{scored.length} headlines scored</span>
      </div>

      <SentimentChart series={series} symbol={symbol} source={data.sentimentSource} />

      <div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--fog)', letterSpacing: '.7px', textTransform: 'uppercase', marginBottom: 6 }}>Top Headlines</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {top5.length === 0 && <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--fog)' }}>No recent news.</div>}
          {top5.map((n, i) => {
            const s = n.sentiment ? (n.sentiment.positive - n.sentiment.negative) : null;
            const chipColor = s == null ? '#7a7a90' : s > 0.1 ? '#00f59b' : s < -0.1 ? '#ff3355' : '#ffc700';
            return (
              <a key={i} href={n.url} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', background: 'var(--obsidian)', border: '1px solid var(--carbon)', borderRadius: 4, textDecoration: 'none', transition: 'border-color .15s' }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = chipColor; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--carbon)'; }}>
                {s != null && (
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 700, color: chipColor, minWidth: 38, textAlign: 'center', padding: '2px 0', border: `1px solid ${chipColor}40`, background: `${chipColor}14`, borderRadius: 3, letterSpacing: '.3px' }}>
                    {s >= 0 ? '+' : ''}{s.toFixed(2)}
                  </span>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: 'var(--sans)', fontSize: 12, color: 'var(--cloud)', lineHeight: 1.35, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.title}</div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--fog)', marginTop: 2, letterSpacing: '.3px' }}>{n.site || n.source} · {fmtDate(n.date)}</div>
                </div>
              </a>
            );
          })}
        </div>
      </div>

      <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--fog)', letterSpacing: '.5px', textAlign: 'center', borderTop: '1px solid var(--carbon)', paddingTop: 6, marginTop: 2 }}>
        {usingFinBERT ? 'Inference on AMD MI300X via gpu-service · ProsusAI/finbert' : 'GPU droplet offline — using Loughran-McDonald lexicon'}
      </div>
    </div>
  );
}