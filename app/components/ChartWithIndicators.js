'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import {
  calcSMA, calcEMA, calcRSI, calcMACD, calcBollingerBands,
  calcATR, calcStochastic, normalizeVolume, filterConsecutiveSessionBars,
} from '../lib/advancedIndicators';
import IndicatorPanel from './IndicatorPanel';

function toTzEpoch(isoStr, tz) {
  const d = new Date(isoStr);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const p = {};
  fmt.formatToParts(d).forEach(x => { p[x.type] = x.value; });
  const tzAsUtc = Date.UTC(+p.year, +p.month - 1, +p.day, p.hour === '24' ? 0 : +p.hour, +p.minute, +p.second);
  return Math.floor(tzAsUtc / 1000);
}

export default function ChartWithIndicators({ bars = [], tf = '1Min', tz = 'America/New_York', chartType = 'candle' }) {
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
  const chartRef = useRef(null);
  const mainChartRef = useRef(null);
  const rsiChartRef = useRef(null);
  const macdChartRef = useRef(null);
  const volumeChartRef = useRef(null);

  const handleToggleIndicator = useCallback((id) => {
    setIndicators(prev => ({
      ...prev,
      [id]: !prev[id],
    }));
  }, []);

  useEffect(() => {
    if (!bars || bars.length === 0 || !chartRef.current) return;

    (async () => {
      const LWC = await import('lightweight-charts');

      // Clean up old charts
      [mainChartRef, rsiChartRef, macdChartRef, volumeChartRef].forEach(ref => {
        if (ref.current?.instance) {
          try { ref.current.instance.remove(); } catch {}
        }
      });

      // Filter gapless bars
      const gaplessData = filterConsecutiveSessionBars(bars, tf);
      const closes = gaplessData.map(b => b.c);
      const times = gaplessData.map(b => toTzEpoch(b.t, tz));

      // Create main chart
      const mainEl = document.getElementById('main-chart');
      if (!mainEl) return;

      const mainChart = LWC.createChart(mainEl, {
        width: mainEl.clientWidth,
        height: 400,
        layout: {
          background: { color: '#111117' },
          textColor: '#555568',
          fontFamily: "'Geist Mono',monospace",
          fontSize: 10,
        },
        grid: {
          vertLines: { color: 'rgba(56,56,78,0.2)' },
          horzLines: { color: 'rgba(56,56,78,0.2)' },
        },
        crosshair: {
          vertLine: { color: 'rgba(0,212,255,0.25)', labelBackgroundColor: '#18181f' },
          horzLine: { color: 'rgba(0,212,255,0.25)', labelBackgroundColor: '#18181f' },
        },
        timeScale: { borderColor: '#282835', timeVisible: true, secondsVisible: false },
        rightPriceScale: { borderColor: '#282835' },
      });

      mainChartRef.current = { instance: mainChart };

      // Main candlestick series
      const mainSeries = mainChart.addCandlestickSeries({
        upColor: '#00f59b',
        downColor: '#ff3355',
        borderUpColor: '#00f59b',
        borderDownColor: '#ff3355',
        wickUpColor: '#00f59b',
        wickDownColor: '#ff3355',
      });

      const candleData = gaplessData.map((b, i) => ({
        time: times[i],
        open: b.o,
        high: b.h,
        low: b.l,
        close: b.c,
      }));

      mainSeries.setData(candleData);

      // Add volume series
      if (indicators.volume) {
        const volSeries = mainChart.addHistogramSeries({
          priceFormat: { type: 'volume' },
          priceScaleId: 'vol',
          color: 'rgba(58, 122, 204, 0.3)',
        });
        mainChart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

        const volumeData = gaplessData.map((b, i) => ({
          time: times[i],
          value: b.v,
          color: b.c >= b.o ? 'rgba(0,245,155,0.15)' : 'rgba(255,51,85,0.15)',
        }));

        volSeries.setData(volumeData);
      }

      // Add Moving Averages and Bollinger Bands
      if (indicators.sma20) {
        const sma20 = calcSMA(closes, 20);
        const smaSeries = mainChart.addLineSeries({ color: '#ff8833', lineWidth: 1 });
        smaSeries.setData(sma20.map((v, i) => v ? { time: times[i], value: v } : null).filter(Boolean));
      }

      if (indicators.sma50) {
        const sma50 = calcSMA(closes, 50);
        const smaSeries = mainChart.addLineSeries({ color: '#9955ff', lineWidth: 1 });
        smaSeries.setData(sma50.map((v, i) => v ? { time: times[i], value: v } : null).filter(Boolean));
      }

      if (indicators.ema12) {
        const ema12 = calcEMA(closes, 12);
        const emaSeries = mainChart.addLineSeries({ color: '#00d4ff', lineWidth: 1 });
        emaSeries.setData(ema12.map((v, i) => v ? { time: times[i], value: v } : null).filter(Boolean));
      }

      if (indicators.ema26) {
        const ema26 = calcEMA(closes, 26);
        const emaSeries = mainChart.addLineSeries({ color: '#00f59b', lineWidth: 1 });
        emaSeries.setData(ema26.map((v, i) => v ? { time: times[i], value: v } : null).filter(Boolean));
      }

      if (indicators.bb20) {
        const bb = calcBollingerBands(closes, 20, 2);
        const bbSeries = mainChart.addLineSeries({ color: '#ff8833', lineWidth: 1, lineStyle: 2 });
        bbSeries.setData(bb.map((v, i) => v.upper ? { time: times[i], value: v.upper } : null).filter(Boolean));

        const bbMid = mainChart.addLineSeries({ color: '#ff8833', lineWidth: 1, lineStyle: 2 });
        bbMid.setData(bb.map((v, i) => v.middle ? { time: times[i], value: v.middle } : null).filter(Boolean));

        const bbLower = mainChart.addLineSeries({ color: '#ff8833', lineWidth: 1, lineStyle: 2 });
        bbLower.setData(bb.map((v, i) => v.lower ? { time: times[i], value: v.lower } : null).filter(Boolean));
      }

      mainChart.timeScale().fitContent();

      // RSI Sub-chart
      if (indicators.rsi14) {
        const rsiEl = document.getElementById('rsi-chart');
        if (rsiEl) {
          const rsiChart = LWC.createChart(rsiEl, {
            width: rsiEl.clientWidth,
            height: 100,
            layout: { background: { color: '#111117' }, textColor: '#555568' },
            grid: { vertLines: { color: 'rgba(56,56,78,0.2)' }, horzLines: { color: 'rgba(56,56,78,0.2)' } },
            timeScale: { borderColor: '#282835', timeVisible: false },
            rightPriceScale: { borderColor: '#282835' },
          });

          rsiChartRef.current = { instance: rsiChart };

          const rsi = calcRSI(closes, 14);
          const rsiSeries = rsiChart.addLineSeries({ color: '#00d4ff', lineWidth: 1.5 });
          rsiSeries.setData(rsi.map((v, i) => v ? { time: times[i], value: v } : null).filter(Boolean));

          // Add overbought/oversold lines
          rsiChart.addHistogramSeries({ color: 'rgba(0,245,155,0.1)' }).setData(
            times.map((t, i) => ({ time: t, value: 70 }))
          );

          rsiChart.timeScale().fitContent();
        }
      }

      // MACD Sub-chart
      if (indicators.macd) {
        const macdEl = document.getElementById('macd-chart');
        if (macdEl) {
          const macdChart = LWC.createChart(macdEl, {
            width: macdEl.clientWidth,
            height: 100,
            layout: { background: { color: '#111117' }, textColor: '#555568' },
            grid: { vertLines: { color: 'rgba(56,56,78,0.2)' }, horzLines: { color: 'rgba(56,56,78,0.2)' } },
            timeScale: { borderColor: '#282835', timeVisible: false },
            rightPriceScale: { borderColor: '#282835' },
          });

          macdChartRef.current = { instance: macdChart };

          const macd = calcMACD(closes, 12, 26, 9);

          const macdSeries = macdChart.addLineSeries({ color: '#00d4ff', lineWidth: 1.5 });
          macdSeries.setData(macd.macdLine.map((v, i) => v ? { time: times[i], value: v } : null).filter(Boolean));

          const signalSeries = macdChart.addLineSeries({ color: '#ff8833', lineWidth: 1 });
          signalSeries.setData(macd.signalLine.map((v, i) => v ? { time: times[i], value: v } : null).filter(Boolean));

          const histoSeries = macdChart.addHistogramSeries({ color: '#00f59b' });
          histoSeries.setData(macd.histogram.map((v, i) => v ? {
            time: times[i],
            value: v,
            color: v > 0 ? 'rgba(0,245,155,0.4)' : 'rgba(255,51,85,0.4)',
          } : null).filter(Boolean));

          macdChart.timeScale().fitContent();
        }
      }
    })();
  }, [bars, indicators, tf, tz]);

  return (
    <div className="cwi-container">
      <div className="cwi-controls">
        <button
          className="cwi-btn"
          onClick={() => setShowPanel(!showPanel)}
          title="Toggle Indicator Panel"
        >
          ⚙️ Indicators {Object.values(indicators).filter(Boolean).length > 0 && `(${Object.values(indicators).filter(Boolean).length})`}
        </button>

        {showPanel && (
          <IndicatorPanel indicators={indicators} onToggle={handleToggleIndicator} />
        )}
      </div>

      <div ref={chartRef} className="cwi-wrapper">
        {/* Main Chart */}
        <div id="main-chart" className="cwi-main" />

        {/* Sub-Charts */}
        {indicators.rsi14 && <div id="rsi-chart" className="cwi-sub">RSI (14)</div>}
        {indicators.macd && <div id="macd-chart" className="cwi-sub">MACD</div>}
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
          gap: 10px;
          padding: 10px 16px;
          border-bottom: 1px solid var(--border);
          background: rgba(11, 11, 16, 0.5);
          position: relative;
        }

        .cwi-btn {
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

        .cwi-btn:hover {
          border-color: var(--neon-cyan);
          color: var(--mist);
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

        .cwi-sub {
          width: 100%;
          height: 100px;
          border-bottom: 1px solid var(--border);
          font-family: var(--mono);
          font-size: 10px;
          color: var(--ash);
          padding: 4px 16px;
          position: relative;
        }

        .cwi-sub:last-child {
          border-bottom: none;
        }
      `}</style>
    </div>
  );
}