// Walk-forward portfolio backtester. T+1 execution, monthly/quarterly rebalance,
// transaction-cost drag in basis points.

export function runBacktest({ dates, closes, weights, costBps = 5, t1 = true, rebalance = 'monthly' }) {
  const tickers = Object.keys(weights);
  const n = dates.length;
  if (n < 30) return { error: 'too few data points' };

  const wTarget = tickers.map((t) => weights[t]);
  const sumW = wTarget.reduce((a, b) => a + b, 0);
  if (Math.abs(sumW - 1) > 0.01) return { error: `weights must sum to 1 (got ${sumW.toFixed(3)})` };

  const px = tickers.map((t) => closes[t]);
  for (let k = 0; k < tickers.length; k++) {
    if (!px[k] || px[k].length !== n) return { error: `missing prices for ${tickers[k]}` };
  }

  // Mark rebalance dates.
  const isRebal = new Array(n).fill(false);
  isRebal[0] = true;
  let lastMonth = dates[0].slice(0, 7), lastQuarter = qkey(dates[0]);
  for (let i = 1; i < n; i++) {
    const m = dates[i].slice(0, 7);
    const q = qkey(dates[i]);
    if (rebalance === 'monthly' && m !== lastMonth) { isRebal[i] = true; lastMonth = m; }
    if (rebalance === 'quarterly' && q !== lastQuarter) { isRebal[i] = true; lastQuarter = q; }
    if (rebalance === 'yearly' && dates[i].slice(0, 4) !== dates[i - 1].slice(0, 4)) isRebal[i] = true;
  }

  // Initial setup: invest $1 at t=0 with target weights.
  const cost = costBps / 10000;
  let nav = 1.0;
  const shares = tickers.map((_, k) => (wTarget[k] * nav) / px[k][0]);
  // Initial transaction cost (turnover ≈ 1).
  nav *= (1 - cost);
  const equity = [{ d: dates[0], v: nav }];
  let pendingRebal = false;

  for (let i = 1; i < n; i++) {
    // Today's NAV from yesterday's positions.
    nav = 0;
    for (let k = 0; k < tickers.length; k++) nav += shares[k] * px[k][i];

    // Execute pending rebalance at today's close.
    if (pendingRebal) {
      const oldVal = tickers.map((_, k) => shares[k] * px[k][i]);
      const oldW = oldVal.map((v) => v / nav);
      let turnover = 0;
      for (let k = 0; k < tickers.length; k++) turnover += Math.abs(wTarget[k] - oldW[k]);
      turnover /= 2; // round-trip turnover halved
      nav *= (1 - cost * turnover);
      for (let k = 0; k < tickers.length; k++) shares[k] = (wTarget[k] * nav) / px[k][i];
      pendingRebal = false;
    }

    if (isRebal[i]) {
      if (t1) {
        pendingRebal = true; // execute next bar
      } else {
        const oldVal = tickers.map((_, k) => shares[k] * px[k][i]);
        const oldW = oldVal.map((v) => v / nav);
        let turnover = 0;
        for (let k = 0; k < tickers.length; k++) turnover += Math.abs(wTarget[k] - oldW[k]);
        turnover /= 2;
        nav *= (1 - cost * turnover);
        for (let k = 0; k < tickers.length; k++) shares[k] = (wTarget[k] * nav) / px[k][i];
      }
    }

    equity.push({ d: dates[i], v: +nav.toFixed(6) });
  }

  // Stats.
  const navs = equity.map((p) => p.v);
  const dailyRets = [];
  for (let i = 1; i < navs.length; i++) dailyRets.push(navs[i] / navs[i - 1] - 1);
  const meanR = dailyRets.reduce((a, b) => a + b, 0) / dailyRets.length;
  const sdR = Math.sqrt(dailyRets.reduce((a, b) => a + (b - meanR) ** 2, 0) / Math.max(1, dailyRets.length - 1));
  const sharpe = sdR > 0 ? (meanR / sdR) * Math.sqrt(252) : 0;
  const vol = sdR * Math.sqrt(252);
  let peak = navs[0], maxDD = 0;
  for (const v of navs) { if (v > peak) peak = v; const dd = v / peak - 1; if (dd < maxDD) maxDD = dd; }
  const totalReturn = navs[navs.length - 1] / navs[0] - 1;

  return {
    equity,
    stats: {
      totalReturn: +totalReturn.toFixed(4),
      maxDD: +maxDD.toFixed(4),
      sharpe: +sharpe.toFixed(3),
      vol: +vol.toFixed(4),
      finalNav: +navs[navs.length - 1].toFixed(4),
      nDays: navs.length,
      nRebalances: isRebal.filter(Boolean).length,
    },
  };
}

function qkey(d) {
  const m = parseInt(d.slice(5, 7), 10);
  const q = Math.floor((m - 1) / 3) + 1;
  return `${d.slice(0, 4)}-Q${q}`;
}