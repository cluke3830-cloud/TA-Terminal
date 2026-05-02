// Advanced Indicator Library for TradingView-like Charts

export function calcSMA(closes, period) {
  const result = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      result.push(null);
    } else {
      const sum = closes.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
      result.push(sum / period);
    }
  }
  return result;
}

export function calcEMA(closes, period) {
  const result = [];
  const k = 2 / (period + 1);
  let ema = null;

  for (let i = 0; i < closes.length; i++) {
    if (ema === null) {
      if (i === period - 1) {
        const sum = closes.slice(0, period).reduce((a, b) => a + b, 0);
        ema = sum / period;
        result.push(ema);
      } else {
        result.push(null);
      }
    } else {
      ema = closes[i] * k + ema * (1 - k);
      result.push(ema);
    }
  }

  return result;
}

export function calcRSI(closes, period = 14) {
  const changes = [];
  for (let i = 1; i < closes.length; i++) {
    changes.push(closes[i] - closes[i - 1]);
  }

  const rsi = [];
  for (let i = 0; i < period - 1; i++) rsi.push(null);

  let gains = 0, losses = 0;
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) gains += changes[i];
    else losses -= changes[i];
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  const firstRsi = 100 - (100 / (1 + avgGain / avgLoss));
  rsi.push(firstRsi);

  for (let i = period; i < changes.length; i++) {
    avgGain = (avgGain * (period - 1) + (changes[i] > 0 ? changes[i] : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (changes[i] < 0 ? -changes[i] : 0)) / period;
    rsi.push(100 - (100 / (1 + avgGain / avgLoss)));
  }

  return rsi;
}

export function calcMACD(closes, fast = 12, slow = 26, signal = 9) {
  const emaFast = calcEMA(closes, fast);
  const emaSlow = calcEMA(closes, slow);

  const macdLine = [];
  for (let i = 0; i < closes.length; i++) {
    if (emaFast[i] && emaSlow[i]) {
      macdLine.push(emaFast[i] - emaSlow[i]);
    } else {
      macdLine.push(null);
    }
  }

  const signalLine = calcEMA(macdLine, signal);

  const histogram = [];
  for (let i = 0; i < macdLine.length; i++) {
    if (macdLine[i] && signalLine[i]) {
      histogram.push(macdLine[i] - signalLine[i]);
    } else {
      histogram.push(null);
    }
  }

  return { macdLine, signalLine, histogram };
}

export function calcBollingerBands(closes, period = 20, stdDev = 2) {
  const sma = calcSMA(closes, period);
  const bands = [];

  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1 || !sma[i]) {
      bands.push({ upper: null, middle: null, lower: null });
      continue;
    }

    const slice = closes.slice(i - period + 1, i + 1);
    const mean = sma[i];
    const variance = slice.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / period;
    const std = Math.sqrt(variance);

    bands.push({
      middle: mean,
      upper: mean + stdDev * std,
      lower: mean - stdDev * std,
    });
  }

  return bands;
}

export function calcATR(bars, period = 14) {
  const trs = [];

  for (let i = 0; i < bars.length; i++) {
    const { h, l, c } = bars[i];
    let tr;

    if (i === 0) {
      tr = h - l;
    } else {
      const prevC = bars[i - 1].c;
      tr = Math.max(h - l, Math.abs(h - prevC), Math.abs(l - prevC));
    }

    trs.push(tr);
  }

  const atr = [];
  let sum = 0;

  for (let i = 0; i < trs.length; i++) {
    if (i < period - 1) {
      atr.push(null);
      sum += trs[i];
    } else if (i === period - 1) {
      sum += trs[i];
      atr.push(sum / period);
    } else {
      const prevAtr = atr[i - 1];
      atr.push((prevAtr * (period - 1) + trs[i]) / period);
    }
  }

  return atr;
}

export function calcStochastic(closes, period = 14, smoothK = 3, smoothD = 3) {
  const k = [];
  const d = [];

  for (let i = period - 1; i < closes.length; i++) {
    const slice = closes.slice(i - period + 1, i + 1);
    const low = Math.min(...slice);
    const high = Math.max(...slice);
    const close = closes[i];

    k.push((close - low) / (high - low) * 100);
  }

  const smoothedK = calcSMA(k, smoothK);
  const smoothedD = calcSMA(smoothedK, smoothD);

  const result = [];
  for (let i = 0; i < period - 1; i++) {
    result.push({ k: null, d: null });
  }

  for (let i = 0; i < smoothedK.length; i++) {
    result.push({
      k: smoothedK[i],
      d: smoothedD[i],
    });
  }

  return result;
}

export function normalizeVolume(volumes) {
  const max = Math.max(...volumes);
  const min = Math.min(...volumes);
  const range = max - min;

  return volumes.map(v => {
    if (range === 0) return 0.5;
    return ((v - min) / range) * 100;
  });
}

export function removeGaps(bars) {
  if (!bars || bars.length === 0) return [];

  const gaplessData = [];
  const seenDates = new Set();

  for (const bar of bars) {
    const barDate = bar.t.slice(0, 10); // YYYY-MM-DD

    if (!seenDates.has(barDate)) {
      gaplessData.push(bar);
      seenDates.add(barDate);
    } else {
      // Same date, update the bar
      const lastIdx = gaplessData.findIndex(b => b.t.slice(0, 10) === barDate);
      if (lastIdx !== -1) {
        gaplessData[lastIdx] = bar;
      }
    }
  }

  return gaplessData;
}

export function filterConsecutiveSessionBars(bars, tf) {
  // For intraday, keep all bars that are part of continuous sessions
  // Remove only truly gapped periods (weekends, market close to open)

  if (!bars || bars.length === 0) return [];

  const filtered = [];
  let lastTime = null;

  for (const bar of bars) {
    if (lastTime === null) {
      filtered.push(bar);
      lastTime = new Date(bar.t).getTime();
    } else {
      const currentTime = new Date(bar.t).getTime();
      const timeDiff = currentTime - lastTime;

      // For intraday data: if gap is > 24 hours, it's likely a weekend/close-to-open
      // For daily data: always include (shouldn't be gaps)
      const isWeekend = timeDiff > 24 * 60 * 60 * 1000;

      if (!isWeekend || tf === '1Day') {
        filtered.push(bar);
        lastTime = currentTime;
      }
    }
  }

  return filtered;
}