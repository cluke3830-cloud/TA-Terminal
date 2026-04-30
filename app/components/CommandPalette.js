'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { Command } from 'cmdk';
import { useRouter } from 'next/navigation';

// ── Parser ─────────────────────────────────────────────────────────────────
// Tokenizes and classifies the user's input. Pure function — easy to test.
//
// Recognized shapes:
//   <TICKER>                          → switch ticker
//   <TICKER> GP <TF>                  → chart with timeframe (1M/5M/15M/1H/1D)
//   <TICKER> EARN | FIN | OPT | DES   → switch + scroll to panel
//   <TICKER> MC [TYPE] [K=...] [T=...D] [PATHS=...]
//                                     → open MC pricer pre-filled
//   MACRO [YIELDS|COMM|FX|BANKS|CAL|FLIGHTS]
//                                     → macro page (optional panel scroll)
export function parseCommand(input) {
  const raw = input.trim();
  if (!raw) return null;
  const tokens = raw.toUpperCase().split(/\s+/).filter(Boolean);
  const head = tokens[0];

  if (head === 'MACRO') {
    return { kind: 'macro', panel: tokens[1] || null };
  }

  if (/^[A-Z]{1,5}$/.test(head)) {
    const verb = tokens[1];
    if (!verb) return { kind: 'ticker', symbol: head };
    if (verb === 'GP') return { kind: 'chart', symbol: head, tf: tokens[2] || '1D' };
    if (verb === 'DES') return { kind: 'focus', symbol: head, panel: 'overview' };
    if (verb === 'EARN') return { kind: 'focus', symbol: head, panel: 'earn' };
    if (verb === 'FIN') return { kind: 'focus', symbol: head, panel: 'fin' };
    if (verb === 'OPT') return { kind: 'focus', symbol: head, panel: 'opt' };
    if (verb === 'MC') {
      const args = { type: 'asian' };
      for (let i = 2; i < tokens.length; i++) {
        const t = tokens[i];
        if (['ASIAN', 'BARRIER', 'LOOKBACK', 'AMERICAN'].includes(t)) args.type = t.toLowerCase();
        else if (t.startsWith('K=')) args.K = t.slice(2);
        else if (t.startsWith('T=')) args.T = t.slice(2);
        else if (t.startsWith('PATHS=')) args.paths = t.slice(6);
      }
      return { kind: 'mc', symbol: head, ...args };
    }
  }

  return null;
}

// Map shorthand timeframe tokens to the strings the chart expects.
function normalizeTf(raw) {
  const t = (raw || '').toUpperCase();
  if (t === '1M' || t === '1MIN') return '1Min';
  if (t === '5M' || t === '5MIN') return '5Min';
  if (t === '15M' || t === '15MIN') return '15Min';
  if (t === '1H' || t === '1HOUR') return '1Hour';
  // Anything daily-or-longer (1D, 1W, 1Y) collapses to 1Day — the longest TF the chart supports today.
  return '1Day';
}

const MACRO_PANELS = {
  YIELDS: 'yields', COMM: 'comm', FX: 'fx', BANKS: 'banks', CAL: 'cal', FLIGHTS: 'flights',
};

function dispatch(cmd, router) {
  if (!cmd) return;
  switch (cmd.kind) {
    case 'ticker':
      router.push(`/?sym=${cmd.symbol}`);
      return;
    case 'chart':
      router.push(`/?sym=${cmd.symbol}&tf=${normalizeTf(cmd.tf)}&focus=chart`);
      return;
    case 'focus':
      router.push(`/?sym=${cmd.symbol}&focus=${cmd.panel}`);
      return;
    case 'mc': {
      const params = new URLSearchParams({ sym: cmd.symbol, type: cmd.type });
      if (cmd.K) params.set('K', cmd.K);
      if (cmd.T) params.set('T', cmd.T);
      if (cmd.paths) params.set('paths', cmd.paths);
      router.push(`/mc?${params.toString()}`);
      return;
    }
    case 'macro': {
      const slug = cmd.panel ? MACRO_PANELS[cmd.panel] : null;
      router.push(slug ? `/macro?focus=${slug}` : '/macro');
      return;
    }
    default:
  }
}

// ── Suggestions ────────────────────────────────────────────────────────────
const SUGGESTIONS = [
  {
    title: 'Tickers',
    items: [
      { id: 'nvda', label: 'NVDA', hint: 'switch ticker', cmd: { kind: 'ticker', symbol: 'NVDA' } },
      { id: 'aapl', label: 'AAPL', hint: 'switch ticker', cmd: { kind: 'ticker', symbol: 'AAPL' } },
      { id: 'tsla', label: 'TSLA', hint: 'switch ticker', cmd: { kind: 'ticker', symbol: 'TSLA' } },
      { id: 'amd', label: 'AMD', hint: 'switch ticker', cmd: { kind: 'ticker', symbol: 'AMD' } },
    ],
  },
  {
    title: 'Chart',
    items: [
      { id: 'nvda-1d', label: 'NVDA GP 1D', hint: 'NVDA · daily candles', cmd: { kind: 'chart', symbol: 'NVDA', tf: '1D' } },
      { id: 'nvda-1h', label: 'NVDA GP 1H', hint: 'NVDA · hourly', cmd: { kind: 'chart', symbol: 'NVDA', tf: '1H' } },
      { id: 'nvda-5m', label: 'NVDA GP 5M', hint: 'NVDA · 5-minute', cmd: { kind: 'chart', symbol: 'NVDA', tf: '5M' } },
    ],
  },
  {
    title: 'Equity panels',
    items: [
      { id: 'nvda-earn', label: 'NVDA EARN', hint: 'jump to earnings card', cmd: { kind: 'focus', symbol: 'NVDA', panel: 'earn' } },
      { id: 'nvda-fin', label: 'NVDA FIN', hint: 'jump to financials', cmd: { kind: 'focus', symbol: 'NVDA', panel: 'fin' } },
      { id: 'nvda-opt', label: 'NVDA OPT', hint: 'IV surface', cmd: { kind: 'focus', symbol: 'NVDA', panel: 'opt' } },
      { id: 'nvda-des', label: 'NVDA DES', hint: 'overview header', cmd: { kind: 'focus', symbol: 'NVDA', panel: 'overview' } },
    ],
  },
  {
    title: 'Monte Carlo',
    items: [
      { id: 'mc-asian', label: 'NVDA MC ASIAN K=490 PATHS=10000000', hint: 'pricer · 10M paths', cmd: { kind: 'mc', symbol: 'NVDA', type: 'asian', K: '490', paths: '10000000' } },
      { id: 'mc-barrier', label: 'NVDA MC BARRIER K=490 T=30D', hint: 'knock-out call', cmd: { kind: 'mc', symbol: 'NVDA', type: 'barrier', K: '490', T: '30D' } },
      { id: 'mc-american', label: 'NVDA MC AMERICAN K=490', hint: 'Longstaff–Schwartz', cmd: { kind: 'mc', symbol: 'NVDA', type: 'american', K: '490' } },
    ],
  },
  {
    title: 'Macro',
    items: [
      { id: 'm-yields', label: 'MACRO YIELDS', hint: 'yield curve', cmd: { kind: 'macro', panel: 'YIELDS' } },
      { id: 'm-comm', label: 'MACRO COMM', hint: 'commodities', cmd: { kind: 'macro', panel: 'COMM' } },
      { id: 'm-fx', label: 'MACRO FX', hint: 'FX strength matrix', cmd: { kind: 'macro', panel: 'FX' } },
      { id: 'm-flights', label: 'MACRO FLIGHTS', hint: 'live flight tracker', cmd: { kind: 'macro', panel: 'FLIGHTS' } },
      { id: 'm-cal', label: 'MACRO CAL', hint: 'economic calendar', cmd: { kind: 'macro', panel: 'CAL' } },
      { id: 'm-banks', label: 'MACRO BANKS', hint: 'central banks', cmd: { kind: 'macro', panel: 'BANKS' } },
    ],
  },
];

// ── Component ──────────────────────────────────────────────────────────────
export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const router = useRouter();

  // ⌘K / Ctrl+K toggle
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const cmd = useMemo(() => parseCommand(input), [input]);

  const run = useCallback((override) => {
    const c = override || cmd;
    if (!c) return;
    dispatch(c, router);
    setOpen(false);
    setInput('');
  }, [cmd, router]);

  if (!open) return null;

  return (
    <div className="cmdk-root" role="dialog" aria-label="Command palette">
      <div className="cmdk-overlay" onClick={() => setOpen(false)} />
      <div className="cmdk-card">
        <Command label="Command palette" shouldFilter={!cmd}>
          <div className="cmdk-input-wrap">
            <span className="cmdk-prompt">⌘</span>
            <Command.Input
              className="cmdk-input"
              placeholder="Type a command...  e.g. NVDA · NVDA GP 1D · NVDA MC ASIAN · MACRO YIELDS"
              value={input}
              onValueChange={setInput}
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter' && cmd) { e.preventDefault(); run(); } }}
            />
            {cmd && <span className="cmdk-preview">↵ {previewLabel(cmd)}</span>}
          </div>
          <Command.List className="cmdk-list">
            {input && <Command.Empty className="cmdk-empty">Press ↵ to run as a command, or pick a suggestion below.</Command.Empty>}
            {SUGGESTIONS.map((group) => (
              <Command.Group key={group.title} heading={group.title} className="cmdk-group">
                {group.items.map((item) => (
                  <Command.Item
                    key={item.id}
                    value={`${group.title} ${item.label} ${item.hint}`}
                    onSelect={() => run(item.cmd)}
                    className="cmdk-item"
                  >
                    <span className="cmdk-item-label">{item.label}</span>
                    <span className="cmdk-item-hint">{item.hint}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            ))}
          </Command.List>
          <div className="cmdk-footer">
            <span><kbd>↵</kbd> run</span>
            <span><kbd>↑↓</kbd> navigate</span>
            <span><kbd>⌘K</kbd> toggle</span>
            <span><kbd>esc</kbd> close</span>
          </div>
        </Command>
      </div>
    </div>
  );
}

function previewLabel(cmd) {
  switch (cmd.kind) {
    case 'ticker': return `Switch to ${cmd.symbol}`;
    case 'chart': return `${cmd.symbol} chart · ${normalizeTf(cmd.tf)}`;
    case 'focus': return `${cmd.symbol} · ${cmd.panel}`;
    case 'mc': return `MC ${cmd.type} · ${cmd.symbol}${cmd.K?` K=${cmd.K}`:''}${cmd.T?` T=${cmd.T}`:''}${cmd.paths?` paths=${cmd.paths}`:''}`;
    case 'macro': return cmd.panel ? `Macro · ${cmd.panel}` : 'Macro dashboard';
    default: return 'Run';
  }
}
