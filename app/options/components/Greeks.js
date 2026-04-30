'use client';
import { useState, useMemo } from 'react';

const fmt = (n, d = 4) => (n == null || isNaN(n) ? '—' : n.toFixed(d));
const fmt2 = (n) => fmt(n, 2);

export default function Greeks({ data }) {
  const [typeFilter, setTypeFilter] = useState('C');
  const [expFilter, setExpFilter] = useState('all');

  const expiries = useMemo(() => {
    if (!data?.rows) return [];
    return [...new Set(data.rows.map((r) => r.exp))].sort();
  }, [data]);

  const filtered = useMemo(() => {
    if (!data?.rows) return [];
    return data.rows
      .filter((r) => r.type === typeFilter)
      .filter((r) => expFilter === 'all' || r.exp === expFilter)
      .sort((a, b) => a.dte - b.dte || a.strike - b.strike);
  }, [data, typeFilter, expFilter]);

  if (!data?.rows?.length) return <div className="loading" style={{ padding: 24 }}>No Greeks data — load options chain first</div>;

  return (
    <div className="card-b">
      <div className="tabs" style={{ marginBottom: 10 }}>
        <button className={`tf ${typeFilter === 'C' ? 'a' : ''}`} onClick={() => setTypeFilter('C')}>Calls</button>
        <button className={`tf ${typeFilter === 'P' ? 'a' : ''}`} onClick={() => setTypeFilter('P')}>Puts</button>
        <span className="cb-sep">|</span>
        <select
          className="tf"
          value={expFilter}
          onChange={(e) => setExpFilter(e.target.value)}
          style={{ background: '#18181f', color: '#a0a0b4', border: '1px solid #282835', padding: '4px 8px' }}
        >
          <option value="all">All expiries</option>
          {expiries.map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
        <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--ash)' }}>Spot ${data.spot?.toFixed(2)} · r {(data.r * 100).toFixed(1)}% · ATM rows highlighted</span>
      </div>
      <div style={{ maxHeight: 420, overflowY: 'auto' }}>
        <table className="dt">
          <thead>
            <tr>
              <th>Exp</th>
              <th>DTE</th>
              <th>Strike</th>
              <th>IV (%)</th>
              <th>Δ Delta</th>
              <th>Γ Gamma</th>
              <th>ν Vega</th>
              <th>Θ Theta</th>
              <th>ρ Rho</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => (
              <tr
                key={`${r.exp}-${r.strike}-${r.type}-${i}`}
                style={r.atm ? { background: 'rgba(0,212,255,0.08)', fontWeight: 600 } : (r.synthetic ? { fontStyle: 'italic', opacity: 0.7 } : {})}
              >
                <td>{r.exp}</td>
                <td>{r.dte}</td>
                <td className="vc">${r.strike}</td>
                <td>{fmt2(r.iv)}</td>
                <td className={r.delta >= 0 ? 'vg' : 'vr'}>{fmt(r.delta)}</td>
                <td>{fmt(r.gamma, 5)}</td>
                <td className="vc">{fmt(r.vega)}</td>
                <td className="vr">{fmt(r.theta)}</td>
                <td>{fmt(r.rho)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}