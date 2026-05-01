'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';

const STORAGE_KEY = 'qt.watchlist';

function loadList() {
  if (typeof window === 'undefined') return [];
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
}
function saveList(list) {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch {}
}

export default function WatchlistWidget() {
  const router = useRouter();
  const [tickers, setTickers] = useState([]);
  const [quotes, setQuotes] = useState({});
  const [draft, setDraft] = useState('');

  // Load + listen for external watch_add/watch_rm/watch_clear events
  useEffect(() => {
    setTickers(loadList());
    const onApply = (ev) => {
      const cmd = ev.detail;
      if (!cmd) return;
      setTickers((prev) => {
        let next = prev;
        if (cmd.kind === 'watch_add') next = [...new Set([...prev, cmd.symbol.toUpperCase()])];
        else if (cmd.kind === 'watch_rm') next = prev.filter((s) => s !== cmd.symbol.toUpperCase());
        else if (cmd.kind === 'watch_clear') next = [];
        saveList(next);
        return next;
      });
    };
    window.addEventListener('qt:watchlist:apply', onApply);
    return () => window.removeEventListener('qt:watchlist:apply', onApply);
  }, []);

  // Poll quotes every 5s.
  const fetchQuotes = useCallback(async (syms) => {
    if (syms.length === 0) { setQuotes({}); return; }
    try {
      const r = await fetch(`/data_pages/quote?symbols=${encodeURIComponent(syms.join(','))}`);
      const d = await r.json();
      const next = {};
      (d.quotes || []).forEach((q) => { next[q.symbol] = q; });
      setQuotes(next);
    } catch {}
  }, []);

  useEffect(() => {
    fetchQuotes(tickers);
    const t = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      fetchQuotes(tickers);
    }, 5000);
    return () => clearInterval(t);
  }, [tickers, fetchQuotes]);

  const add = () => {
    const s = draft.trim().toUpperCase();
    if (!s) return;
    setTickers((prev) => {
      const next = [...new Set([...prev, s])];
      saveList(next);
      return next;
    });
    setDraft('');
  };
  const remove = (sym) => {
    setTickers((prev) => {
      const next = prev.filter((t) => t !== sym);
      saveList(next);
      return next;
    });
  };

  return (
    <div className="watchlist">
      <div className="watchlist-add">
        <input
          className="watchlist-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value.toUpperCase())}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          placeholder="add ticker…"
        />
        <button className="watchlist-btn" onClick={add}>+</button>
      </div>
      {tickers.length === 0 ? (
        <div className="watchlist-empty">empty — add a ticker, or run <code>WATCH ADD NVDA</code></div>
      ) : (
        <div className="watchlist-rows">
          {tickers.map((s) => {
            const q = quotes[s];
            const up = q?.changePct != null && q.changePct >= 0;
            return (
              <div key={s} className="watchlist-row" onClick={() => router.push(`/?sym=${s}`)}>
                <span className="watchlist-sym">{s}</span>
                <span className="watchlist-price">{q?.price != null ? `$${q.price.toFixed(2)}` : '—'}</span>
                <span className={`watchlist-chg ${up ? 'up' : 'dn'}`}>
                  {q?.changePct != null ? `${up ? '+' : ''}${q.changePct.toFixed(2)}%` : '—'}
                </span>
                <button className="watchlist-x" onClick={(e) => { e.stopPropagation(); remove(s); }}>×</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}