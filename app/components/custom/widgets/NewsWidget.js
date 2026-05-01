'use client';

import { useEffect, useState } from 'react';

export default function NewsWidget({ params }) {
  const symbol = (params?.symbol || 'NVDA').toUpperCase();
  const [news, setNews] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let cancelled = false;
    setNews(null); setErr('');
    fetch(`/data_pages/news?symbol=${symbol}`)
      .then((r) => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
      .then((j) => { if (!cancelled) setNews(j); })
      .catch((e) => { if (!cancelled) setErr(String(e)); });
    return () => { cancelled = true; };
  }, [symbol]);

  if (err) return <div className="err">⚠ {err}</div>;
  if (!news) return <div className="loading"><div className="spinner" />Loading news…</div>;

  const items = (news.articles || []).slice(0, 8);
  if (items.length === 0) return <div className="loading">No news for {symbol}</div>;

  return (
    <div className="news-widget">
      {items.map((n, i) => {
        const s = n.sentiment ? (n.sentiment.positive - n.sentiment.negative) : null;
        const cls = s == null ? '' : (s > 0.1 ? 'vg' : s < -0.1 ? 'vr' : 'vy');
        return (
          <div key={i} className="ni">
            <div style={{ flex: 1, minWidth: 0 }}>
              <a href={n.url} target="_blank" rel="noopener noreferrer" className="nl">{n.title}</a>
              <div className="nm">{n.site} · {(n.date || n.publishedDate)?.slice(0, 10)}</div>
            </div>
            {s != null && <span className={cls} style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{s >= 0 ? '+' : ''}{s.toFixed(2)}</span>}
          </div>
        );
      })}
    </div>
  );
}