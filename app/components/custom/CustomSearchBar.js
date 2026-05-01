'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { parseCommand, dispatch, previewLabel, WIDGET_KINDS } from '../../lib/commands';
import { WIDGET_META } from './widgetRegistry';
import ClaudeSummary from '../ClaudeSummary';

export default function CustomSearchBar() {
  const router = useRouter();
  const [input, setInput] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [addSym, setAddSym] = useState('NVDA');
  const wrapRef = useRef(null);
  const inpRef = useRef(null);

  const cmd = useMemo(() => parseCommand(input), [input]);

  useEffect(() => {
    const onDoc = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setShowAdd(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const run = () => {
    if (!cmd) return;
    dispatch(cmd, router);
    setInput('');
  };

  const addByKind = (kind) => {
    const meta = WIDGET_META[kind];
    const params = meta?.needsSymbol ? { symbol: (addSym || 'NVDA').toUpperCase() } : {};
    dispatch({ kind: 'add', widget: kind, params }, router);
    setShowAdd(false);
  };

  return (
    <div className="custom-search" ref={wrapRef}>
      <div className="custom-search-row">
        <span className="custom-search-prompt">⌕</span>
        <input
          ref={inpRef}
          className="custom-search-input"
          placeholder="Type a command — e.g. ADD CHART NVDA 1D D=180 · ADD SCREENER · WATCH ADD AAPL · ⌘K palette · ? help"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && cmd) { e.preventDefault(); run(); }
            else if (e.key === 'Escape') { e.preventDefault(); setInput(''); }
          }}
        />
        {cmd && <span className="custom-search-preview">↵ {previewLabel(cmd)}</span>}
        <button className="custom-search-btn" onClick={() => setShowAdd((v) => !v)}>+ Add widget ▾</button>
        <button className="custom-search-btn ghost" onClick={() => dispatch({ kind: 'clear' }, router)} title="Remove all widgets">⟳ Reset</button>
        <button className="custom-search-btn ghost" onClick={() => dispatch({ kind: 'export' }, router)} title="Print layout JSON to console">⤓ Export</button>
      </div>
      <div className="custom-search-meta">
        <ClaudeSummary input={input} />
      </div>
      {showAdd && (
        <div className="custom-search-menu">
          <div className="custom-search-menu-row">
            <span className="custom-search-menu-lbl">Symbol</span>
            <input
              className="custom-search-menu-sym"
              value={addSym}
              onChange={(e) => setAddSym(e.target.value.toUpperCase())}
              placeholder="NVDA"
            />
            <span className="custom-search-menu-hint">used for symbol-bound widgets</span>
          </div>
          <div className="custom-search-menu-grid">
            {WIDGET_KINDS.map((k) => (
              <button key={k} className="custom-search-menu-item" onClick={() => addByKind(k)}>
                <span className="custom-search-menu-kind">{k}</span>
                <span className="custom-search-menu-name">{WIDGET_META[k]?.title || k}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}