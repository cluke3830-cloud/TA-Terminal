'use client';

import { useEffect, useState, useCallback } from 'react';
import ChartWithIndicators from '../../ChartWithIndicators';

const POLL_MS = { '1Min': 15000, '5Min': 15000, '15Min': 30000, '1Hour': 60000, '1Day': 300000 };

function buildUrl(sym, t, d) {
  const days = d || 3;
  if (days <= 5) return `/data_pages/stock?symbol=${sym}&timeframe=${t}&tradingDays=${days}`;
  return `/data_pages/stock?symbol=${sym}&timeframe=${t}&days=${days}`;
}

export default function ChartWidget({ params, onParams }) {
  const symbol = (params?.symbol || 'NVDA').toUpperCase();
  const [tf, setTf] = useState(params?.tf || '1Min');
  const [days, setDays] = useState(params?.days || 3);
  const [chartType, setChartType] = useState(params?.chartType || 'heikin');

  const [stock, setStock] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const fetchBars = useCallback(async (sym, t, d) => {
    setLoading(true); setErr('');
    try {
      const r = await fetch(buildUrl(sym, t, d));
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setStock(await r.json());
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchBars(symbol, tf, days); }, [symbol, tf, days, fetchBars]);

  useEffect(() => { onParams?.({ symbol, tf, days, chartType }); }, [symbol, tf, days, chartType]); // eslint-disable-line

  // Live polling — only after initial data is loaded; passes updated bars to ChartWithIndicators without remounting it
  useEffect(() => {
    if (!stock?.bars?.length) return;
    const period = POLL_MS[tf] || 30000;
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      fetchBars(symbol, tf, days);
    }, period);
    return () => clearInterval(id);
  }, [symbol, tf, days, stock?.bars?.length, fetchBars]);

  return (
    <div className="chart-widget">
      {stock?.bars?.length
        ? <ChartWithIndicators
            bars={stock.bars}
            tf={tf}
            tz="America/New_York"
            chartType={chartType}
            onTfChange={setTf}
            onChartTypeChange={setChartType}
            days={days}
            onDaysChange={setDays}
            mainHeight={260}
          />
        : loading
          ? <div className="cw-state"><div className="spinner" />Fetching {symbol}…</div>
          : err
            ? <div className="cw-state cw-err">⚠ {err}</div>
            : <div className="cw-state"><div className="spinner" />Waiting…</div>
      }
      <style jsx>{`
        .chart-widget { height: 100%; display: flex; flex-direction: column; overflow: hidden; }
        .cw-state {
          display: flex; align-items: center; gap: 10px; justify-content: center;
          flex: 1; font-family: var(--mono); font-size: 11px; color: var(--ash);
        }
        .cw-err { color: #ff3355; }
      `}</style>
    </div>
  );
}