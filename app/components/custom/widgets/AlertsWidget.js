'use client';

import { useEffect, useState, useCallback, useRef } from 'react';

const STORAGE_KEY = 'qt.alerts';

function loadAlerts() {
  if (typeof window === 'undefined') return [];
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
}
function saveAlerts(list) {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch {}
}

function newId() { return Math.random().toString(36).slice(2, 9); }

function fmtAlert(a) {
  if (a.kind === 'NEWS') return `${a.symbol} NEWS "${a.term}"`;
  return `${a.symbol} ${a.kind} ${a.op} ${a.value}`;
}

// Fetchers for evaluation
async function fetchPrice(symbol) {
  try {
    const r = await fetch(`/data_pages/quote?symbols=${symbol}`);
    const d = await r.json();
    return d?.quotes?.[0]?.price ?? null;
  } catch { return null; }
}
async function fetchIv(symbol) {
  try {
    const r = await fetch(`/data_pages/options?symbol=${symbol}`);
    const d = await r.json();
    return d?.iv30 ?? d?.atmIv ?? d?.ivAvg ?? null;
  } catch { return null; }
}
async function fetchNewsTitles(symbol) {
  try {
    const r = await fetch(`/data_pages/news?symbol=${symbol}`);
    const d = await r.json();
    return (d?.articles || []).map((n) => `${n.title || ''} ${n.summary || ''}`.toLowerCase());
  } catch { return []; }
}

function checkOp(op, lhs, rhs) {
  if (lhs == null) return false;
  switch (op) {
    case '>': return lhs > rhs;
    case '>=': return lhs >= rhs;
    case '<': return lhs < rhs;
    case '<=': return lhs <= rhs;
    default: return false;
  }
}

export default function AlertsWidget() {
  const [alerts, setAlerts] = useState([]);
  const [draft, setDraft] = useState({ symbol: 'NVDA', kind: 'PRICE', op: '>', value: '', term: '' });
  const seenNewsRef = useRef({}); // symbol -> Set of seen titles

  useEffect(() => {
    setAlerts(loadAlerts());
    const onApply = (ev) => {
      const cmd = ev.detail;
      if (cmd?.kind !== 'alert_add') return;
      setAlerts((prev) => {
        const next = [...prev, { id: newId(), active: false, createdAt: Date.now(), ...cmd.alert }];
        saveAlerts(next);
        return next;
      });
    };
    window.addEventListener('qt:alerts:apply', onApply);
    return () => window.removeEventListener('qt:alerts:apply', onApply);
  }, []);

  // Single evaluation loop — every 15s.
  const evaluate = useCallback(async () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    setAlerts((current) => {
      // Snapshot a copy for async work; mutations applied below.
      const list = current.map((a) => ({ ...a }));

      (async () => {
        const fired = [];
        for (const a of list) {
          if (a.muted) continue;
          let triggered = false;
          if (a.kind === 'PRICE') {
            const p = await fetchPrice(a.symbol);
            triggered = checkOp(a.op, p, a.value);
            a.lastValue = p;
          } else if (a.kind === 'IV') {
            const iv = await fetchIv(a.symbol);
            triggered = checkOp(a.op, iv, a.value);
            a.lastValue = iv;
          } else if (a.kind === 'MCPROB') {
            // Lightweight proxy: compute prob via a simple GBM normal-CDF on price + IV.
            const [p, iv] = await Promise.all([fetchPrice(a.symbol), fetchIv(a.symbol)]);
            if (p != null && iv != null && a.value > 0) {
              const T = 30 / 252; // assume 30 trading days
              const sigma = iv * Math.sqrt(T);
              const z = Math.log(a.value / p) / sigma;
              const prob = 1 - normCdf(z);
              triggered = checkOp(a.op, prob, a.value);
              a.lastValue = prob;
            }
          } else if (a.kind === 'NEWS') {
            const titles = await fetchNewsTitles(a.symbol);
            const seen = seenNewsRef.current[a.symbol] || new Set();
            const term = (a.term || '').toLowerCase();
            const fresh = titles.find((t) => !seen.has(t) && term && t.includes(term));
            titles.forEach((t) => seen.add(t));
            seenNewsRef.current[a.symbol] = seen;
            triggered = !!fresh;
            if (fresh) a.lastValue = fresh.slice(0, 80);
          }
          if (triggered && !a.active) fired.push(a);
          a.active = triggered;
        }

        // Persist updated state.
        saveAlerts(list);
        setAlerts(list);

        for (const f of fired) {
          window.dispatchEvent(new CustomEvent('qt:toast', { detail: { msg: `🔔 ${fmtAlert(f)}`, level: 'alert' } }));
        }
      })();

      return current; // sync return; async update above
    });
  }, []);

  useEffect(() => {
    evaluate();
    const t = setInterval(evaluate, 15000);
    return () => clearInterval(t);
  }, [evaluate]);

  const add = () => {
    if (!draft.symbol) return;
    let alert;
    if (draft.kind === 'NEWS') {
      if (!draft.term) return;
      alert = { id: newId(), symbol: draft.symbol.toUpperCase(), kind: 'NEWS', term: draft.term, active: false, createdAt: Date.now() };
    } else {
      const v = parseFloat(draft.value);
      if (isNaN(v)) return;
      alert = { id: newId(), symbol: draft.symbol.toUpperCase(), kind: draft.kind, op: draft.op, value: v, active: false, createdAt: Date.now() };
    }
    setAlerts((prev) => { const next = [...prev, alert]; saveAlerts(next); return next; });
    setDraft({ symbol: draft.symbol, kind: 'PRICE', op: '>', value: '', term: '' });
  };

  const remove = (id) => setAlerts((prev) => { const next = prev.filter((a) => a.id !== id); saveAlerts(next); return next; });

  return (
    <div className="alerts">
      <div className="alerts-form">
        <input className="alerts-input small" value={draft.symbol} onChange={(e) => setDraft({ ...draft, symbol: e.target.value.toUpperCase() })} placeholder="SYM" />
        <select className="alerts-select" value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })}>
          <option>PRICE</option>
          <option>IV</option>
          <option>MCPROB</option>
          <option>NEWS</option>
        </select>
        {draft.kind !== 'NEWS' ? (
          <>
            <select className="alerts-select" value={draft.op} onChange={(e) => setDraft({ ...draft, op: e.target.value })}>
              <option>{'>'}</option><option>{'<'}</option><option>{'>='}</option><option>{'<='}</option>
            </select>
            <input className="alerts-input small" value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value })} placeholder="value" />
          </>
        ) : (
          <input className="alerts-input" value={draft.term} onChange={(e) => setDraft({ ...draft, term: e.target.value })} placeholder="keyword" />
        )}
        <button className="alerts-btn" onClick={add}>+ Add</button>
      </div>
      {alerts.length === 0 ? (
        <div className="alerts-empty">no alerts — add one above, or run <code>ALERT NVDA PRICE &gt; 500</code></div>
      ) : (
        <div className="alerts-list">
          {alerts.map((a) => (
            <div key={a.id} className={`alert-row ${a.active ? 'firing' : ''}`}>
              <span className="alert-dot" />
              <span className="alert-text">{fmtAlert(a)}</span>
              {a.lastValue != null && <span className="alert-last">{typeof a.lastValue === 'number' ? a.lastValue.toFixed(2) : String(a.lastValue).slice(0, 50)}</span>}
              <button className="alert-x" onClick={() => remove(a.id)}>×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Abramowitz–Stegun normal CDF approximation
function normCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-x * x / 2);
  let p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  if (x > 0) p = 1 - p;
  return p;
}