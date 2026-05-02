'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import {
  calcSMA, calcEMA, calcRSI, calcMACD, calcBollingerBands,
  calcATR, calcStochastic, filterConsecutiveSessionBars,
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

export default function ChartWithIndicators({
  bars = [],
  tf = '1Min',
  tz = 'America/New_York',
  chartType = 'candle',
  onTfChange,
  onChartTypeChange,
}) {
  const [indicators, setIndicators] = useState({
    sma20: false,
    sma50: false,
    ema12: false,
    ema26: false,
    bb20: false,
    atr14: false,
    rsi14: true,
    macd: true,
    stoch: false,
    volume: true,
  });

  const [showPanel, setShowPanel] = useState(false);

  // Refs for chart instances - persist across re-renders
  const mainChartRef = useRef(null);
  const rsiChartRef = useRef(null);
  const macdChartRef = useRef(null);
  const stochChartRef = useRef(null);

  // Refs for series - track each indicator series
  const mainSeriesRef = useRef(null);
  const volSeriesRef = useRef(null);
  const indicatorSeriesRef = useRef({}); // { sma20: series, ema12: series, ... }

  // Refs for sub-chart series
  const rsiSeriesRef = useRef(null);
  const macdLineRef = useRef(null);
  const macdSignalRef = useRef(null);
  const macdHistRef = useRef(null);
  const stochKRef = useRef(null);
  const stochDRef = useRef(null);

  // Track current data state
  const dataRef = useRef({ bars: [], times: [], closes: [] });

  // LWC import cache
  const lwcRef = useRef(null);

  const handleToggleIndicator = useCallback((id) => {
    setIndicators(prev => ({ ...prev, [id]: !prev[id] }));
  }, []);

  // ── Build chart instances once ───────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    let mainRO, rsiRO, macdRO, stochRO;

    (async () => {
      const LWC = await import('lightweight-charts');
      if (cancelled) return;
      lwcRef.current = LWC;

      const baseOptions = {
        layout: { background: { color: '#111117' }, textColor: '#555568', fontFamily: "'Geist Mono',monospace", fontSize: 10 },
        grid: { vertLines: { color: 'rgba(56,56,78,0.2)' }, horzLines: { color: 'rgba(56,56,78,0.2)' } },
        crosshair: { vertLine: { color: 'rgba(0,212,255,0.25)', labelBackgroundColor: '#18181f' }, horzLine: { color: 'rgba(0,212,255,0.25)', labelBackgroundColor: '#18181f' } },
        timeScale: { borderColor: '#282835', timeVisible: true, secondsVisible: false },
        rightPriceScale: { borderColor: '#282835' },
      };

      // Main chart
      const mainEl = document.getElementById('main-chart');
      if (mainEl) {
        const chart = LWC.createChart(mainEl, { ...baseOptions, width: mainEl.clientWidth, height: 400 });
        mainChartRef.current = chart;
        mainRO = new ResizeObserver(() => chart.applyOptions({ width: mainEl.clientWidth }));
        mainRO.observe(mainEl);
      }

      // RSI sub-chart
      const rsiEl = document.getElementById('rsi-chart');
      if (rsiEl) {
        const chart = LWC.createChart(rsiEl, { ...baseOptions, width: rsiEl.clientWidth, height: 100, timeScale: { ...baseOptions.timeScale, timeVisible: false } });
        rsiChartRef.current = chart;
        rsiRO = new ResizeObserver(() => chart.applyOptions({ width: rsiEl.clientWidth }));
        rsiRO.observe(rsiEl);
      }

      // MACD sub-chart
      const macdEl = document.getElementById('macd-chart');
      if (macdEl) {
        const chart = LWC.createChart(macdEl, { ...baseOptions, width: macdEl.clientWidth, height: 100, timeScale: { ...baseOptions.timeScale, timeVisible: false } });
        macdChartRef.current = chart;
        macdRO = new ResizeObserver(() => chart.applyOptions({ width: macdEl.clientWidth }));
        macdRO.observe(macdEl);
      }

      // Stochastic sub-chart
      const stochEl = document.getElementById('stoch-chart');
      if (stochEl) {
        const chart = LWC.createChart(stochEl, { ...baseOptions, width: stochEl.clientWidth, height: 100, timeScale: { ...baseOptions.timeScale, timeVisible: false } });
        stochChartRef.current = chart;
        stochRO = new ResizeObserver(() => chart.applyOptions({ width: stochEl.clientWidth }));
        stochRO.observe(stochEl);
      }
    })();

    return () => {
      cancelled = true;
      [mainRO, rsiRO, macdRO, stochRO].forEach(ro => ro?.disconnect());
      [mainChartRef, rsiChartRef, macdChartRef, stochChartRef].forEach(ref => {
        if (ref.current) {
          try { ref.current.remove(); } catch {}
          ref.current = null;
        }
      });
      mainSeriesRef.current = null;
      volSeriesRef.current = null;
      indicatorSeriesRef.current = {};
      rsiSeriesRef.current = null;
      macdLineRef.current = null;
      macdSignalRef.current = null;
      macdHistRef.current = null;
      stochKRef.current = null;
      stochDRef.current = null;
    };
  }, [indicators.rsi14, indicators.macd, indicators.stoch]); // Recreate sub-chart containers when toggled

  // ── Set/update main series based on chart type ───────────────────────────
  useEffect(() => {
    if (!mainChartRef.current || !lwcRef.current) return;
    const chart = mainChartRef.current;

    // Remove old main series
    if (mainSeriesRef.current) {
      try { chart.removeSeries(mainSeriesRef.current); } catch {}
      mainSeriesRef.current = null;
    }

    // Create new series based on chart type
    if (chartType === 'line') {
      mainSeriesRef.current = chart.addLineSeries({ color: '#00d4ff', lineWidth: 2 });
    } else if (chartType === 'area') {
      mainSeriesRef.current = chart.addAreaSeries({ topColor: 'rgba(0,212,255,0.4)', bottomColor: 'rgba(0,212,255,0.02)', lineColor: '#00d4ff', lineWidth: 2 });
    } else if (chartType === 'bar') {
      mainSeriesRef.current = chart.addBarSeries({ upColor: '#00f59b', downColor: '#ff3355' });
    } else {
      // candle and heikin both use candlestick series
      mainSeriesRef.current = chart.addCandlestickSeries({
        upColor: '#00f59b', downColor: '#ff3355',
        borderUpColor: '#00f59b', borderDownColor: '#ff3355',
        wickUpColor: '#00f59b', wickDownColor: '#ff3355',
      });
    }

    // Apply current data if available
    if (dataRef.current.bars.length > 0) {
      applyMainData(dataRef.current.bars, dataRef.current.times);
    }
  }, [chartType]);

  // ── Apply data to main series helper ─────────────────────────────────────
  const applyMainData = useCallback((gaplessBars, times) => {
    if (!mainSeriesRef.current) return;

    if (chartType === 'line' || chartType === 'area') {
      mainSeriesRef.current.setData(gaplessBars.map((b, i) => ({ time: times[i], value: b.c })));
    } else if (chartType === 'heikin') {
      mainSeriesRef.current.setData(toHA(gaplessBars, times));
    } else {
      mainSeriesRef.current.setData(gaplessBars.map((b, i) => ({ time: times[i], open: b.o, high: b.h, low: b.l, close: b.c })));
    }
  }, [chartType]);

  // ── Update data when bars change ─────────────────────────────────────────
  useEffect(() => {
    if (!bars || bars.length === 0 || !mainChartRef.current || !mainSeriesRef.current) return;

    const gaplessBars = filterConsecutiveSessionBars(bars, tf);
    const times = gaplessBars.map(b => toTzEpoch(b.t, tz));
    const closes = gaplessBars.map(b => b.c);

    dataRef.current = { bars: gaplessBars, times, closes };

    // Update main series
    applyMainData(gaplessBars, times);

    // Update volume
    if (indicators.volume && volSeriesRef.current) {
      volSeriesRef.current.setData(gaplessBars.map((b, i) => ({
        time: times[i], value: b.v,
        color: b.c >= b.o ? 'rgba(0,245,155,0.15)' : 'rgba(255,51,85,0.15)',
      })));
    }

    // Update overlay indicators
    Object.entries(indicatorSeriesRef.current).forEach(([id, series]) => {
      if (!series) return;
      updateIndicatorData(id, closes, times);
    });

    // Update sub-chart indicators
    if (indicators.rsi14 && rsiSeriesRef.current) {
      const rsi = calcRSI(closes, 14);
      rsiSeriesRef.current.setData(rsi.map((v, i) => v ? { time: times[i], value: v } : null).filter(Boolean));
    }

    if (indicators.macd && macdLineRef.current) {
      const macd = calcMACD(closes, 12, 26, 9);
      macdLineRef.current.setData(macd.macdLine.map((v, i) => v ? { time: times[i], value: v } : null).filter(Boolean));
      if (macdSignalRef.current) {
        macdSignalRef.current.setData(macd.signalLine.map((v, i) => v ? { time: times[i], value: v } : null).filter(Boolean));
      }
      if (macdHistRef.current) {
        macdHistRef.current.setData(macd.histogram.map((v, i) => v ? {
          time: times[i], value: v,
          color: v > 0 ? 'rgba(0,245,155,0.4)' : 'rgba(255,51,85,0.4)',
        } : null).filter(Boolean));
      }
    }

    if (indicators.stoch && stochKRef.current) {
      const stoch = calcStochastic(closes, 14, 3, 3);
      stochKRef.current.setData(stoch.map((v, i) => v.k ? { time: times[i], value: v.k } : null).filter(Boolean));
      if (stochDRef.current) {
        stochDRef.current.setData(stoch.map((v, i) => v.d ? { time: times[i], value: v.d } : null).filter(Boolean));
      }
    }

    // Only fit content on initial load, not on updates
    if (gaplessBars.length > 0 && mainChartRef.current) {
      const visibleRange = mainChartRef.current.timeScale().getVisibleRange();
      if (!visibleRange) {
        mainChartRef.current.timeScale().fitContent();
      }
    }
  }, [bars, tf, tz, applyMainData, indicators.volume, indicators.rsi14, indicators.macd, indicators.stoch]);

  const updateIndicatorData = useCallback((id, closes, times) => {
    const series = indicatorSeriesRef.current[id];
    if (!series) return;

    if (id === 'sma20') {
      const sma = calcSMA(closes, 20);
      series.setData(sma.map((v, i) => v ? { time: times[i], value: v } : null).filter(Boolean));
    } else if (id === 'sma50') {
      const sma = calcSMA(closes, 50);
      series.setData(sma.map((v, i) => v ? { time: times[i], value: v } : null).filter(Boolean));
    } else if (id === 'ema12') {
      const ema = calcEMA(closes, 12);
      series.setData(ema.map((v, i) => v ? { time: times[i], value: v } : null).filter(Boolean));
    } else if (id === 'ema26') {
      const ema = calcEMA(closes, 26);
      series.setData(ema.map((v, i) => v ? { time: times[i], value: v } : null).filter(Boolean));
    }
  }, []);

  // ── Volume toggle ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mainChartRef.current) return;
    const chart = mainChartRef.current;

    if (indicators.volume) {
      if (!volSeriesRef.current) {
        volSeriesRef.current = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'vol', color: 'rgba(58,122,204,0.3)' });
        chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

        if (dataRef.current.bars.length > 0) {
          const { bars: gb, times } = dataRef.current;
          volSeriesRef.current.setData(gb.map((b, i) => ({
            time: times[i], value: b.v,
            color: b.c >= b.o ? 'rgba(0,245,155,0.15)' : 'rgba(255,51,85,0.15)',
          })));
        }
      }
    } else {
      if (volSeriesRef.current) {
        try { chart.removeSeries(volSeriesRef.current); } catch {}
        volSeriesRef.current = null;
      }
    }
  }, [indicators.volume]);

  // ── Toggle overlay indicators (SMA, EMA, BB) ─────────────────────────────
  useEffect(() => {
    if (!mainChartRef.current) return;
    const chart = mainChartRef.current;

    const overlayDefs = {
      sma20: { color: '#ff8833', lineWidth: 1, type: 'line' },
      sma50: { color: '#9955ff', lineWidth: 1, type: 'line' },
      ema12: { color: '#00d4ff', lineWidth: 1, type: 'line' },
      ema26: { color: '#00f59b', lineWidth: 1, type: 'line' },
    };

    Object.entries(overlayDefs).forEach(([id, def]) => {
      if (indicators[id]) {
        if (!indicatorSeriesRef.current[id]) {
          const series = chart.addLineSeries({ color: def.color, lineWidth: def.lineWidth, crosshairMarkerVisible: false });
          indicatorSeriesRef.current[id] = series;
          if (dataRef.current.closes.length > 0) {
            updateIndicatorData(id, dataRef.current.closes, dataRef.current.times);
          }
        }
      } else {
        if (indicatorSeriesRef.current[id]) {
          try { chart.removeSeries(indicatorSeriesRef.current[id]); } catch {}
          delete indicatorSeriesRef.current[id];
        }
      }
    });

    // Bollinger Bands (3 series)
    if (indicators.bb20) {
      if (!indicatorSeriesRef.current.bbUpper) {
        const upper = chart.addLineSeries({ color: '#ff8833', lineWidth: 1, lineStyle: 2, crosshairMarkerVisible: false });
        const middle = chart.addLineSeries({ color: '#ff8833', lineWidth: 1, lineStyle: 2, crosshairMarkerVisible: false });
        const lower = chart.addLineSeries({ color: '#ff8833', lineWidth: 1, lineStyle: 2, crosshairMarkerVisible: false });
        indicatorSeriesRef.current.bbUpper = upper;
        indicatorSeriesRef.current.bbMiddle = middle;
        indicatorSeriesRef.current.bbLower = lower;
        if (dataRef.current.closes.length > 0) {
          const bb = calcBollingerBands(dataRef.current.closes, 20, 2);
          upper.setData(bb.map((v, i) => v.upper ? { time: dataRef.current.times[i], value: v.upper } : null).filter(Boolean));
          middle.setData(bb.map((v, i) => v.middle ? { time: dataRef.current.times[i], value: v.middle } : null).filter(Boolean));
          lower.setData(bb.map((v, i) => v.lower ? { time: dataRef.current.times[i], value: v.lower } : null).filter(Boolean));
        }
      }
    } else {
      ['bbUpper', 'bbMiddle', 'bbLower'].forEach(key => {
        if (indicatorSeriesRef.current[key]) {
          try { chart.removeSeries(indicatorSeriesRef.current[key]); } catch {}
          delete indicatorSeriesRef.current[key];
        }
      });
    }
  }, [indicators.sma20, indicators.sma50, indicators.ema12, indicators.ema26, indicators.bb20, updateIndicatorData]);

  // ── RSI sub-chart series ─────────────────────────────────────────────────
  useEffect(() => {
    if (!indicators.rsi14 || !rsiChartRef.current) return;
    const chart = rsiChartRef.current;

    if (!rsiSeriesRef.current) {
      rsiSeriesRef.current = chart.addLineSeries({ color: '#00d4ff', lineWidth: 1.5 });
      if (dataRef.current.closes.length > 0) {
        const rsi = calcRSI(dataRef.current.closes, 14);
        rsiSeriesRef.current.setData(rsi.map((v, i) => v ? { time: dataRef.current.times[i], value: v } : null).filter(Boolean));
      }
    }
  }, [indicators.rsi14]);

  // ── MACD sub-chart series ────────────────────────────────────────────────
  useEffect(() => {
    if (!indicators.macd || !macdChartRef.current) return;
    const chart = macdChartRef.current;

    if (!macdLineRef.current) {
      macdLineRef.current = chart.addLineSeries({ color: '#00d4ff', lineWidth: 1.5 });
      macdSignalRef.current = chart.addLineSeries({ color: '#ff8833', lineWidth: 1 });
      macdHistRef.current = chart.addHistogramSeries({ color: '#00f59b' });

      if (dataRef.current.closes.length > 0) {
        const macd = calcMACD(dataRef.current.closes, 12, 26, 9);
        const t = dataRef.current.times;
        macdLineRef.current.setData(macd.macdLine.map((v, i) => v ? { time: t[i], value: v } : null).filter(Boolean));
        macdSignalRef.current.setData(macd.signalLine.map((v, i) => v ? { time: t[i], value: v } : null).filter(Boolean));
        macdHistRef.current.setData(macd.histogram.map((v, i) => v ? {
          time: t[i], value: v,
          color: v > 0 ? 'rgba(0,245,155,0.4)' : 'rgba(255,51,85,0.4)',
        } : null).filter(Boolean));
      }
    }
  }, [indicators.macd]);

  // ── Stochastic sub-chart series ──────────────────────────────────────────
  useEffect(() => {
    if (!indicators.stoch || !stochChartRef.current) return;
    const chart = stochChartRef.current;

    if (!stochKRef.current) {
      stochKRef.current = chart.addLineSeries({ color: '#00d4ff', lineWidth: 1.5 });
      stochDRef.current = chart.addLineSeries({ color: '#ff8833', lineWidth: 1 });

      if (dataRef.current.closes.length > 0) {
        const stoch = calcStochastic(dataRef.current.closes, 14, 3, 3);
        const t = dataRef.current.times;
        stochKRef.current.setData(stoch.map((v, i) => v.k ? { time: t[i], value: v.k } : null).filter(Boolean));
        stochDRef.current.setData(stoch.map((v, i) => v.d ? { time: t[i], value: v.d } : null).filter(Boolean));
      }
    }
  }, [indicators.stoch]);

  const activeCount = Object.values(indicators).filter(Boolean).length;

  return (
    <div className="cwi-container">
      <div className="cwi-controls">
        {/* Timeframe Switch */}
        <div className="cwi-group">
          {TIMEFRAMES.map(t => (
            <button
              key={t.id}
              className={`cwi-tf ${tf === t.id ? 'a' : ''}`}
              onClick={() => onTfChange?.(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <span className="cwi-sep">|</span>

        {/* Chart Type Switch */}
        <div className="cwi-group">
          {CHART_TYPES.map(c => (
            <button
              key={c.id}
              className={`cwi-tf ${chartType === c.id ? 'a' : ''}`}
              onClick={() => onChartTypeChange?.(c.id)}
            >
              {c.label}
            </button>
          ))}
        </div>

        <span className="cwi-sep">|</span>

        <button
          className="cwi-tf cwi-ind-btn"
          onClick={() => setShowPanel(!showPanel)}
          title="Toggle Indicator Panel"
        >
          ⚙ Indicators ({activeCount})
        </button>

        {showPanel && (
          <IndicatorPanel indicators={indicators} onToggle={handleToggleIndicator} />
        )}
      </div>

      <div className="cwi-wrapper">
        <div id="main-chart" className="cwi-main" />
        {indicators.rsi14 && (
          <div className="cwi-sub-wrapper">
            <div className="cwi-sub-label">RSI (14)</div>
            <div id="rsi-chart" className="cwi-sub" />
          </div>
        )}
        {indicators.macd && (
          <div className="cwi-sub-wrapper">
            <div className="cwi-sub-label">MACD (12, 26, 9)</div>
            <div id="macd-chart" className="cwi-sub" />
          </div>
        )}
        {indicators.stoch && (
          <div className="cwi-sub-wrapper">
            <div className="cwi-sub-label">Stochastic (14, 3, 3)</div>
            <div id="stoch-chart" className="cwi-sub" />
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
        .cwi-group {
          display: flex;
          gap: 4px;
        }
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
        .cwi-tf:hover {
          border-color: var(--neon-cyan);
          color: var(--mist);
        }
        .cwi-tf.a {
          background: var(--neon-cyan);
          border-color: var(--neon-cyan);
          color: var(--void);
          font-weight: 700;
        }
        .cwi-sep {
          color: var(--ash);
          font-size: 14px;
          margin: 0 4px;
          user-select: none;
        }
        .cwi-ind-btn {
          margin-left: auto;
        }
        .cwi-wrapper {
          display: flex;
          flex-direction: column;
        }
        .cwi-main {
          width: 100%;
          height: 400px;
          border-bottom: 1px solid var(--border);
        }
        .cwi-sub-wrapper {
          position: relative;
          border-bottom: 1px solid var(--border);
        }
        .cwi-sub-wrapper:last-child {
          border-bottom: none;
        }
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
        .cwi-sub {
          width: 100%;
          height: 100px;
        }
      `}</style>
    </div>
  );
}