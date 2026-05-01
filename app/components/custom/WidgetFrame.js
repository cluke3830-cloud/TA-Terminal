'use client';

import { useState } from 'react';
import { WIDGET_META } from './widgetRegistry';

const SIZE_PRESETS = [
  { w: 4, h: 1, label: '4×1' },
  { w: 4, h: 2, label: '4×2' },
  { w: 6, h: 2, label: '6×2' },
  { w: 8, h: 2, label: '8×2' },
  { w: 12, h: 2, label: '12×2' },
];

export default function WidgetFrame({ item, onClose, onResize, onUpdate, children }) {
  const meta = WIDGET_META[item.kind] || { title: item.kind, needsSymbol: false };
  const [showSize, setShowSize] = useState(false);
  const [symbolDraft, setSymbolDraft] = useState(item.params?.symbol || '');

  const style = {
    gridColumn: `span ${item.w}`,
    gridRow: `span ${item.h}`,
  };

  const commitSymbol = () => {
    const s = symbolDraft.trim().toUpperCase();
    if (s && s !== item.params?.symbol) onUpdate({ params: { ...item.params, symbol: s } });
  };

  return (
    <section className="widget-frame" style={style}>
      <div className="widget-frame-title">
        <span className="widget-frame-slot">#{item.slot}</span>
        <span className="widget-frame-name">{meta.title}</span>
        {meta.needsSymbol && (
          <input
            className="widget-frame-sym"
            value={symbolDraft}
            placeholder="SYM"
            onChange={(e) => setSymbolDraft(e.target.value.toUpperCase())}
            onBlur={commitSymbol}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitSymbol(); } }}
          />
        )}
        <span className="widget-frame-spacer" />
        <button className="widget-frame-btn" onClick={() => setShowSize((v) => !v)} title="Resize">⤡</button>
        {showSize && (
          <div className="widget-frame-sizes">
            {SIZE_PRESETS.map((p) => (
              <button
                key={p.label}
                className={`widget-frame-size ${item.w === p.w && item.h === p.h ? 'active' : ''}`}
                onClick={() => { onResize(p.w, p.h); setShowSize(false); }}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}
        <button className="widget-frame-btn close" onClick={onClose} title="Close">✕</button>
      </div>
      <div className="widget-frame-body">
        {children}
      </div>
    </section>
  );
}
