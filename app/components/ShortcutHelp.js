'use client';

import { useEffect, useState } from 'react';

const SECTIONS = [
  {
    title: 'Navigation',
    rows: [
      ['1', 'Terminal'],
      ['2', 'Macro'],
      ['3', 'Options'],
      ['4', 'Portfolio'],
      ['5', 'Custom'],
    ],
  },
  {
    title: 'Command palette',
    rows: [
      ['⌘K / Ctrl+K', 'Open / close palette'],
      ['↵', 'Run command'],
      ['↑ / ↓', 'Navigate suggestions'],
      ['Esc', 'Close palette / panels'],
      ['?', 'Open this help'],
    ],
  },
  {
    title: 'Workspace verbs (/custom)',
    rows: [
      ['ADD <KIND> [SYM] [args]', 'Add a widget'],
      ['RM <slot>', 'Remove a widget by slot #'],
      ['CLEAR', 'Remove all widgets'],
      ['EXPORT', 'Print layout JSON to console'],
    ],
  },
  {
    title: 'Watchlist',
    rows: [
      ['WATCH ADD <SYM>', 'Add ticker to watchlist'],
      ['WATCH RM <SYM>', 'Remove ticker'],
      ['WATCH CLEAR', 'Clear watchlist'],
    ],
  },
  {
    title: 'Alerts',
    rows: [
      ['ALERT <SYM> PRICE > 500', 'Price trigger'],
      ['ALERT <SYM> IV > 0.5', 'IV trigger'],
      ['ALERT <SYM> MCPROB > 0.3', 'MC probability trigger'],
      ['ALERT <SYM> NEWS "term"', 'News keyword trigger'],
    ],
  },
  {
    title: 'Screener',
    rows: [
      ['SCREEN P/E < 20 AND ROE > 0.15', 'Run a predicate'],
      ['SCREEN UNIVERSE SP500', 'Use the S&P 500'],
      ['SCREEN UNIVERSE CUSTOM', 'Use a user-defined list'],
    ],
  },
  {
    title: 'Chart / equity verbs',
    rows: [
      ['<TICKER>', 'Switch ticker on Terminal'],
      ['<TICKER> GP <TF> [D=n]', 'Chart with timeframe + days'],
      ['<TICKER> EARN/FIN/OPT/DES', 'Jump to panel'],
      ['<TICKER> MC <TYPE> [K=…] [T=…D]', 'Monte Carlo pricer'],
      ['MACRO YIELDS|FX|COMM|CAL|FLIGHTS|BANKS', 'Macro dashboard'],
    ],
  },
];

export default function ShortcutHelp() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target?.tagName || '').toUpperCase();
      const isText = tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable;
      if (e.key === '?' && !isText && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;
  return (
    <div className="shortcut-help" role="dialog" aria-label="Shortcuts">
      <div className="shortcut-help-overlay" onClick={() => setOpen(false)} />
      <div className="shortcut-help-card">
        <div className="shortcut-help-title">Keyboard shortcuts &amp; commands</div>
        <div className="shortcut-help-grid">
          {SECTIONS.map((s) => (
            <div key={s.title} className="shortcut-help-section">
              <div className="shortcut-help-h">{s.title}</div>
              <table>
                <tbody>
                  {s.rows.map(([k, v]) => (
                    <tr key={k}><td className="shortcut-help-k"><kbd>{k}</kbd></td><td>{v}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
        <div className="shortcut-help-foot">
          <span>Press <kbd>?</kbd> to toggle · <kbd>Esc</kbd> to close · Full reference at <a href="/READ_COMMAND.md">READ_COMMAND.md</a></span>
        </div>
      </div>
    </div>
  );
}