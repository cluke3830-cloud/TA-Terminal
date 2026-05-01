'use client';

import { useEffect, useState } from 'react';

export default function DesWidget({ params }) {
  const symbol = (params?.symbol || 'NVDA').toUpperCase();
  const [fin, setFin] = useState(null);
  const [quote, setQuote] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [f, q] = await Promise.all([
          fetch(`/data_pages/financials?symbol=${symbol}`).then((r) => r.json()),
          fetch(`/data_pages/quote?symbols=${symbol}`).then((r) => r.json()),
        ]);
        if (!cancelled) { setFin(f); setQuote(q?.quotes?.[0] || null); }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [symbol]);

  const name = fin?.profile?.companyName || fin?.profile?.name || symbol;
  const sector = fin?.profile?.sector || '—';
  const industry = fin?.profile?.industry || '—';
  const up = quote?.changePct != null && quote.changePct >= 0;

  return (
    <div className="des-widget">
      <div className="des-tick">{symbol}</div>
      <div className="des-name">{name}</div>
      <div className="des-meta">{sector} · {industry}</div>
      <div className="des-pb">
        {quote?.price != null && <span className="des-price">${quote.price.toFixed(2)}</span>}
        {quote?.changePct != null && <span className={`des-chg ${up ? 'up' : 'dn'}`}>{up ? '+' : ''}{quote.changePct.toFixed(2)}%</span>}
      </div>
    </div>
  );
}