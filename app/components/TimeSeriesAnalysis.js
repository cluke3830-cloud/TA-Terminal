'use client';
import { useMemo } from 'react';
import {
  calcRSI, calcMACD, calcBollingerBands, calcATR,
  calcVolatility, calcTimeSeriesStats, calcPivots,
  calcSupport, calcResistance, calcEMA,
} from '../lib/technicalIndicators';

function fmt(n, d = 2) {
  if (n == null || isNaN(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e12) return (n / 1e12).toFixed(d) + 'T';
  if (a >= 1e9) return (n / 1e9).toFixed(d) + 'B';
  if (a >= 1e6) return (n / 1e6).toFixed(d) + 'M';
  if (a >= 1e3) return (n / 1e3).toFixed(d) + 'K';
  return n.toFixed(d);
}

export default function TimeSeriesAnalysis({ bars = [] }) {
  const analysis = useMemo(() => {
    if (!bars || bars.length < 20) return null;

    const closes = bars.map(b => b.c);
    const rsi = calcRSI(closes, 14);
    const macd = calcMACD(closes, 12, 26, 9);
    const bb = calcBollingerBands(closes, 20, 2);
    const atr = calcATR(bars, 14);
    const volatility = calcVolatility(closes, 20);
    const stats = calcTimeSeriesStats(closes);
    const pivots = calcPivots(bars);
    const support = calcSupport(closes, 20);
    const resistance = calcResistance(closes, 20);
    const ema20 = calcEMA(closes, 20);

    const lastIdx = bars.length - 1;
    const rsiVal = rsi[lastIdx];
    const macdVal = macd.macdLine[lastIdx];
    const macdSignal = macd.signalLine[lastIdx];
    const macdHist = macd.histogram[lastIdx];
    const bbVal = bb[lastIdx];
    const atrVal = atr[lastIdx];
    const volVal = volatility[volatility.length - 1];
    const ema20Val = ema20[lastIdx];

    return {
      momentum: { rsi: rsiVal, macd: macdVal, signal: macdSignal, histogram: macdHist },
      volatility: { atr: atrVal, annualized: volVal },
      bands: bbVal,
      stats,
      pivots,
      support,
      resistance,
      ema20: ema20Val,
      lastBar: bars[lastIdx],
      prevBar: bars[lastIdx - 1],
    };
  }, [bars]);

  if (!analysis) {
    return <div className="tsa">Insufficient data for analysis</div>;
  }

  const {
    momentum, volatility, bands, stats, pivots, support,
    resistance, ema20, lastBar, prevBar,
  } = analysis;

  const rsiStatus = momentum.rsi > 70 ? 'overbought' : momentum.rsi < 30 ? 'oversold' : 'neutral';
  const macdSignal = momentum.histogram > 0 ? 'bullish' : 'bearish';
  const bbSignal = lastBar.c > bands.upper ? 'above' : lastBar.c < bands.lower ? 'below' : 'neutral';
  const trendSignal = stats.price.current > ema20 ? 'above' : 'below';
  const supportLevel = support.support;
  const resistanceLevel = resistance.resistance;
  const distToSupport = supportLevel ? ((lastBar.c - supportLevel) / lastBar.c * 100) : null;
  const distToResistance = resistanceLevel ? ((resistanceLevel - lastBar.c) / lastBar.c * 100) : null;

  return (
    <div className="tsa">
      <div className="tsa-row">
        <div className="tsa-col">
          <div className="tsa-sec">
            <div className="tsa-h">Momentum (RSI)</div>
            <div className="tsa-stat">
              <div className="tsa-val">{momentum.rsi?.toFixed(2) || '—'}</div>
              <div className={`tsa-lbl rsi-${rsiStatus}`}>{rsiStatus.toUpperCase()}</div>
            </div>
          </div>
        </div>

        <div className="tsa-col">
          <div className="tsa-sec">
            <div className="tsa-h">Trend (MACD)</div>
            <div className="tsa-stat">
              <div className="tsa-val">{momentum.histogram?.toFixed(4) || '—'}</div>
              <div className={`tsa-lbl macd-${macdSignal}`}>{macdSignal.toUpperCase()}</div>
            </div>
          </div>
        </div>

        <div className="tsa-col">
          <div className="tsa-sec">
            <div className="tsa-h">Volatility (ATR)</div>
            <div className="tsa-stat">
              <div className="tsa-val">{volatility.atr?.toFixed(4) || '—'}</div>
              <div className="tsa-lbl">{(volatility.annualized * 100)?.toFixed(1) || '—'}% Ann.</div>
            </div>
          </div>
        </div>

        <div className="tsa-col">
          <div className="tsa-sec">
            <div className="tsa-h">Price vs EMA20</div>
            <div className="tsa-stat">
              <div className="tsa-val">${lastBar.c?.toFixed(2) || '—'}</div>
              <div className={`tsa-lbl ema-${trendSignal}`}>{trendSignal.toUpperCase()}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="tsa-row">
        <div className="tsa-col">
          <div className="tsa-sec">
            <div className="tsa-h">Bollinger Bands</div>
            <table className="tsa-table">
              <tbody>
                <tr><td>Upper</td><td>${bands.upper?.toFixed(2)}</td></tr>
                <tr><td>Middle</td><td>${bands.middle?.toFixed(2)}</td></tr>
                <tr><td>Lower</td><td>${bands.lower?.toFixed(2)}</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="tsa-col">
          <div className="tsa-sec">
            <div className="tsa-h">Support & Resistance</div>
            <table className="tsa-table">
              <tbody>
                <tr><td>Resistance</td><td>${resistanceLevel?.toFixed(2)}</td><td className="tsa-dist">{distToResistance?.toFixed(2)}%</td></tr>
                <tr><td>Current</td><td className={lastBar.c >= prevBar.c ? 'vg' : 'vr'}>${lastBar.c?.toFixed(2)}</td></tr>
                <tr><td>Support</td><td>${supportLevel?.toFixed(2)}</td><td className="tsa-dist">{distToSupport?.toFixed(2)}%</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="tsa-col">
          <div className="tsa-sec">
            <div className="tsa-h">Pivot Points</div>
            <table className="tsa-table">
              <tbody>
                <tr><td>R2</td><td>${pivots.r2?.toFixed(2)}</td></tr>
                <tr><td>R1</td><td>${pivots.r1?.toFixed(2)}</td></tr>
                <tr><td>P</td><td className="pivot-p">${pivots.p?.toFixed(2)}</td></tr>
                <tr><td>S1</td><td>${pivots.s1?.toFixed(2)}</td></tr>
                <tr><td>S2</td><td>${pivots.s2?.toFixed(2)}</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="tsa-col">
          <div className="tsa-sec">
            <div className="tsa-h">Price Statistics</div>
            <table className="tsa-table">
              <tbody>
                <tr><td>Mean</td><td>${stats.price.mean?.toFixed(2)}</td></tr>
                <tr><td>Min (20d)</td><td>${stats.price.min?.toFixed(2)}</td></tr>
                <tr><td>Max (20d)</td><td>${stats.price.max?.toFixed(2)}</td></tr>
                <tr><td>Std Dev</td><td>${stats.price.stdDev?.toFixed(2)}</td></tr>
                <tr><td>Daily Return</td><td className={stats.returns.mean > 0 ? 'vg' : 'vr'}>{(stats.returns.mean * 100)?.toFixed(3)}%</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <style jsx>{`
        .tsa { padding: 16px; background: #1a1a1f; border-radius: 8px; }
        .tsa-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; margin-bottom: 12px; }
        .tsa-col { }
        .tsa-sec { background: rgba(56, 56, 78, 0.3); padding: 12px; border-radius: 6px; border: 1px solid rgba(56, 56, 78, 0.5); }
        .tsa-h { font-size: 11px; font-weight: 600; color: #888; text-transform: uppercase; margin-bottom: 8px; letter-spacing: 0.5px; }
        .tsa-stat { display: flex; flex-direction: column; gap: 4px; }
        .tsa-val { font-size: 18px; font-weight: 600; color: #00d4ff; }
        .tsa-lbl { font-size: 11px; color: #999; }
        .rsi-overbought { color: #ff3355; }
        .rsi-oversold { color: #00f59b; }
        .rsi-neutral { color: #ff8833; }
        .macd-bullish { color: #00f59b; }
        .macd-bearish { color: #ff3355; }
        .ema-above { color: #00f59b; }
        .ema-below { color: #ff3355; }
        .tsa-table { width: 100%; font-size: 12px; }
        .tsa-table td { padding: 4px 0; color: #bbb; }
        .tsa-table td:last-child { text-align: right; color: #00d4ff; }
        .tsa-table tr:hover { background: rgba(0, 212, 255, 0.1); }
        .tsa-dist { color: #999; font-size: 10px; }
        .pivot-p { color: #ff8833; font-weight: 600; }
        .vg { color: #00f59b; }
        .vr { color: #ff3355; }
      `}</style>
    </div>
  );
}