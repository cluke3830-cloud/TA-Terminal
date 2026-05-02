'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import {
  calcSMA, calcEMA, calcRSI, calcMACD, calcBollingerBands,
  calcStochastic, filterConsecutiveSessionBars,
} from '../lib/advancedIndicators';
import IndicatorPanel from './IndicatorPanel';

function toTzEpoch(isoStr, tz) {
  const d = new Date(isoStr);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const p = {};
  fmt.formatToParts(d).forEach(x => { p[x.type] = x.value; });
  const tzAsUtc = Date.UTC(+p.year, +p.month - 1, +p.day, p.hour === '24' ? 0 : +p.hour, +p.minute, +p.second);
  return Math.floor(tzAsUtc / 1000);
}

function toHA(bars, times) {
  if (!bars?.length) return [];
  const ha = [];
  for (let i = 0; i < bars.length; i++) {
    const { o, h, l, c } = bars[i];
    const hc = (o + h + l + c) / 4;
    const ho = i === 0 ? (o + c) / 2 : (ha[i - 1].open + ha[i - 1].close) / 2;
    ha.push({
      time: times[i],
      open: +ho.toFixed(4),
      high: +Math.max(h, ho, hc).toFixed(4),
      low: +Math.min(l, ho, hc).toFixed(4),
      close: +hc.toFixed(4),
    });
  }
  return ha;
}

const TIMEFRAMES = [
  { id: '1Min', label: '1m' },
  { id: '5Min', label: '5m' },
  { id: '15Min', label: '15m' },
  { id: '1Hour', label: '1h' },
  { id: '4Hour', label: '4h' },
  { id: '1Day', label: '1D' },
];

const CHART_TYPES = [
  { id: 'heikin', label: 'HA' },
  { id: 'candle', label: 'Candle' },
  { id: 'bar', label: 'Bar' },
  { id: 'line', label: 'Line' },
  { id: 'area', label: 'Area' },
];

const baseChartOptions = {
  layout: { background: { color: '#111117' }, textColor: '#555568', fontFamily: "'Geist Mono',monospace", fontSize: 10 },
  grid: { vertLines: { color: 'rgba(56,56,78,0.2)' }, horzLines: { color: 'rgba(56,56,78,0.2)' } },
  crosshair: {
    vertLine: { color: 'rgba(0,212,255,0.25)', labelBackgroundColor: '#18181f' },
    horzLine: { color: 'rgba(0,212,255,0.25)', labelBackgroundColor: '#18181f' },
  },
  rightPriceScale: { borderColor: '#282835' },
};

export default function ChartWithIndicators({
  bars = [],
  tf = '1Min',
  tz = 'America/New_York',
  chartType = 'candle',
  onTfChange,
  onChartTypeChange,
}) {
  const [indicators, setIndicators] = useState({
    sma20: false, sma50: false,
    ema12: false, ema26: false,
    bb20: false,
    rsi14: true, macd: true, stoch: false,
    volume: true,
  });

  const [showPanel, setShowPanel] = useState(false);
  const [chartReady, setChartReady] = useState(false);

  // DOM container refs (set via ref callbacks in JSX)
  const mainElRef = useRef(null);
  const rsiElRef = useRef(null);
  const macdElRef = useRef(null);
  const stochElRef = useRef(null);

  // Chart instance refs
  const mainChartRef = useRef(null);
  const rsiChartRef = useRef(null);
  const macdChartRef = useRef(null);
  const stochChartRef = useRef(null);

  // Series refs
  const mainSeriesRef = useRef(null);
  const volSeriesRef = useRef(null);
  const indSeriesRef = useRef({});  // { sma20: series, ema12: series, bbUpper: ..., etc }

  const rsiSeriesRef = useRef(null);
  const macdLineRef = useRef(null);
  const macdSignalRef = useRef(null);
  const macdHistRef = useRef(null);
  const stochKRef = useRef(null);
  const stochDRef = useRef(null);

  // Cached transformed data
  const dataRef = useRef({ bars: [], times: [], closes: [] });

  // LWC module cache
  const lwcRef = useRef(null);

  const handleToggleIndicator = useCallback((id) => {
    setIndicators(prev => ({ ...prev, [id]: !prev[id] }));
  }, []);

  // ── 1) Create main chart ONCE on mount ───────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    let ro;

    (async () => {
      const LWC = await import('lightweight-charts');
      if (cancelled || !mainElRef.current) return;
      lwcRef.current = LWC;

      const chart = LWC.createChart(mainElRef.current, {
        ...baseChartOptions,
        width: mainElRef.current.clientWidth,
        height: 400,
        timeScale: { borderColor: '#282835', timeVisible: true, secondsVisible: false },
      });
      mainChartRef.current = chart;

      ro = new ResizeObserver(() => {
        if (mainElRef.current) chart.applyOptions({ width: mainElRef.current.clientWidth });
      });
      ro.observe(mainElRef.current);

      setChartReady(true);
    })();

    return () => {
      cancelled = true;
      ro?.disconnect();
      if (mainChartRef.current) {
        try { mainChartRef.current.remove(); } catch {}
        mainChartRef.current = null;
      }
      mainSeriesRef.current = null;
      volSeriesRef.current = null;
      indSeriesRef.current = {};
      setChartReady(false);
    };
  }, []);

  // ── 2) Create/swap main series on chartType change ───────────────────────
  useEffect(() => {
    if (!chartReady || !mainChartRef.current) return;
    const chart = mainChartRef.current;

    if (mainSeriesRef.current) {
      try { chart.removeSeries(mainSeriesRef.current); } catch {}
      mainSeriesRef.current = null;
    }

    if (chartType === 'line') {
      mainSeriesRef.current = chart.addLineSeries({ color: '#00d4ff', lineWidth: 2 });
    } else if (chartType === 'area') {
      mainSeriesRef.current = chart.addAreaSeries({
        topColor: 'rgba(0,212,255,0.4)', bottomColor: 'rgba(0,212,255,0.02)',
        lineColor: '#00d4ff', lineWidth: 2,
      });
    } else if (chartType === 'bar') {
      mainSeriesRef.current = chart.addBarSeries({ upColor: '#00f59b', downColor: '#ff3355' });
    } else {
      mainSeriesRef.current = chart.addCandlestickSeries({
        upColor: '#00f59b', downColor: '#ff3355',
        borderUpColor: '#00f59b', borderDownColor: '#ff3355',
        wickUpColor: '#00f59b', wickDownColor: '#ff3355',
      });
    }

    // Apply existing data if we have it
    const { bars: gb, times } = dataRef.current;
    if (gb.length > 0) {
      if (chartType === 'line' || chartType === 'area') {
        mainSeriesRef.current.setData(gb.map((b, i) => ({ time: times[i], value: b.c })));
      } else if (chartType === 'heikin') {
        mainSeriesRef.current.setData(toHA(gb, times));
      } else {
        mainSeriesRef.current.setData(gb.map((b, i) => ({ time: times[i], open: b.o, high: b.h, low: b.l, close: b.c })));
      }
    }
  }, [chartType, chartReady]);

  // ── 3) Update data when bars change ──────────────────────────────────────
  useEffect(() => {
    if (!chartReady || !bars || bars.length === 0) return;

    const gb = filterConsecutiveSessionBars(bars, tf);
    const times = gb.map(b => toTzEpoch(b.t, tz));
    const closes = gb.map(b => b.c);
    dataRef.current = { bars: gb, times, closes };

    // Main series
    if (mainSeriesRef.current) {
      if (chartType === 'line' || chartType === 'area') {
        mainSeriesRef.current.setData(gb.map((b, i) => ({ time: times[i], value: b.c })));
      } else if (chartType === 'heikin') {
        mainSeriesRef.current.setData(toHA(gb, times));
      } else {
        mainSeriesRef.current.setData(gb.map((b, i) => ({ time: times[i], open: b.o, high: b.h, low: b.l, close: b.c })));
      }
    }

    // Volume
    if (volSeriesRef.current) {
      volSeriesRef.current.setData(gb.map((b, i) => ({
        time: times[i], value: b.v,
        color: b.c >= b.o ? 'rgba(0,245,155,0.15)' : 'rgba(255,51,85,0.15)',
      })));
    }

    // Overlay indicators
    if (indSeriesRef.current.sma20) {
      const v = calcSMA(closes, 20);
      indSeriesRef.current.sma20.setData(v.map((x, i) => x ? { time: times[i], value: x } : null).filter(Boolean));
    }
    if (indSeriesRef.current.sma50) {
      const v = calcSMA(closes, 50);
      indSeriesRef.current.sma50.setData(v.map((x, i) => x ? { time: times[i], value: x } : null).filter(Boolean));
    }
    if (indSeriesRef.current.ema12) {
      const v = calcEMA(closes, 12);
      indSeriesRef.current.ema12.setData(v.map((x, i) => x ? { time: times[i], value: x } : null).filter(Boolean));
    }
    if (indSeriesRef.current.ema26) {
      const v = calcEMA(closes, 26);
      indSeriesRef.current.ema26.setData(v.map((x, i) => x ? { time: times[i], value: x } : null).filter(Boolean));
    }
    if (indSeriesRef.current.bbUpper) {
      const bb = calcBollingerBands(closes, 20, 2);
      indSeriesRef.current.bbUpper.setData(bb.map((x, i) => x.upper ? { time: times[i], value: x.upper } : null).filter(Boolean));
      indSeriesRef.current.bbMiddle?.setData(bb.map((x, i) => x.middle ? { time: times[i], value: x.middle } : null).filter(Boolean));
      indSeriesRef.current.bbLower?.setData(bb.map((x, i) => x.lower ? { time: times[i], value: x.lower } : null).filter(Boolean));
    }

    // Sub-charts
    if (rsiSeriesRef.current) {
      const r = calcRSI(closes, 14);
      rsiSeriesRef.current.setData(r.map((x, i) => x ? { time: times[i], value: x } : null).filter(Boolean));
    }
    if (macdLineRef.current) {
      const m = calcMACD(closes, 12, 26, 9);
      macdLineRef.current.setData(m.macdLine.map((x, i) => x ? { time: times[i], value: x } : null).filter(Boolean));
      macdSignalRef.current?.setData(m.signalLine.map((x, i) => x ? { time: times[i], value: x } : null).filter(Boolean));
      macdHistRef.current?.setData(m.histogram.map((x, i) => x ? {
        time: times[i], value: x,
        color: x > 0 ? 'rgba(0,245,155,0.4)' : 'rgba(255,51,85,0.4)',
      } : null).filter(Boolean));
    }
    if (stochKRef.current) {
      const s = calcStochastic(closes, 14, 3, 3);
      stochKRef.current.setData(s.map((x, i) => x.k != null ? { time: times[i], value: x.k } : null).filter(Boolean));
      stochDRef.current?.setData(s.map((x, i) => x.d != null ? { time: times[i], value: x.d } : null).filter(Boolean));
    }

    // Fit content only on first data load (no visible range yet)
    if (mainChartRef.current) {
      const range = mainChartRef.current.timeScale().getVisibleRange();
      if (!range) mainChartRef.current.timeScale().fitContent();
    }
  }, [bars, tf, tz, chartType, chartReady]);

  // ── 4) Volume toggle ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!chartReady || !mainChartRef.current) return;
    const chart = mainChartRef.current;

    if (indicators.volume) {
      if (!volSeriesRef.current) {
        volSeriesRef.current = chart.addHistogramSeries({
          priceFormat: { type: 'volume' },
          priceScaleId: 'vol',
          color: 'rgba(58,122,204,0.3)',
        });
        chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

        const { bars: gb, times } = dataRef.current;
        if (gb.length > 0) {
          volSeriesRef.current.setData(gb.map((b, i) => ({
            time: times[i], value: b.v,
            color: b.c >= b.o ? 'rgba(0,245,155,0.15)' : 'rgba(255,51,85,0.15)',
          })));
        }
      }
    } else if (volSeriesRef.current) {
      try { chart.removeSeries(volSeriesRef.current); } catch {}
      volSeriesRef.current = null;
    }
  }, [indicators.volume, chartReady]);

  // ── 5) Overlay indicator toggles (SMA, EMA, BB) ──────────────────────────
  useEffect(() => {
    if (!chartReady || !mainChartRef.current) return;
    const chart = mainChartRef.current;

    const overlayDefs = {
      sma20: { color: '#ff8833', lineWidth: 1, period: 20, fn: calcSMA },
      sma50: { color: '#9955ff', lineWidth: 1, period: 50, fn: calcSMA },
      ema12: { color: '#00d4ff', lineWidth: 1, period: 12, fn: calcEMA },
      ema26: { color: '#00f59b', lineWidth: 1, period: 26, fn: calcEMA },
    };

    Object.entries(overlayDefs).forEach(([id, def]) => {
      if (indicators[id]) {
        if (!indSeriesRef.current[id]) {
          const series = chart.addLineSeries({ color: def.color, lineWidth: def.lineWidth, crosshairMarkerVisible: false });
          indSeriesRef.current[id] = series;
          if (dataRef.current.closes.length > 0) {
            const v = def.fn(dataRef.current.closes, def.period);
            series.setData(v.map((x, i) => x ? { time: dataRef.current.times[i], value: x } : null).filter(Boolean));
          }
        }
      } else if (indSeriesRef.current[id]) {
        try { chart.removeSeries(indSeriesRef.current[id]); } catch {}
        delete indSeriesRef.current[id];
      }
    });

    // Bollinger Bands
    if (indicators.bb20) {
      if (!indSeriesRef.current.bbUpper) {
        indSeriesRef.current.bbUpper = chart.addLineSeries({ color: '#ff8833', lineWidth: 1, lineStyle: 2, crosshairMarkerVisible: false });
        indSeriesRef.current.bbMiddle = chart.addLineSeries({ color: '#ff8833', lineWidth: 1, lineStyle: 2, crosshairMarkerVisible: false });
        indSeriesRef.current.bbLower = chart.addLineSeries({ color: '#ff8833', lineWidth: 1, lineStyle: 2, crosshairMarkerVisible: false });
        if (dataRef.current.closes.length > 0) {
          const bb = calcBollingerBands(dataRef.current.closes, 20, 2);
          const t = dataRef.current.times;
          indSeriesRef.current.bbUpper.setData(bb.map((x, i) => x.upper ? { time: t[i], value: x.upper } : null).filter(Boolean));
          indSeriesRef.current.bbMiddle.setData(bb.map((x, i) => x.middle ? { time: t[i], value: x.middle } : null).filter(Boolean));
          indSeriesRef.current.bbLower.setData(bb.map((x, i) => x.lower ? { time: t[i], value: x.lower } : null).filter(Boolean));
        }
      }
    } else {
      ['bbUpper', 'bbMiddle', 'bbLower'].forEach(k => {
        if (indSeriesRef.current[k]) {
          try { chart.removeSeries(indSeriesRef.current[k]); } catch {}
          delete indSeriesRef.current[k];
        }
      });
    }
  }, [indicators.sma20, indicators.sma50, indicators.ema12, indicators.ema26, indicators.bb20, chartReady]);

  // ── 6) RSI sub-chart lifecycle ───────────────────────────────────────────
  useEffect(() => {
    if (!indicators.rsi14 || !chartReady) return;

    let ro;
    (async () => {
      const LWC = lwcRef.current;
      if (!LWC || !rsiElRef.current) return;

      const chart = LWC.createChart(rsiElRef.current, {
        ...baseChartOptions,
        width: rsiElRef.current.clientWidth,
        height: 100,
        timeScale: { borderColor: '#282835', timeVisible: false },
      });
      rsiChartRef.current = chart;

      const series = chart.addLineSeries({ color: '#00d4ff', lineWidth: 1.5 });
      rsiSeriesRef.current = series;

      if (dataRef.current.closes.length > 0) {
        const r = calcRSI(dataRef.current.closes, 14);
        series.setData(r.map((x, i) => x ? { time: dataRef.current.times[i], value: x } : null).filter(Boolean));
      }

      ro = new ResizeObserver(() => {
        if (rsiElRef.current) chart.applyOptions({ width: rsiElRef.current.clientWidth });
      });
      ro.observe(rsiElRef.current);
    })();

    return () => {
      ro?.disconnect();
      if (rsiChartRef.current) {
        try { rsiChartRef.current.remove(); } catch {}
        rsiChartRef.current = null;
      }
      rsiSeriesRef.current = null;
    };
  }, [indicators.rsi14, chartReady]);

  // ── 7) MACD sub-chart lifecycle ──────────────────────────────────────────
  useEffect(() => {
    if (!indicators.macd || !chartReady) return;

    let ro;
    (async () => {
      const LWC = lwcRef.current;
      if (!LWC || !macdElRef.current) return;

      const chart = LWC.createChart(macdElRef.current, {
        ...baseChartOptions,
        width: macdElRef.current.clientWidth,
        height: 100,
        timeScale: { borderColor: '#282835', timeVisible: false },
      });
      macdChartRef.current = chart;

      macdLineRef.current = chart.addLineSeries({ color: '#00d4ff', lineWidth: 1.5 });
      macdSignalRef.current = chart.addLineSeries({ color: '#ff8833', lineWidth: 1 });
      macdHistRef.current = chart.addHistogramSeries({ color: '#00f59b' });

      if (dataRef.current.closes.length > 0) {
        const m = calcMACD(dataRef.current.closes, 12, 26, 9);
        const t = dataRef.current.times;
        macdLineRef.current.setData(m.macdLine.map((x, i) => x ? { time: t[i], value: x } : null).filter(Boolean));
        macdSignalRef.current.setData(m.signalLine.map((x, i) => x ? { time: t[i], value: x } : null).filter(Boolean));
        macdHistRef.current.setData(m.histogram.map((x, i) => x ? {
          time: t[i], value: x,
          color: x > 0 ? 'rgba(0,245,155,0.4)' : 'rgba(255,51,85,0.4)',
        } : null).filter(Boolean));
      }

      ro = new ResizeObserver(() => {
        if (macdElRef.current) chart.applyOptions({ width: macdElRef.current.clientWidth });
      });
      ro.observe(macdElRef.current);
    })();

    return () => {
      ro?.disconnect();
      if (macdChartRef.current) {
        try { macdChartRef.current.remove(); } catch {}
        macdChartRef.current = null;
      }
      macdLineRef.current = null;
      macdSignalRef.current = null;
      macdHistRef.current = null;
    };
  }, [indicators.macd, chartReady]);

  // ── 8) Stochastic sub-chart lifecycle ────────────────────────────────────
  useEffect(() => {
    if (!indicators.stoch || !chartReady) return;

    let ro;
    (async () => {
      const LWC = lwcRef.current;
      if (!LWC || !stochElRef.current) return;

      const chart = LWC.createChart(stochElRef.current, {
        ...baseChartOptions,
        width: stochElRef.current.clientWidth,
        height: 100,
        timeScale: { borderColor: '#282835', timeVisible: false },
      });
      stochChartRef.current = chart;

      stochKRef.current = chart.addLineSeries({ color: '#00d4ff', lineWidth: 1.5 });
      stochDRef.current = chart.addLineSeries({ color: '#ff8833', lineWidth: 1 });

      if (dataRef.current.closes.length > 0) {
        const s = calcStochastic(dataRef.current.closes, 14, 3, 3);
        const t = dataRef.current.times;
        stochKRef.current.setData(s.map((x, i) => x.k != null ? { time: t[i], value: x.k } : null).filter(Boolean));
        stochDRef.current.setData(s.map((x, i) => x.d != null ? { time: t[i], value: x.d } : null).filter(Boolean));
      }

      ro = new ResizeObserver(() => {
        if (stochElRef.current) chart.applyOptions({ width: stochElRef.current.clientWidth });
      });
      ro.observe(stochElRef.current);
    })();

    return () => {
      ro?.disconnect();
      if (stochChartRef.current) {
        try { stochChartRef.current.remove(); } catch {}
        stochChartRef.current = null;
      }
      stochKRef.current = null;
      stochDRef.current = null;
    };
  }, [indicators.stoch, chartReady]);

  const activeCount = Object.values(indicators).filter(Boolean).length;

  return (
    <div className="cwi-container">
      <div className="cwi-controls">
        <div className="cwi-group">
          {TIMEFRAMES.map(t => (
            <button key={t.id} className={`cwi-tf ${tf === t.id ? 'a' : ''}`} onClick={() => onTfChange?.(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        <span className="cwi-sep">|</span>
        <div className="cwi-group">
          {CHART_TYPES.map(c => (
            <button key={c.id} className={`cwi-tf ${chartType === c.id ? 'a' : ''}`} onClick={() => onChartTypeChange?.(c.id)}>
              {c.label}
            </button>
          ))}
        </div>
        <span className="cwi-sep">|</span>
        <button className="cwi-tf cwi-ind-btn" onClick={() => setShowPanel(!showPanel)} title="Toggle Indicator Panel">
          ⚙ Indicators ({activeCount})
        </button>
        {showPanel && (
          <IndicatorPanel indicators={indicators} onToggle={handleToggleIndicator} />
        )}
      </div>

      <div className="cwi-wrapper">
        <div ref={mainElRef} className="cwi-main" />
        {indicators.rsi14 && (
          <div className="cwi-sub-wrapper">
            <div className="cwi-sub-label">RSI (14)</div>
            <div ref={rsiElRef} className="cwi-sub" />
          </div>
        )}
        {indicators.macd && (
          <div className="cwi-sub-wrapper">
            <div className="cwi-sub-label">MACD (12, 26, 9)</div>
            <div ref={macdElRef} className="cwi-sub" />
          </div>
        )}
        {indicators.stoch && (
          <div className="cwi-sub-wrapper">
            <div className="cwi-sub-label">Stochastic (14, 3, 3)</div>
            <div ref={stochElRef} className="cwi-sub" />
          </div>
        )}
      </div>

      <style jsx>{`
        .cwi-container {
          position: relative;
          background: var(--onyx);
          border: 1px solid var(--border);
          border-radius: var(--r);
          overflow: hidden;
          margin-bottom: 22px;
        }
        .cwi-controls {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 16px;
          border-bottom: 1px solid var(--border);
          background: rgba(11, 11, 16, 0.5);
          position: relative;
          flex-wrap: wrap;
        }
        .cwi-group { display: flex; gap: 4px; }
        .cwi-tf {
          height: 26px;
          padding: 0 12px;
          font-family: var(--mono);
          font-size: 11px;
          font-weight: 500;
          background: transparent;
          border: 1px solid var(--border);
          border-radius: 4px;
          color: var(--smoke);
          cursor: pointer;
          transition: all 0.15s;
        }
        .cwi-tf:hover { border-color: var(--neon-cyan); color: var(--mist); }
        .cwi-tf.a {
          background: var(--neon-cyan);
          border-color: var(--neon-cyan);
          color: var(--void);
          font-weight: 700;
        }
        .cwi-sep { color: var(--ash); font-size: 14px; margin: 0 4px; user-select: none; }
        .cwi-ind-btn { margin-left: auto; }
        .cwi-wrapper { display: flex; flex-direction: column; }
        .cwi-main { width: 100%; height: 400px; border-bottom: 1px solid var(--border); }
        .cwi-sub-wrapper { position: relative; border-bottom: 1px solid var(--border); }
        .cwi-sub-wrapper:last-child { border-bottom: none; }
        .cwi-sub-label {
          position: absolute;
          top: 4px;
          left: 12px;
          font-family: var(--mono);
          font-size: 10px;
          color: var(--ash);
          z-index: 10;
          pointer-events: none;
          letter-spacing: 0.5px;
        }
        .cwi-sub { width: 100%; height: 100px; }
      `}</style>
    </div>
  );
}