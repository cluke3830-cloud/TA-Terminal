'use client';
import { useEffect, useState } from 'react';

const fmtNum = (n) => {
  if (n == null || !isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toFixed(0);
};
const fmtPct = (n, d = 2) => (n == null || !isFinite(n)) ? '—' : (n * 100).toFixed(d) + '%';
const fmt1 = (n) => (n == null || !isFinite(n)) ? '—' : n.toFixed(1);

function PriceOverlay({ prices, siPct }) {
  if (!prices?.length) return null;

  const W = 600, H = 130;
  const pl = 44, pr = 10, pt = 12, pb = 22;
  const plotW = W - pl - pr;
  const plotH = H - pt - pb;

  const closes = prices.map((p) => p.close);
  const minP = Math.min(...closes);
  const maxP = Math.max(...closes);
  const rng = maxP - minP || 1;
  const midP = (minP + maxP) / 2;

  const toX = (i) => pl + (i / Math.max(1, prices.length - 1)) * plotW;
  const toY = (v) => pt + plotH - ((v - minP) / rng) * plotH;

  const polyPts = prices.map((p, i) => `${toX(i).toFixed(1)},${toY(p.close).toFixed(1)}`).join(' ');
  const fillPts = [
    `${toX(0).toFixed(1)},${H - pb}`,
    ...prices.map((p, i) => `${toX(i).toFixed(1)},${toY(p.close).toFixed(1)}`),
    `${toX(prices.length - 1).toFixed(1)},${H - pb}`,
  ].join(' ');

  const lineColor = siPct > 0.10 ? '#ff3355' : siPct > 0.05 ? '#ffc700' : '#00d4ff';
  const fillColor = siPct > 0.10 ? 'rgba(255,51,85,0.10)' : siPct > 0.05 ? 'rgba(255,199,0,0.10)' : 'rgba(0,212,255,0.10)';

  const last = closes[closes.length - 1];
  const first = closes[0];
  const chg = (last - first) / first;

  const fmtPx = (v) => v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v >= 100 ? v.toFixed(0) : v.toFixed(2);
  const tickIdx = [0, Math.floor((prices.length - 1) / 3), Math.floor(2 * (prices.length - 1) / 3), prices.length - 1];

  return (
    <div style={{ marginBottom: 14 }}>
      <div className="sl" style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>90d Price</span>
        <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: chg >= 0 ? 'var(--neon-green)' : 'var(--neon-red)' }}>
          ${last.toFixed(2)}&nbsp;
          <span style={{ color: 'var(--ash)' }}>{chg >= 0 ? '+' : ''}{(chg * 100).toFixed(1)}% vs 90d ago</span>
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: H, display: 'block' }} preserveAspectRatio="none">
        {/* Horizontal gridlines at min / mid / max */}
        <line x1={pl} y1={toY(maxP)} x2={W - pr} y2={toY(maxP)} stroke="#23232c" strokeDasharray="2,3" />
        <line x1={pl} y1={toY(midP)} x2={W - pr} y2={toY(midP)} stroke="#1d1d24" strokeDasharray="2,3" />
        <line x1={pl} y1={toY(minP)} x2={W - pr} y2={toY(minP)} stroke="#23232c" strokeDasharray="2,3" />
        <polygon points={fillPts} fill={fillColor} />
        <polyline points={polyPts} fill="none" stroke={lineColor} strokeWidth="2" />
        {/* Last price marker dot */}
        <circle cx={toX(prices.length - 1)} cy={toY(last)} r="3" fill={lineColor} stroke="#0a0a0e" strokeWidth="1.5" />
        {/* Y-axis price labels (3 ticks) */}
        <text x={pl - 4} y={toY(maxP) + 3} textAnchor="end" fill="#7a7a90" fontSize="9" fontFamily="Geist Mono">{fmtPx(maxP)}</text>
        <text x={pl - 4} y={toY(midP) + 3} textAnchor="end" fill="#5a5a70" fontSize="9" fontFamily="Geist Mono">{fmtPx(midP)}</text>
        <text x={pl - 4} y={toY(minP) + 3} textAnchor="end" fill="#7a7a90" fontSize="9" fontFamily="Geist Mono">{fmtPx(minP)}</text>
        {/* X-axis date labels (4 ticks) */}
        {tickIdx.map((idx, k) => (
          <text key={k}
            x={toX(idx)}
            y={H - 6}
            textAnchor={k === 0 ? 'start' : k === tickIdx.length - 1 ? 'end' : 'middle'}
            fill="#7a7a90" fontSize="9" fontFamily="Geist Mono">
            {prices[idx]?.date?.slice(5)}
          </text>
        ))}
      </svg>
    </div>
  );
}

export default function ShortInterestCard({ symbol }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    setLoading(true); setErr(null); setData(null);
    fetch(`/data_pages/short-interest?symbol=${encodeURIComponent(symbol)}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) { if (d.error) setErr(d.error); else setData(d); } })
      .catch((e) => !cancelled && setErr(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [symbol]);

  const c = data?.current || {};
  const hasHistory = data?.history?.length >= 2;
  const sq = c.squeezeScore;
  const sqColor = sq == null ? 'vc' : sq >= 70 ? 'vr' : sq >= 50 ? 'vy' : sq >= 30 ? 'vc' : 'vg';
  const sqLabel = sq == null ? '—' : sq >= 70 ? 'EXTREME' : sq >= 50 ? 'HIGH' : sq >= 30 ? 'MODERATE' : 'LOW';

  // Stale badge: asOf older than 14 days
  const isStale = c.asOf
    ? (Date.now() - new Date(c.asOf).getTime()) > 14 * 24 * 60 * 60 * 1000
    : false;

  const sparkSeries = (data?.history || []).slice(-12);

  return (
    <div className="card">
      <div className="card-h">
        <span className="card-t">Short Interest · {symbol}</span>
        <span className="badge b-p">{(data?.source || 'yahoo').toUpperCase()}</span>
        {isStale && (
          <span className="badge" style={{ background: 'rgba(255,140,0,0.15)', color: '#ff8c00', border: '1px solid rgba(255,140,0,0.3)', marginLeft: 6 }}
            title={`Last report: ${c.asOf} — FINRA data may lag up to 30 days`}>
            STALE
          </span>
        )}
      </div>
      <div className="card-b">
        {loading && <div className="loading"><div className="spinner" />Loading short interest…</div>}
        {err && <div className="err">⚠ {err}</div>}

        {!loading && !err && data && (
          <>
            {/* Headline metrics */}
            <div className="rg" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 14 }}>
              <div className="rb">
                <div className="rb-l">% of Float</div>
                <div className={`rb-v ${(c.pctOfFloat || 0) > 0.10 ? 'vr' : (c.pctOfFloat || 0) > 0.05 ? 'vy' : 'vc'}`}>
                  {fmtPct(c.pctOfFloat)}
                </div>
              </div>
              <div className="rb">
                <div className="rb-l">Days to Cover</div>
                <div className={`rb-v ${(c.daysToCover || 0) > 5 ? 'vr' : (c.daysToCover || 0) > 2 ? 'vy' : 'vc'}`}>
                  {fmt1(c.daysToCover)}
                </div>
              </div>
              <div className="rb">
                <div className="rb-l">Shares Short</div>
                <div className="rb-v vp">{fmtNum(c.sharesShort)}</div>
              </div>
              <div className="rb" title="Heuristic only — not a signal. Formula: 40pts from %Float (capped at 10%), 40pts from Days-to-Cover (capped at 5d), 20pts from MoM trend. Compare relative to itself over time, not across stocks.">
                <div className="rb-l">Squeeze Score ⓘ</div>
                <div className={`rb-v ${sqColor}`}>{sq != null ? `${sq.toFixed(0)} / 100 · ${sqLabel}` : '—'}</div>
              </div>
            </div>

            {/* Trend strip */}
            {c.shortInterestChange != null && (
              <div style={{ marginBottom: 14, fontSize: 11, fontFamily: 'var(--mono)', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <span>
                  vs prior: <b className={c.shortInterestChange >= 0 ? 'vr' : 'vg'}>
                    {c.shortInterestChange >= 0 ? '+' : ''}{fmtNum(c.shortInterestChange)} shares ({c.shortInterestChangePct >= 0 ? '+' : ''}{fmtPct(c.shortInterestChangePct, 1)})
                  </b>
                </span>
                <span style={{ color: 'var(--ash)' }}>
                  Float: {fmtNum(c.floatShares)} · Avg vol 10d: {fmtNum(c.avgVol10d)}
                </span>
              </div>
            )}

            {/* 90d price overlay */}
            <PriceOverlay prices={data.prices} siPct={c.pctOfFloat || 0} />

            {/* History sparkline (% of float, biweekly) */}
            {hasHistory && (
              <div style={{ marginBottom: 12 }}>
                <div className="sl">% of Float · last {sparkSeries.length} bi-weekly reports</div>
                <div className="rvb" style={{ height: 70 }}>
                  {sparkSeries.map((h, i) => {
                    const max = Math.max(...sparkSeries.map((s) => s.pctOfFloat || 0));
                    const pct = max > 0 ? ((h.pctOfFloat || 0) / max) : 0;
                    const tone = (h.pctOfFloat || 0) > 0.10 ? 'rgba(255,51,85,.7)' : (h.pctOfFloat || 0) > 0.05 ? 'rgba(255,199,0,.7)' : 'rgba(0,212,255,.6)';
                    return (
                      <div key={i} className="rvb-c" title={`${h.date}: ${fmtPct(h.pctOfFloat)}`}>
                        <div className="rvb-bar" style={{ height: `${Math.max(pct * 56, 2)}px`, background: tone }} />
                        <div className="rvb-l" style={{ fontSize: 7 }}>{h.date?.slice(2, 7).replace('-', '/') || ''}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Recent biweekly table */}
            {hasHistory && (
              <table className="dt">
                <thead>
                  <tr><th>Date</th><th>Short Int</th><th>% Float</th><th>DTC</th><th>Avg Vol</th></tr>
                </thead>
                <tbody>
                  {[...data.history].slice(-6).reverse().map((h, i) => (
                    <tr key={i}>
                      <td>{h.date?.slice(0, 10) || '—'}</td>
                      <td>{fmtNum(h.shortInterest)}</td>
                      <td className={(h.pctOfFloat || 0) > 0.10 ? 'vr' : (h.pctOfFloat || 0) > 0.05 ? 'vy' : 'vc'}>{fmtPct(h.pctOfFloat)}</td>
                      <td>{fmt1(h.daysToCover)}</td>
                      <td style={{ color: 'var(--smoke)' }}>{fmtNum(h.avgVolume)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div style={{ fontSize: 9, color: 'var(--ash)', fontFamily: 'var(--mono)', marginTop: 10, lineHeight: 1.7 }}>
              Snapshot {c.asOf?.slice(0, 10) || '—'} · Source: Yahoo Finance (FINRA bi-weekly) ·
              DTC = Short Interest ÷ Avg Daily Vol · Squeeze score is a heuristic (40pts %float + 40pts DTC + 20pts trend) — not a trading signal
            </div>
          </>
        )}
      </div>
    </div>
  );
}
