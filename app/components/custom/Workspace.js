'use client';

import { useEffect, useReducer, useCallback } from 'react';
import WidgetFrame from './WidgetFrame';
import EmptyState from './EmptyState';
import { WIDGET_META, REGISTRY } from './widgetRegistry';

const STORAGE_KEY = 'qt.custom.layout';

function loadInitial() {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function persist(items) {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); } catch {}
}

let nextSlot = 1;
function newSlot(items) {
  const used = new Set(items.map(i => i.slot));
  let n = 1;
  while (used.has(n)) n++;
  nextSlot = n + 1;
  return n;
}

function reducer(state, action) {
  switch (action.type) {
    case 'init':
      return action.items;
    case 'add': {
      const meta = WIDGET_META[action.kind];
      if (!meta) return state;
      const slot = newSlot(state);
      const item = {
        slot,
        kind: action.kind,
        params: action.params || {},
        w: meta.defaultSize.w,
        h: meta.defaultSize.h,
      };
      return [...state, item];
    }
    case 'rm':
      return state.filter(i => i.slot !== action.slot);
    case 'rm_kind':
      return state.filter(i => i.kind !== action.kind);
    case 'clear':
      return [];
    case 'update':
      return state.map(i => i.slot === action.slot ? { ...i, ...action.patch } : i);
    case 'resize':
      return state.map(i => i.slot === action.slot ? { ...i, w: action.w, h: action.h } : i);
    default:
      return state;
  }
}

export default function Workspace() {
  const [items, dispatch] = useReducer(reducer, [], () => loadInitial());

  // Persist on every change.
  useEffect(() => { persist(items); }, [items]);

  // Listen for command-palette / search-bar dispatches.
  useEffect(() => {
    const onApply = (ev) => {
      const cmd = ev.detail;
      if (!cmd) return;
      switch (cmd.kind) {
        case 'add':
          dispatch({ type: 'add', kind: cmd.widget, params: cmd.params });
          return;
        case 'rm':
          dispatch({ type: 'rm', slot: cmd.slot });
          return;
        case 'rm_kind':
          dispatch({ type: 'rm_kind', kind: cmd.widget });
          return;
        case 'clear':
          dispatch({ type: 'clear' });
          return;
        case 'export': {
          if (typeof window === 'undefined') return;
          const data = JSON.stringify(items, null, 2);
          // eslint-disable-next-line no-console
          console.log('[QT custom layout]', data);
          window.dispatchEvent(new CustomEvent('qt:toast', { detail: { msg: 'Layout printed to console', level: 'info' } }));
          return;
        }
        case 'resize':
          dispatch({ type: 'resize', slot: cmd.slot, w: cmd.w, h: cmd.h });
          return;
        case 'watch_add':
        case 'watch_rm':
        case 'watch_clear':
          window.dispatchEvent(new CustomEvent('qt:watchlist:apply', { detail: cmd }));
          return;
        case 'alert_add':
          window.dispatchEvent(new CustomEvent('qt:alerts:apply', { detail: cmd }));
          return;
        case 'screen':
        case 'screen_universe':
          window.dispatchEvent(new CustomEvent('qt:screener:apply', { detail: cmd }));
          return;
        default:
      }
    };
    window.addEventListener('qt:custom:apply', onApply);
    return () => window.removeEventListener('qt:custom:apply', onApply);
  }, [items]);

  const updateItem = useCallback((slot, patch) => dispatch({ type: 'update', slot, patch }), []);
  const remove = useCallback((slot) => dispatch({ type: 'rm', slot }), []);
  const resize = useCallback((slot, w, h) => dispatch({ type: 'resize', slot, w, h }), []);

  if (items.length === 0) return <EmptyState />;

  return (
    <div className="custom-grid">
      {items.map((it) => {
        const Comp = REGISTRY[it.kind];
        if (!Comp) return null;
        return (
          <WidgetFrame
            key={it.slot}
            item={it}
            onClose={() => remove(it.slot)}
            onResize={(w, h) => resize(it.slot, w, h)}
            onUpdate={(patch) => updateItem(it.slot, patch)}
          >
            <Comp params={it.params} onParams={(p) => updateItem(it.slot, { params: { ...it.params, ...p } })} />
          </WidgetFrame>
        );
      })}
    </div>
  );
}