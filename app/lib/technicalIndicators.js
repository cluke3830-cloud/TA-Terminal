// ═══════════════════════════════════════════════════════════════════════════
// Technical Indicators Library for Time Series Analysis
// ═══════════════════════════════════════════════════════════════════════════

export function calcEMA(vals, p) {
  const out = []; const k = 2 / (p + 1); let prev = null;
  for (let i = 0; i < vals.length; i++) {
    if (vals[i] == null) { out.push(null); continue; }
    if (prev === null) {
      const w = vals.slice(Math.max(0, i - p + 1), i + 1).filter(v => v != null);
      if (w.length >= p) { prev = w.reduce((a, b) => a + b, 0) / p; out.push(prev); }
      else out.push(null);
    } else { prev = vals[i] * k + prev * (1 - k); out.push(prev); }
  }
  return out;
}

export function calcSMA(vals, p) {
  const out = [];
  for (let i = 0; i < vals.length; i++) {
    if (i < p - 1) { out.push(null); continue; }
    const w = vals.slice(i - p + 1, i + 1).filter(v => v != null);
    out.push(w.length === p ? w.reduce((a, b) => a + b, 0) / p : null);
  }
  return out;
}

export function calcRSI(closes, period = 14) {
  const changes = [];
  for (let i = 1; i < closes.length; i++) {
    changes.push(closes[i] - closes[i - 1]);
  }

  const gains = [];
  const losses = [];
  let avgGain = 0, avgLoss = 0;

  for (let i = 0; i < changes.length; i++) {
    const change = changes[i];
    if (i < period) {
      if (change > 0) gains.push(change);
      else losses.push(-change);
    } else {
      avgGain = (gains.reduce((a, b) => a + b, 0) + (change > 0 ? change : 0)) / period;
      avgLoss = (losses.reduce((a, b) => a + b, 0) + (change < 0 ? -change : 0)) / period;
    }
  }

  const out = [];
  for (let i = 0; i < period - 1; i++) out.push(null);

  let prevAvgGain = gains.reduce((a, b) => a + b, 0) / period;
  let prevAvgLoss = losses.reduce((a, b) => a + b, 0) / period;

  for (let i = period - 1; i < changes.length; i++) {
    const change = changes[i];
    const currentGain = change > 0 ? change : 0;
    const currentLoss = change < 0 ? -change : 0;

    prevAvgGain = (prevAvgGain * (period - 1) + currentGain) / period;
    prevAvgLoss = (prevAvgLoss * (period - 1) + currentLoss) / period;

    const rs = prevAvgLoss === 0 ? 100 : prevAvgGain / prevAvgLoss;
    out.push(100 - (100 / (1 + rs)));
  }

  return out;
}

export function calcMACD(closes, fast = 12, slow = 26, signal = 9) {
  const emaFast = calcEMA(closes, fast);
  const emaSlow = calcEMA(closes, slow);

  const macdLine = [];
  const startIdx = slow - 1;
  for (let i = 0; i < startIdx; i++) macdLine.push(null);
  for (let i = startIdx; i < emaFast.length; i++) {
    macdLine.push((emaFast[i] || 0) - (emaSlow[i] || 0));
  }

  const signalLine = calcEMA(macdLine, signal);

  const histogram = [];
  for (let i = 0; i < macdLine.length; i++) {
    const mac = macdLine[i];
    const sig = signalLine[i];
    histogram.push((mac != null && sig != null) ? mac - sig : null);
  }

  return { macdLine, signalLine, histogram };
}

export function calcBollingerBands(closes, period = 20, stdDev = 2) {
  const sma = calcSMA(closes, period);
  const bands = [];

  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1 || !sma[i]) {
      bands.push({ middle: null, upper: null, lower: null });
      continue;
    }

    const slice = closes.slice(i - period + 1, i + 1);
    const mean = sma[i];
    const variance = slice.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / period;
    const std = Math.sqrt(variance);

    bands.push({
      middle: +mean.toFixed(4),
      upper: +(mean + stdDev * std).toFixed(4),
      lower: +(mean - stdDev * std).toFixed(4),
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
      const newAtr = (prevAtr * (period - 1) + trs[i]) / period;
      atr.push(newAtr);
    }
  }

  return atr;
}

export function calcVolatility(closes, period = 20) {
  const returns = [];
  for (let i = 1; i < closes.length; i++) {
    returns.push(Math.log(closes[i] / closes[i - 1]));
  }

  const volatilities = [];
  for (let i = 0; i < returns.length; i++) {
    if (i < period - 1) {
      volatilities.push(null);
      continue;
    }

    const slice = returns.slice(i - period + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / period;
    const stdDev = Math.sqrt(variance);
    volatilities.push(stdDev * Math.sqrt(252)); // annualized
  }

  return volatilities;
}

export function calcTimeSeriesStats(closes) {
  const n = closes.length;
  if (n === 0) return null;

  const mean = closes.reduce((a, b) => a + b, 0) / n;
  const variance = closes.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / n;
  const stdDev = Math.sqrt(variance);

  const returns = [];
  for (let i = 1; i < n; i++) {
    returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  }

  const sortedClosses = [...closes].sort((a, b) => a - b);
  const median = n % 2 === 0
    ? (sortedClosses[n / 2 - 1] + sortedClosses[n / 2]) / 2
    : sortedClosses[Math.floor(n / 2)];

  const returnStats = {
    mean: returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0,
    stdDev: returns.length > 0
      ? Math.sqrt(returns.reduce((sum, val) => sum + Math.pow(val - (returns.reduce((a, b) => a + b, 0) / returns.length), 2), 0) / returns.length)
      : 0,
  };

  return {
    price: {
      current: closes[n - 1],
      mean,
      median,
      min: Math.min(...closes),
      max: Math.max(...closes),
      stdDev,
      range: Math.max(...closes) - Math.min(...closes),
    },
    returns: returnStats,
    trend: closes[n - 1] > mean ? 'above' : closes[n - 1] < mean ? 'below' : 'at',
  };
}

export function calcPivots(bars) {
  if (bars.length === 0) return [];

  const last = bars[bars.length - 1];
  const h = last.h;
  const l = last.l;
  const c = last.c;

  const p = (h + l + c) / 3;
  const r1 = 2 * p - l;
  const s1 = 2 * p - h;
  const r2 = p + (h - l);
  const s2 = p - (h - l);

  return { p: +p.toFixed(4), r1: +r1.toFixed(4), s1: +s1.toFixed(4), r2: +r2.toFixed(4), s2: +s2.toFixed(4) };
}

export function calcSupport(closes, period = 20) {
  if (closes.length < period) return null;

  const recentClosses = closes.slice(-period);
  const minClose = Math.min(...recentClosses);
  const avgClose = recentClosses.reduce((a, b) => a + b, 0) / period;

  return {
    support: +minClose.toFixed(4),
    avgSupport: +avgClose.toFixed(4),
  };
}

export function calcResistance(closes, period = 20) {
  if (closes.length < period) return null;

  const recentClosses = closes.slice(-period);
  const maxClose = Math.max(...recentClosses);
  const avgClose = recentClosses.reduce((a, b) => a + b, 0) / period;

  return {
    resistance: +maxClose.toFixed(4),
    avgResistance: +avgClose.toFixed(4),
  };
}