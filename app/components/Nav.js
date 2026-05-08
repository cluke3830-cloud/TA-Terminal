'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

const TAB_ROUTES = ['/', '/macro', '/regime', '/options', '/portfolio', '/custom', '/ai'];

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

  // Digit-key tab navigation: 1–6 jump between top-nav tabs. ⌘J opens AI drawer.
  // Skip when the user is typing in any input/textarea/contenteditable.
  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target?.tagName || '').toUpperCase();
      const inField = tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        router.push('/ai');
        return;
      }

      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (inField) return;
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= TAB_ROUTES.length) {
        e.preventDefault();
        router.push(TAB_ROUTES[n - 1]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router]);

  const pick = (symbol) => {
    setQ(''); setResults([]); setOpen(false);
    router.push(`/?sym=${encodeURIComponent(symbol.toUpperCase())}`);
  };

  return (
    <nav className="app-nav">
      <span className="app-nav-brand">QUANTUM<span className="brand-dot" /></span>
      <Link href="/" className={isActive('/')}>Terminal</Link>
      <Link href="/macro" className={isActive('/macro')}>Macro</Link>
      <Link href="/regime" className={isActive('/regime')}>Regime</Link>
      <Link href="/options" className={isActive('/options')}>Options</Link>
      <Link href="/portfolio" className={isActive('/portfolio')}>Portfolio</Link>
      <Link href="/custom" className={isActive('/custom')}>Custom</Link>
      <Link href="/ai" className={isActive('/ai')} style={{ display: 'flex', alignItems: 'center', gap: 4 }} title="AI Analyst (⌘J)">
        <span className="nav-ai-mark">✦</span> AI
      </Link>

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