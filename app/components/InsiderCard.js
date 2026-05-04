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
const fmtUSD = (n) => (n == null || !isFinite(n)) ? '—' : (n < 0 ? '-$' : '$') + fmtNum(Math.abs(n));

export default function InsiderCard({ symbol }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState(90);
  const [tab, setTab] = useState('insiders'); // 'insiders' | 'transactions'

  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    setLoading(true); setErr(null); setData(null);
    fetch(`/data_pages/insider?symbol=${encodeURIComponent(symbol)}&days=${days}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) { if (d.error) setErr(d.error); else setData(d); } })
      .catch((e) => !cancelled && setErr(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [symbol, days]);

  const s = data?.summary;
  const net = s?.netUSD ?? 0;
  const isNetBuy = net > 0;

  return (
    <div className="card">
      <div className="card-h">
        <span className="card-t">Insider Transactions · {symbol}</span>
        <span className={`badge ${data?.source === 'edgar' ? 'b-p' : 'b-c'}`}>{(data?.source || 'fmp').toUpperCase()}</span>
      </div>
      <div className="card-b">
        <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
          {[30, 90, 180, 365].map((d) => (
            <button key={d} className={`tf ${days === d ? 'a' : ''}`} onClick={() => setDays(d)}>{d}d</button>
          ))}
        </div>

        {loading && <div className="loading"><div className="spinner" />Loading insider filings…</div>}
        {err && <div className="err">⚠ {err}</div>}

        {!loading && !err && data && (
          <>
            {/* Summary strip */}
            <div className="rg" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 14 }}>
              <div className="rb">
                <div className="rb-l">Net {days}d</div>
                <div className={`rb-v ${isNetBuy ? 'vg' : 'vr'}`}>{fmtUSD(net)}</div>
              </div>
              <div className="rb">
                <div className="rb-l">Buys</div>
                <div className="rb-v vg">{s?.counts?.buy ?? 0}</div>
              </div>
              <div className="rb">
                <div className="rb-l">Sells</div>
                <div className="rb-v vr">{s?.counts?.sell ?? 0}</div>
              </div>
              <div className="rb">
                <div className="rb-l">Insiders</div>
                <div className="rb-v vc">{s?.uniqueInsiders ?? 0}</div>
              </div>
            </div>

            {/* B/S ratio bar */}
            {(s?.buyUSD > 0 || s?.sellUSD > 0) && (
              <div style={{ marginBottom: 14 }}>
                <div className="sl" style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Buy/Sell Pressure</span>
                  <span style={{ color: 'var(--ash)' }}>{fmtUSD(s.buyUSD)} buys · {fmtUSD(s.sellUSD)} sells</span>
                </div>
                <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', background: 'var(--obsidian)' }}>
                  <div style={{ width: `${100 * s.buyUSD / Math.max(1, s.buyUSD + s.sellUSD)}%`, background: 'var(--neon-green)' }} />
                  <div style={{ flex: 1, background: 'var(--neon-red)' }} />
                </div>
              </div>
            )}

            <div className="tabs">
              <button className={`tab ${tab === 'insiders' ? 'a' : ''}`} onClick={() => setTab('insiders')}>By Insider</button>
              <button className={`tab ${tab === 'transactions' ? 'a' : ''}`} onClick={() => setTab('transactions')}>Transactions</button>
            </div>

            {tab === 'insiders' && (
              s?.aggregateByInsider?.filter((a) => (a.buys || 0) + (a.sells || 0) > 0).length ? (
                <table className="dt">
                  <thead><tr><th>Insider</th><th>Title</th><th>Buys</th><th>Sells</th><th>Net Shares</th><th>Net USD</th></tr></thead>
                  <tbody>
                    {s.aggregateByInsider.filter((a) => (a.buys || 0) + (a.sells || 0) > 0).map((a, i) => (
                      <tr key={i}>
                        <td><b>{a.name}</b></td>
                        <td style={{ fontSize: 10, color: 'var(--smoke)' }}>{a.title || '—'}</td>
                        <td className="vg">{a.buys || ''}</td>
                        <td className="vr">{a.sells || ''}</td>
                        <td className={a.netShares >= 0 ? 'vg' : 'vr'}>{fmtNum(a.netShares)}</td>
                        <td className={a.netUSD >= 0 ? 'vg' : 'vr'}>{fmtUSD(a.netUSD)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <div className="loading" style={{ padding: 12 }}>No aggregate data — values may not be parseable from EDGAR-only feed.</div>
            )}

            {tab === 'transactions' && (
              data.transactions?.length ? (
                <table className="dt">
                  <thead><tr><th>Date</th><th>Insider</th><th>Type</th><th>Shares</th><th>Price</th><th>Value</th></tr></thead>
                  <tbody>
                    {data.transactions.slice(0, 30).map((t, i) => (
                      <tr key={i}>
                        <td>{t.date}</td>
                        <td>
                          {t.link ? <a href={t.link} target="_blank" rel="noopener noreferrer" className="nl" style={{ display: 'inline' }}>{t.insider}</a> : t.insider}
                          {t.title && <div style={{ fontSize: 9, color: 'var(--ash)' }}>{t.title}</div>}
                        </td>
                        <td><span className={`badge ${t.type === 'BUY' ? 'b-g' : t.type === 'SELL' ? 'b-p' : 'b-c'}`}>{t.type}</span></td>
                        <td>{fmtNum(t.shares)}</td>
                        <td>{t.price ? '$' + t.price.toFixed(2) : '—'}</td>
                        <td className={t.type === 'BUY' ? 'vg' : t.type === 'SELL' ? 'vr' : ''}>{t.value ? fmtUSD(t.value) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <div className="loading" style={{ padding: 12 }}>No Form 4 filings in window.</div>
            )}

            <div style={{ fontSize: 9, color: 'var(--ash)', fontFamily: 'var(--mono)', marginTop: 10 }}>
              Source: SEC Form 4 via {data.source === 'edgar' ? 'EDGAR' : 'FMP'} · Open-market P/S only · grants/exercises excluded from net
            </div>
          </>
        )}
      </div>
    </div>
  );
}