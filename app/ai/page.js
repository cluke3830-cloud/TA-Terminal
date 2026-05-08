'use client';

import { useEffect, useRef, useState, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

const CITATION_SENTINEL = '\n\n<<<CITATIONS>>>\n';

// Renders Gemini markdown: ## headers, **bold**, bullet lines, plain text
function MsgContent({ text }) {
  if (!text) return null;
  const lines = text.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('## ')) {
      out.push(<div key={i} className="ai-section-header">{renderInline(line.slice(3))}</div>);
    } else if (line.startsWith('### ')) {
      out.push(<div key={i} className="ai-sub-header">{renderInline(line.slice(4))}</div>);
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      out.push(<div key={i} className="ai-bullet">{'· '}{renderInline(line.slice(2))}</div>);
    } else if (line.trim() === '') {
      out.push(<div key={i} className="ai-spacer" />);
    } else {
      out.push(<div key={i} className="ai-para">{renderInline(line)}</div>);
    }
    i++;
  }
  return <>{out}</>;
}

function renderInline(text) {
  // Handle **bold** and [N] citation refs
  const parts = text.split(/(\*\*[^*]+\*\*|\[\d+\])/g);
  return parts.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) return <strong key={i}>{p.slice(2, -2)}</strong>;
    if (/^\[\d+\]$/.test(p)) return <sup key={i} className="ai-ref">{p}</sup>;
    return p;
  });
}

function AIPage() {
  const search = useSearchParams();
  const router = useRouter();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [ticker, setTicker] = useState(() => (search?.get('sym') || 'NVDA').toUpperCase());
  const [tickerInput, setTickerInput] = useState('');
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const abortRef = useRef(null);

  useEffect(() => {
    const sym = (search?.get('sym') || 'NVDA').toUpperCase();
    setTicker(sym);
  }, [search]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, streaming]);

  const submit = useCallback(async (overrideText) => {
    const text = (overrideText ?? input).trim();
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
        body: JSON.stringify({ ticker, input: text, history: messages }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const errTxt = await res.text().catch(() => 'Request failed');
        setMessages((cur) => { const c = [...cur]; c[c.length - 1] = { role: 'assistant', content: errTxt, citations: [] }; return c; });
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const idx = buf.indexOf(CITATION_SENTINEL);
        const visible = idx !== -1 ? buf.slice(0, idx) : buf;
        let citations = [];
        if (idx !== -1) { try { citations = JSON.parse(buf.slice(idx + CITATION_SENTINEL.length)); } catch {} }
        setMessages((cur) => { const c = [...cur]; c[c.length - 1] = { role: 'assistant', content: visible, citations }; return c; });
      }
    } catch (err) {
      if (err?.name !== 'AbortError') {
        setMessages((cur) => { const c = [...cur]; c[c.length - 1] = { role: 'assistant', content: `Error: ${err?.message || 'unknown'}`, citations: [] }; return c; });
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }, [input, messages, streaming, ticker]);

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  };

  const clear = () => {
    if (streaming && abortRef.current) abortRef.current.abort();
    setMessages([]);
  };

  const changeTicker = (sym) => {
    const s = sym.trim().toUpperCase();
    if (!s) return;
    setTicker(s);
    setMessages([]);
    router.replace(`/ai?sym=${s}`);
  };

  const CHIPS = [
    { label: 'Full analysis', prompt: `Give me a full analysis of ${ticker} — fundamentals, valuation, technicals, and what to watch next.` },
    { label: 'Earnings setup', prompt: `What's the setup into ${ticker}'s next earnings? Include estimates, recent beats/misses, and key metrics to watch.` },
    { label: 'Quant snapshot', prompt: `Quant snapshot for ${ticker}: current volatility regime, IV vs realized vol, options skew, and any notable positioning signals.` },
    { label: 'Bull vs bear', prompt: `Lay out the complete bull case and bear case for ${ticker} with specific numbers and catalysts for each side.` },
    { label: 'Valuation check', prompt: `Is ${ticker} cheap or expensive right now? Walk through P/E, forward P/E, EV/EBITDA, PEG, and compare to sector peers.` },
    { label: 'Risk factors', prompt: `What are the biggest risks facing ${ticker} over the next 12 months — competitive, regulatory, macro, and execution risks?` },
  ];

  return (
    <div className="ai-page">
      {/* Header */}
      <div className="ai-page-header">
        <div className="ai-page-title-row">
          <span className="ai-page-mark">✦</span>
          <span className="ai-page-title">AI ANALYST</span>
          <span className="amd-badge" style={{ marginLeft: 8 }}>Gemini 2.5 Flash · MI300X</span>
        </div>
        <div className="ai-page-ticker-row">
          <form onSubmit={(e) => { e.preventDefault(); changeTicker(tickerInput || ticker); }} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--fog)', letterSpacing: '.6px' }}>TICKER</span>
            <input
              className="ai-ticker-input"
              value={tickerInput}
              onChange={(e) => setTickerInput(e.target.value.toUpperCase())}
              placeholder={ticker}
              maxLength={8}
            />
            <button type="submit" className="ai-ticker-btn">Apply</button>
          </form>
          <span className="ai-active-ticker">· {ticker}</span>
          {messages.length > 0 && (
            <button className="ai-clear-btn" onClick={clear} disabled={streaming}>Clear chat</button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="ai-page-body" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="ai-page-empty">
            <div className="ai-page-empty-title">Ask anything about <span style={{ color: '#9955ff' }}>{ticker}</span></div>
            <div className="ai-page-empty-sub">Powered by Gemini 2.5 Flash · Google Search grounding · up to 5 sources</div>
            <div className="ai-page-chips">
              {CHIPS.map((c) => (
                <button key={c.label} className="ai-page-chip" onClick={() => submit(c.prompt)}>
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`ai-page-msg ai-page-msg-${m.role}`}>
            {m.role === 'user' ? (
              <div className="ai-page-user-bubble">{m.content}</div>
            ) : (
              <div className="ai-page-assistant-bubble">
                <div className="ai-page-assistant-label">
                  <span className="ai-page-mark-sm">✦</span> AI ANALYST · {ticker}
                </div>
                {m.content
                  ? <div className="ai-page-content"><MsgContent text={m.content} /></div>
                  : streaming && i === messages.length - 1
                    ? <span className="ai-typing">▍</span>
                    : null}
                {m.citations && m.citations.length > 0 && (
                  <div className="ai-page-citations">
                    <div className="ai-citations-label">Sources</div>
                    {m.citations.map((c, k) => (
                      <a key={k} href={c.uri} target="_blank" rel="noreferrer" className="ai-cite">
                        [{k + 1}] {c.title || (() => { try { return new URL(c.uri).hostname; } catch { return c.uri; } })()}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="ai-page-foot">
        <form className="ai-page-form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <textarea
            ref={inputRef}
            className="ai-page-textarea"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={`Ask about ${ticker}… (Enter to send · Shift+Enter for newline)`}
            rows={2}
            disabled={streaming}
          />
          <button type="submit" className="ai-page-send" disabled={!input.trim() || streaming}>
            {streaming ? '…' : '↵'}
          </button>
        </form>
        <div className="ai-page-foot-note">Gemini 2.5 Flash · Google Search grounded · max 5 citations · not financial advice</div>
      </div>
    </div>
  );
}

export default function AIAnalystPage() {
  return (
    <Suspense fallback={<div className="loading"><div className="spinner" />Loading AI Analyst…</div>}>
      <AIPage />
    </Suspense>
  );
}