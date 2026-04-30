'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

// Global ticker search. Lives in the top nav so every page (Terminal, Macro,
// MC Pricer) has it. Selecting a result routes to /?sym=<TICKER>; pressing
// Enter on a typed query routes to /?sym=<query>. The Dashboard reads the
// `?sym` param and switches the active ticker on its end.

export default function Nav() {
  const path = usePathname();
  const router = useRouter();
  const isActive = (p) => path === p ? 'nav-link active' : 'nav-link';

  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  // Debounced search against the existing /data_pages/search route.
  useEffect(() => {
    if (!q) { setResults([]); return; }
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/data_pages/search?q=${encodeURIComponent(q)}`);
        const d = await r.json();
        setResults(Array.isArray(d?.results) ? d.results : []);
        setOpen(true);
      } catch {
        setResults([]);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  // Click-outside dismisses the dropdown.
  useEffect(() => {
    const onDoc = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const pick = (symbol) => {
    setQ(''); setResults([]); setOpen(false);
    router.push(`/?sym=${encodeURIComponent(symbol.toUpperCase())}`);
  };

  return (
    <nav className="app-nav">
      <span className="app-nav-brand">QUANTUM<span className="brand-dot" /></span>
      <Link href="/" className={isActive('/')}>Terminal</Link>
      <Link href="/macro" className={isActive('/macro')}>Macro</Link>
      <Link href="/mc" className={isActive('/mc')}>MC Pricer</Link>

      <div className="nav-search" ref={wrapRef}>
        <span className="nav-search-icon">⌕</span>
        <input
          className="nav-search-input"
          placeholder="Search ticker · ↵ to apply · ⌘K for commands"
          value={q}
          onChange={(e) => setQ(e.target.value.toUpperCase())}
          onFocus={() => results.length > 0 && setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && q.trim()) {
              e.preventDefault();
              pick(q.trim());
            } else if (e.key === 'Escape') {
              setOpen(false);
            }
          }}
        />
        {open && results.length > 0 && (
          <div className="nav-search-dd">
            {results.map((r) => (
              <div key={r.symbol} className="nav-search-i" onMouseDown={() => pick(r.symbol)}>
                <span className="nav-search-sym">{r.symbol}</span>
                <span className="nav-search-name">{r.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <span className="app-nav-tag">AMD HACKATHON · CHAMPIONSHIP EDITION</span>
    </nav>
  );
}