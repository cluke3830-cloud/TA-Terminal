'use client';

import { useEffect, useRef, useState } from 'react';

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = Date.now();
  const diffH = (now - d.getTime()) / 3600e3;
  if (diffH < 1) return `${Math.max(1, Math.round(diffH * 60))}m ago`;
  if (diffH < 24) return `${Math.round(diffH)}h ago`;
  return `${Math.round(diffH / 24)}d ago`;
}

function bucketByDay(articles, days = 7) {
  const buckets = {};
  const cutoff = Date.now() - days * 86400e3;
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400e3);
    const k = d.toISOString().slice(0, 10);
    buckets[k] = { sum: 0, count: 0 };
  }
  for (const a of articles) {
    if (!a.date || !a.sentiment) continue;
    const t = new Date(a.date).getTime();
    if (t < cutoff) continue;
    const k = a.date.slice(0, 10);
    if (!buckets[k]) continue;
    buckets[k].sum += (a.sentiment.positive || 0) - (a.sentiment.negative || 0);
    buckets[k].count += 1;
  }
  return Object.entries(buckets).map(([day, v]) => ({
    day,
    score: v.count ? v.sum / v.count : 0,
    count: v.count,
  }));
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

function SparkChart({ daily }) {
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
    const x = daily.map((d) => d.day);
    const y = daily.map((d) => d.score);
    const colors = y.map((v) => (v > 0.1 ? '#00f59b' : v < -0.1 ? '#ff3355' : '#7a7a90'));
    window.Plotly.newPlot(
      ref.current,
      [{
        x, y,
        type: 'bar',
        marker: { color: colors },
        hovertemplate: '%{x}<br>net: %{y:.2f}<extra></extra>',
      }],
      {
        margin: { l: 28, r: 6, t: 4, b: 22 },
        height: 110,
        paper_bgcolor: 'transparent',
        plot_bgcolor: 'transparent',
        xaxis: { tickfont: { size: 9, color: '#7a7a90', family: 'Geist Mono' }, gridcolor: 'rgba(255,255,255,0.04)', tickformat: '%m/%d' },
        yaxis: { tickfont: { size: 9, color: '#7a7a90', family: 'Geist Mono' }, gridcolor: 'rgba(255,255,255,0.04)', zerolinecolor: '#3a3a4d', range: [-1, 1] },
        showlegend: false,
      },
      { displayModeBar: false, responsive: true }
    );
    return () => { try { window.Plotly?.purge(ref.current); } catch {} };
  }, [plotlyReady, daily]);

  return <div ref={ref} style={{ width: '100%', minHeight: 110 }} />;
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

  if (err) return <div className="err">⚠ {err}</div>;
  if (!data) return <div className="loading"><div className="spinner" />Scoring news on AMD MI300X…</div>;

  const articles = data.articles || [];
  const scored = articles.filter((a) => a.sentiment);
  const recent = scored.slice(0, 50);
  const netScore = recent.length
    ? recent.reduce((s, a) => s + ((a.sentiment.positive || 0) - (a.sentiment.negative || 0)), 0) / recent.length
    : 0;
  const daily = bucketByDay(scored, 7);
  const top5 = articles.slice(0, 5);
  const usingFinBERT = data.sentimentSource === 'finbert';

  return (
    <div style={{ padding: '10px 14px 12px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 700, color: 'var(--cloud)', letterSpacing: '.6px' }}>{symbol}</span>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--fog)', letterSpacing: '.6px' }}>· {scored.length} headlines · 7d</span>
        </div>
        <span className="amd-badge">{usingFinBERT ? 'FinBERT · MI300X' : 'Lexicon Fallback'}</span>
      </div>

      <NetSentimentGauge score={netScore} source={data.sentimentSource} />

      <div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--fog)', letterSpacing: '.7px', textTransform: 'uppercase', marginBottom: 4 }}>7-Day Daily Net Sentiment</div>
        <SparkChart daily={daily} />
      </div>

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