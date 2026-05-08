'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

const CITATION_SENTINEL = '\n\n<<<CITATIONS>>>\n';

export default function AIDrawer() {
  const search = useSearchParams();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const abortRef = useRef(null);

  const ticker = (search?.get('sym') || 'NVDA').toUpperCase();

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener('open-ai-drawer', onOpen);
    return () => window.removeEventListener('open-ai-drawer', onOpen);
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && open) {
        if (streaming && abortRef.current) abortRef.current.abort();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, streaming]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 220);
  }, [open]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, streaming]);

  const submit = async (e) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || streaming) return;

    const next = [...messages, { role: 'user', content: text }, { role: 'assistant', content: '', citations: [] }];
    setMessages(next);
    setInput('');
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/data_pages/ai_chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker,
          input: text,
          history: messages,
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const errTxt = await res.text().catch(() => 'AI request failed');
        setMessages((cur) => {
          const copy = [...cur];
          copy[copy.length - 1] = { role: 'assistant', content: errTxt || 'AI request failed', citations: [] };
          return copy;
        });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        const sentinelIdx = buf.indexOf(CITATION_SENTINEL);
        let visible = buf;
        let citations = [];
        if (sentinelIdx !== -1) {
          visible = buf.slice(0, sentinelIdx);
          const tail = buf.slice(sentinelIdx + CITATION_SENTINEL.length);
          try { citations = JSON.parse(tail); } catch {}
        }

        setMessages((cur) => {
          const copy = [...cur];
          copy[copy.length - 1] = { role: 'assistant', content: visible, citations };
          return copy;
        });
      }
    } catch (err) {
      if (err?.name !== 'AbortError') {
        setMessages((cur) => {
          const copy = [...cur];
          copy[copy.length - 1] = { role: 'assistant', content: `Error: ${err?.message || 'unknown'}`, citations: [] };
          return copy;
        });
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const clear = () => {
    if (streaming && abortRef.current) abortRef.current.abort();
    setMessages([]);
  };

  if (!open) return null;

  return (
    <>
      <div className="ai-drawer-overlay" onClick={() => setOpen(false)} />
      <aside className="ai-drawer" role="dialog" aria-label="AI Analyst">
        <div className="ai-drawer-header">
          <div className="ai-drawer-title">
            <span className="ai-drawer-mark">✦</span> AI ANALYST
            <span className="ai-drawer-ticker">· {ticker}</span>
          </div>
          <div className="ai-drawer-actions">
            <button className="ai-drawer-clear" onClick={clear} disabled={!messages.length && !streaming}>Clear</button>
            <button className="ai-drawer-close" onClick={() => setOpen(false)} aria-label="Close">×</button>
          </div>
        </div>

        <div className="ai-drawer-body" ref={scrollRef}>
          {messages.length === 0 && (
            <div className="ai-empty">
              <div className="ai-empty-title">Ask anything about <strong>{ticker}</strong></div>
              <div className="ai-empty-sub">Powered by Gemini 2.5 Flash + Google Search grounding.</div>
              <div className="ai-empty-tags">
                <button className="ai-tag" onClick={() => setInput(`What's the setup into ${ticker}'s next earnings?`)}>Earnings setup</button>
                <button className="ai-tag" onClick={() => setInput(`Quant snapshot for ${ticker}: regime, IV, skew`)}>Quant snapshot</button>
                <button className="ai-tag" onClick={() => setInput(`What are the latest news catalysts for ${ticker}?`)}>News catalysts</button>
                <button className="ai-tag" onClick={() => setInput(`Bull vs bear thesis for ${ticker}`)}>Bull vs bear</button>
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={`ai-msg ai-msg-${m.role}`}>
              {m.role === 'user' ? (
                <div className="ai-bubble-user">{m.content}</div>
              ) : (
                <div className="ai-bubble-assistant">
                  {m.content
                    ? m.content.split(/\n{2,}/).map((p, j) => <p key={j}>{p}</p>)
                    : streaming && i === messages.length - 1
                      ? <span className="ai-typing">▍</span>
                      : null}
                  {m.citations && m.citations.length > 0 && (
                    <div className="ai-citations">
                      <div className="ai-citations-label">Sources</div>
                      {m.citations.map((c, k) => (
                        <a key={k} href={c.uri} target="_blank" rel="noreferrer" className="ai-cite">
                          [{k + 1}] {c.title || new URL(c.uri).hostname}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        <form className="ai-drawer-input" onSubmit={submit}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={`Ask about ${ticker}… (Enter to send · Shift+Enter for newline)`}
            rows={2}
            disabled={streaming}
          />
          <button type="submit" disabled={!input.trim() || streaming}>
            {streaming ? '…' : '↵'}
          </button>
        </form>
        <div className="ai-drawer-foot">Gemini 2.5 Flash · Google Search grounded · max 5 sources</div>
      </aside>
    </>
  );
}