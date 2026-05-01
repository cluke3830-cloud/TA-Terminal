'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { WIDGET_META } from './widgetRegistry';

const MIN_W = 2;
const MAX_W = 12;
const MIN_H = 1;
const MAX_H = 8;
const ROW_PX = 180;

export default function WidgetFrame({ item, onClose, onResize, onUpdate, children }) {
  const meta = WIDGET_META[item.kind] || { title: item.kind, needsSymbol: false };
  const [symbolDraft, setSymbolDraft] = useState(item.params?.symbol || '');
  const [drag, setDrag] = useState(null); // { w, h } during drag (visual only)
  const frameRef = useRef(null);

  const w = drag?.w ?? item.w;
  const h = drag?.h ?? item.h;

  const style = {
    gridColumn: `span ${w}`,
    gridRow: `span ${h}`,
  };

  const commitSymbol = () => {
    const s = symbolDraft.trim().toUpperCase();
    if (s && s !== item.params?.symbol) onUpdate({ params: { ...item.params, symbol: s } });
  };

  const onResizeStart = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    const grid = frameRef.current?.parentElement;
    if (!grid) return;
    const gridRect = grid.getBoundingClientRect();
    const styles = getComputedStyle(grid);
    const gap = parseFloat(styles.gap || styles.columnGap || '0');
    const colWidth = (gridRect.width - gap * 11) / 12;
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = item.w;
    const startH = item.h;
    let lastW = startW;
    let lastH = startH;

    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      const dw = Math.round(dx / (colWidth + gap));
      const dh = Math.round(dy / (ROW_PX + gap));
      const nw = Math.max(MIN_W, Math.min(MAX_W, startW + dw));
      const nh = Math.max(MIN_H, Math.min(MAX_H, startH + dh));
      if (nw !== lastW || nh !== lastH) {
        lastW = nw; lastH = nh;
        setDrag({ w: nw, h: nh });
      }
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (lastW !== startW || lastH !== startH) onResize(lastW, lastH);
      setDrag(null);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'nwse-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [item.w, item.h, onResize]);

  return (
    <section className="widget-frame" style={style} ref={frameRef}>
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
        <span className="widget-frame-dim" title="Drag bottom-right corner to resize">{w}×{h}</span>
        <button className="widget-frame-btn close" onClick={onClose} title="Close">✕</button>
      </div>
      <div className="widget-frame-body">
        {children}
      </div>
      <div
        className={`widget-frame-resize ${drag ? 'dragging' : ''}`}
        onMouseDown={onResizeStart}
        title="Drag to resize"
      />
      {drag && <div className="widget-frame-dim-overlay">{drag.w} × {drag.h}</div>}
    </section>
  );
}
