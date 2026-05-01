'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

const TFS = ['1Min', '5Min', '15Min', '1Hour', '1Day'];
const TF_LABEL = { '1Min': '1m', '5Min': '5m', '15Min': '15m', '1Hour': '1H', '1Day': '1D' };
const PRESETS = [
  { d: 1,   l: '1D' },
  { d: 5,   l: '5D' },
  { d: 30,  l: '1M' },
  { d: 90,  l: '3M' },
  { d: 180, l: '6M' },
  { d: 365, l: '1Y' },
  { d: 1825, l: '5Y' },
];

const POLL_MS = { '1Min': 15000, '5Min': 15000, '15Min': 30000, '1Hour': 60000, '1Day': 5 * 60000 };

function toTzEpoch(isoStr, tz) {
  const d = new Date(isoStr);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const p = {};
  fmt.formatToParts(d).forEach(x => { p[x.type] = x.value; });
  const tzAsUtc = Date.UTC(+p.year, +p.month - 1, +p.day, p.hour === '24' ? 0 : +p.hour, +p.minute, +p.second);
  return Math.floor(tzAsUtc / 1000);
}

function toHA(bars, tz) {
  if (!bars?.length) return [];
  const ha = [];
  for (let i = 0; i < bars.length; i++) {
    const { o, h, l, c, t } = bars[i];
    const hc = (o + h + l + c) / 4;
    const ho = i === 0 ? (o + c) / 2 : (ha[i - 1].open + ha[i - 1].close) / 2;
    ha.push({ time: toTzEpoch(t, tz), open: +ho.toFixed(4), high: +Math.max(h, ho, hc).toFixed(4), low: +Math.min(l, ho, hc).toFixed(4), close: +hc.toFixed(4) });
  }
  return ha;
}

export default function ChartWidget({ params, onParams }) {
  const symbol = (params?.symbol || 'NVDA').toUpperCase();
  const [tf, setTf] = useState(params?.tf || '1Day');
  const [days, setDays] = useState(params?.days || 30);

  const [stock, setStock] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const cRef = useRef(null);
  const cInst = useRef(null);
  const seriesRef = useRef(null);
  const tz = 'America/New_York';

  const fetchBars = useCallback(async (sym, t, d) => {
    setLoading(true); setErr('');
    try {
      const r = await fetch(`/data_pages/stock?symbol=${sym}&timeframe=${t}&days=${d}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setStock(j);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial + on param change
  useEffect(() => { fetchBars(symbol, tf, days); }, [symbol, tf, days, fetchBars]);

  // Persist params back to layout when tf/days change.
  useEffect(() => { onParams?.({ symbol, tf, days }); }, [symbol, tf, days]); // eslint-disable-line

  // Build / rebuild chart on data change.
  useEffect(() => {
    if (!stock?.bars?.length || !cRef.current) return;
    let cancelled = false;
    let ro;

    (async () => {
      const LWC = await import('lightweight-charts');
      if (cancelled || !cRef.current) return;
      if (cInst.current) { try { cInst.current.remove(); } catch {} cInst.current = null; }

      const el = cRef.current;
      const chart = LWC.createChart(el, {
        width: el.clientWidth, height: el.clientHeight || 320,
        layout: { background: { color: '#111117' }, textColor: '#7d7d92', fontFamily: "'Geist Mono', monospace", fontSize: 10 },
        grid: { vertLines: { color: 'rgba(56,56,78,0.18)' }, horzLines: { color: 'rgba(56,56,78,0.18)' } },
        crosshair: { vertLine: { color: 'rgba(0,212,255,0.25)' }, horzLine: { color: 'rgba(0,212,255,0.25)' } },
        timeScale: { borderColor: '#282835', timeVisible: tf !== '1Day', secondsVisible: false },
        rightPriceScale: { borderColor: '#282835' },
      });
      cInst.current = chart;

      const haData = toHA(stock.bars, tz);
      const series = chart.addCandlestickSeries({
        upColor: '#00f59b', downColor: '#ff3355',
        borderUpColor: '#00f59b', borderDownColor: '#ff3355',
        wickUpColor: '#00f59b', wickDownColor: '#ff3355',
      });
      series.setData(haData);
      seriesRef.current = series;
      chart.timeScale().fitContent();

      ro = new ResizeObserver(() => {
        if (el && cInst.current) cInst.current.applyOptions({ width: el.clientWidth, height: el.clientHeight });
      });
      ro.observe(el);
    })();

    return () => {
      cancelled = true;
      if (ro) ro.disconnect();
      if (cInst.current) { try { cInst.current.remove(); } catch {} cInst.current = null; }
      seriesRef.current = null;
    };
  }, [stock, tf]);

  // Live polling — append new bars without re-rendering.
  useEffect(() => {
    if (!stock?.bars?.length) return;
    const period = POLL_MS[tf] || 30000;
    let cancelled = false;
    let timer;

    const poll = async () => {
      if (cancelled) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        timer = setTimeout(poll, period);
        return;
      }
      try {
        const fetchDays = tf === '1Day' ? 5 : 1;
        const r = await fetch(`/data_pages/stock?symbol=${symbol}&timeframe=${tf}&days=${fetchDays}`);
        if (r.ok) {
          const j = await r.json();
          const fresh = j?.bars || [];
          if (fresh.length > 0 && seriesRef.current) {
            const haFresh = toHA(fresh, tz);
            // Update only the latest few bars to avoid duplicating older ones.
            haFresh.slice(-Math.min(fresh.length, 50)).forEach((b) => {
              try { seriesRef.current.update(b); } catch {}
            });
            setStock((prev) => prev ? { ...prev, lastBarTimestamp: j.lastBarTimestamp, marketStatus: j.marketStatus } : prev);
          }
        }
      } catch {}
      timer = setTimeout(poll, period);
    };
    timer = setTimeout(poll, period);
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [stock, tf, symbol]);

  const last = stock?.bars?.[stock.bars.length - 1];
  const prev = stock?.bars?.[stock.bars.length - 2];
  const chg = last && prev ? ((last.c - prev.c) / prev.c * 100) : null;

  return (
    <div className="chart-widget">
      <div className="chart-widget-bar">
        <span className="chart-widget-tf-group">
          {TFS.map((t) => (
            <button key={t} className={`tf ${tf === t ? 'a' : ''}`} onClick={() => setTf(t)}>{TF_LABEL[t]}</button>
          ))}
        </span>
        <span className="chart-widget-sep">|</span>
        <span className="chart-widget-tf-group">
          {PRESETS.map((p) => (
            <button key={p.l} className={`tf ${days === p.d ? 'a' : ''}`} onClick={() => setDays(p.d)}>{p.l}</button>
          ))}
        </span>
        <input
          className="chart-widget-days"
          type="number"
          min={1}
          max={1825}
          value={days}
          onChange={(e) => setDays(Math.max(1, Math.min(1825, parseInt(e.target.value, 10) || 1)))}
        />
        <span className="chart-widget-days-lbl">days</span>
        <span className="chart-widget-spacer" />
        {last && <span className="chart-widget-last">${last.c?.toFixed(2)}</span>}
        {chg != null && <span className={`chart-widget-chg ${chg >= 0 ? 'up' : 'dn'}`}>{chg >= 0 ? '+' : ''}{chg.toFixed(2)}%</span>}
        {stock?.marketStatus && (
          <span className={`chart-freshness fr-${stock.marketStatus}`}>
            <span className="fr-dot" />
            <span className="fr-label">{stock.marketStatus.toUpperCase()}</span>
          </span>
        )}
      </div>
      {loading && !stock?.bars?.length ? (
        <div className="loading"><div className="spinner" />Fetching {days}d of {symbol}…</div>
      ) : err ? (
        <div className="err">⚠ {err}</div>
      ) : (
        <div ref={cRef} className="chart-widget-canvas" />
      )}
    </div>
  );
}