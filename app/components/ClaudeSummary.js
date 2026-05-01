'use client';

import { useEffect, useRef, useState } from 'react';

// Streams a 1-line plain-English summary of a command-palette input from
// /data_pages/claude_summary. Debounced 300 ms; aborts on next keystroke;
// silently no-ops if the route returns empty (e.g. no API key).
export default function ClaudeSummary({ input }) {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const ctrlRef = useRef(null);

  useEffect(() => {
    if (!input || input.trim().length < 2) { setText(''); setLoading(false); return; }
    if (ctrlRef.current) ctrlRef.current.abort();
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;

    const handle = setTimeout(async () => {
      setLoading(true);
      setText('');
      try {
        const res = await fetch('/data_pages/claude_summary', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ input }),
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) { setLoading(false); return; }
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let acc = '';
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          acc += dec.decode(value, { stream: true });
          setText(acc);
        }
      } catch (_) { /* aborted or network — silent */ }
      finally { setLoading(false); }
    }, 300);

    return () => { clearTimeout(handle); ctrl.abort(); };
  }, [input]);

  if (!text && !loading) return null;
  return (
    <div className="claude-summary">
      <span className="claude-summary-tag">AI</span>
      <span className="claude-summary-text">{text || '…'}</span>
    </div>
  );
}