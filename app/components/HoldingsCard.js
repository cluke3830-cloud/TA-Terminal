'use client';
import { useEffect, useState } from 'react';

const fmtNum = (n) => {
  if (n == null || !isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e12) return (n / 1e12).toFixed(2) + 'T';
  if (a >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toFixed(0);
};
const fmtUSD = (n) => (n == null || !isFinite(n)) ? '—' : (n < 0 ? '-$' : '$') + fmtNum(Math.abs(n));
const fmtPct = (n, d = 1) => (n == null || !isFinite(n)) ? '—' : (n * 100).toFixed(d) + '%';

export default function HoldingsCard({ symbol }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    setLoading(true); setErr(null); setData(null);
    fetch(`/data_pages/holdings?symbol=${encodeURIComponent(symbol)}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) { if (d.error) setErr(d.error); else setData(d); } })
      .catch((e) => !cancelled && setErr(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [symbol]);

  const s = data?.summary || {};
  const history = data?.history || [];
  // FMP returns ownershipPercent on a 0-100 scale, but our fmtPct expects
  // 0..1, so divide.
  const ownPct = s.ownershipPercent != null ? s.ownershipPercent / 100 : null;
  const ownPctChg = s.ownershipPercentChange != null ? s.ownershipPercentChange / 100 : null;
  const flow = s.flowScore;
  const flowLabel = flow == null ? '—' : flow > 0.2 ? 'BULLISH' : flow < -0.2 ? 'BEARISH' : 'NEUTRAL';
  const flowColor = flow == null ? 'vc' : flow > 0.2 ? 'vg' : flow < -0.2 ? 'vr' : 'vy';

  return (
    <div className="card">
      <div className="card-h">
        <span className="card-t">13F Institutional Flow · {symbol}</span>
        <span className="badge b-c">{(data?.source || 'fmp').toUpperCase()}</span>
      </div>
      <div className="card-b">
        {loading && <div className="loading"><div className="spinner" />Loading 13F summaries…</div>}
        {err && <div className="err">⚠ {err}</div>}

        {!loading && !err && data && history.length === 0 && (
          <div className="loading" style={{ padding: 16 }}>No 13F summary available for {symbol}.</div>
        )}

        {!loading && !err && history.length > 0 && (
          <>
            <div className="rg" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 14 }}>
              <div className="rb">
                <div className="rb-l">Inst. Ownership</div>
                <div className="rb-v vc">{fmtPct(ownPct)}
                  {ownPctChg != null && (
                    <span style={{ fontSize: 10, marginLeft: 6 }} className={ownPctChg >= 0 ? 'vg' : 'vr'}>
                      {ownPctChg >= 0 ? '+' : ''}{(ownPctChg * 100).toFixed(2)}pp
                    </span>
                  )}
                </div>
              </div>
              <div className="rb">
                <div className="rb-l">Holders</div>
                <div className="rb-v">{s.investorsHolding ?? '—'}
                  {s.investorsHoldingChange != null && (
                    <span style={{ fontSize: 10, marginLeft: 6 }} className={s.investorsHoldingChange >= 0 ? 'vg' : 'vr'}>
                      {s.investorsHoldingChange >= 0 ? '+' : ''}{s.investorsHoldingChange}
                    </span>
                  )}
                </div>
              </div>
              <div className="rb">
                <div className="rb-l">Capital Invested</div>
                <div className="rb-v vp">{fmtUSD(s.totalInvested)}</div>
              </div>
              <div className="rb">
                <div className="rb-l">Flow Score</div>
                <div className={`rb-v ${flowColor}`}>{flow != null ? `${(flow * 100).toFixed(0)} · ${flowLabel}` : '—'}</div>
              </div>
            </div>

            {/* QoQ flow */}
            <div style={{ marginBottom: 14 }}>
              <div className="sl" style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Quarterly Position Flow</span>
                <span style={{ color: 'var(--ash)' }}>As of {s.asOf?.slice(0, 10) || '—'}</span>
              </div>
              <div style={{ display: 'flex', gap: 6, fontSize: 11, fontFamily: 'var(--mono)', flexWrap: 'wrap' }}>
                <Pill cls="vg" label={`▲ New ${s.newPositions ?? 0}`} />
                <Pill cls="vg" label={`↑ Added ${s.increasedPositions ?? 0}`} />
                <Pill cls="vr" label={`↓ Reduced ${s.reducedPositions ?? 0}`} />
                <Pill cls="vr" label={`▼ Closed ${s.closedPositions ?? 0}`} />
                {s.putCallRatio != null && <Pill cls="vc" label={`P/C Ratio ${s.putCallRatio.toFixed(2)}`} />}
              </div>
              {/* Adds/cuts ratio bar */}
              {(s.newPositions != null && s.closedPositions != null) && (() => {
                const adds = (s.newPositions || 0) + (s.increasedPositions || 0);
                const cuts = (s.closedPositions || 0) + (s.reducedPositions || 0);
                const total = adds + cuts;
                const addPct = total > 0 ? 100 * adds / total : 50;
                return (
                  <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', background: 'var(--obsidian)', marginTop: 8 }}>
                    <div style={{ width: `${addPct}%`, background: 'var(--neon-green)' }} />
                    <div style={{ flex: 1, background: 'var(--neon-red)' }} />
                  </div>
                );
              })()}
            </div>

            {/* Quarterly history table */}
            <table className="dt">
              <thead>
                <tr>
                  <th>Quarter</th>
                  <th>Holders</th>
                  <th>Δ Holders</th>
                  <th>Capital</th>
                  <th title="Quarter-over-quarter change in 13F-reported share count — pure position change, not mark-to-market price effect">Δ Shares %</th>
                  <th>Inst. Own</th>
                </tr>
              </thead>
              <tbody>
                {[...history].reverse().slice(0, 5).map((h, i) => {
                  const prior13F = h.numberOf13Fshares != null && h.numberOf13FsharesChange != null
                    ? h.numberOf13Fshares - h.numberOf13FsharesChange : null;
                  const pctShares = prior13F != null && prior13F > 0
                    ? h.numberOf13FsharesChange / prior13F : null;
                  return (
                    <tr key={i}>
                      <td><b>{h.date?.slice(0, 7) || '—'}</b></td>
                      <td>{h.investorsHolding ?? '—'}</td>
                      <td className={(h.investorsHoldingChange || 0) >= 0 ? 'vg' : 'vr'}>
                        {h.investorsHoldingChange != null ? (h.investorsHoldingChange > 0 ? '+' : '') + h.investorsHoldingChange : '—'}
                      </td>
                      <td className="vc">{fmtUSD(h.totalInvested)}</td>
                      <td className={(pctShares || 0) >= 0 ? 'vg' : 'vr'}>{pctShares != null ? `${pctShares >= 0 ? '+' : ''}${(pctShares * 100).toFixed(1)}%` : '—'}</td>
                      <td className="vp">{h.ownershipPercent != null ? h.ownershipPercent.toFixed(2) + '%' : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div style={{ fontSize: 9, color: 'var(--ash)', fontFamily: 'var(--mono)', marginTop: 10, lineHeight: 1.7 }}>
              Source: SEC 13F via FMP · Flow score = (adds − cuts) ÷ (adds + cuts) · pp = percentage points
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Pill({ label, cls }) {
  return (
    <span style={{ padding: '4px 10px', borderRadius: 4, background: 'var(--obsidian)', border: '1px solid var(--border)' }} className={cls}>
      {label}
    </span>
  );
}
