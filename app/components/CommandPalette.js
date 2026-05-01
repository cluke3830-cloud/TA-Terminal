'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { Command } from 'cmdk';
import { useRouter } from 'next/navigation';
import { parseCommand, dispatch, previewLabel, SUGGESTIONS } from '../lib/commands';
import ClaudeSummary from './ClaudeSummary';

// Re-export for backwards compatibility with any test code that imported it.
export { parseCommand };

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const router = useRouter();

  // ⌘K / Ctrl+K toggle. Esc closes.
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
              placeholder="NVDA · NVDA GP 1D D=180 · ADD CHART NVDA · WATCH ADD AAPL · SCREEN P/E < 20 AND ROE > 0.15 · MACRO YIELDS"
              value={input}
              onValueChange={setInput}
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter' && cmd) { e.preventDefault(); run(); } }}
            />
            {cmd && <span className="cmdk-preview">↵ {previewLabel(cmd)}</span>}
          </div>
          <div className="cmdk-summary">
            <ClaudeSummary input={input} />
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
            <span><kbd>?</kbd> help</span>
            <span><kbd>esc</kbd> close</span>
          </div>
        </Command>
      </div>
    </div>
  );
}
