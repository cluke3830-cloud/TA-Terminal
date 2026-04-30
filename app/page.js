'use client';
import './globals.css';
import { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

const FOCUS_TO_ID = {
  overview: 'sec-overview',
  chart: 'sec-chart',
  earn: 'sec-earn',
  fin: 'sec-fin',
  opt: 'options',
  fc: 'sec-fc',
};

// ═══════════════════════════════════════════════════════════════════════════════
//  QUANTUM STOCK TERMINAL — Main Page
// ═══════════════════════════════════════════════════════════════════════════════

// Convert UTC timestamp to a target timezone by computing the offset
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

function calcEMA(vals, p) {
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

function fmt(n, d = 2) {
  if (n == null || isNaN(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e12) return (n / 1e12).toFixed(d) + 'T';
  if (a >= 1e9) return (n / 1e9).toFixed(d) + 'B';
  if (a >= 1e6) return (n / 1e6).toFixed(d) + 'M';
  if (a >= 1e3) return (n / 1e3).toFixed(d) + 'K';
  return n.toFixed(d);
}

function fmtDate() { return new Date().toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' }); }
function fmtTime() { return new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }

const Load = ({ t = 'Loading...' }) => <div className="loading"><div className="spinner" />{t}</div>;
const Err = ({ m }) => <div className="err">⚠ {m}</div>;

// ═════════════════════════════════════════════════════════════════════════════

export default function Dashboard() {
  return (
    <Suspense fallback={<div className="loading"><div className="spinner" />Loading…</div>}>
      <DashboardInner />
    </Suspense>
  );
}

function DashboardInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialSym = searchParams.get('sym')?.toUpperCase() || 'NVDA';
  const initialTf = searchParams.get('tf') || '1Min';

  const [sym, setSym] = useState(initialSym);
  const [tf, setTf] = useState(initialTf);
  const [chartType, setChartType] = useState('heikin');
  const [tz, setTz] = useState('America/New_York');

  const [stock, setStock] = useState(null);
  const [earn, setEarn] = useState(null);
  const [fin, setFin] = useState(null);
  const [fc, setFc] = useState(null);
  const [news, setNews] = useState(null);

  const [ld, setLd] = useState({});
  const [er, setEr] = useState({});
  const [tab, setTab] = useState('income');
  const [clock, setClock] = useState(fmtTime());

  const cRef = useRef(null);
  const cInst = useRef(null);

  useEffect(() => { const t = setInterval(() => setClock(fmtTime()), 1000); return () => clearInterval(t); }, []);

  // Old #sec-opt anchor → new dedicated /options page.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.location.hash === '#sec-opt') {
      router.replace(`/options?sym=${encodeURIComponent(sym)}`);
    }
  }, [router, sym]);

  // Fetcher
  const fetchS = useCallback(async (key, url, setter) => {
    setLd(p => ({ ...p, [key]: true })); setEr(p => ({ ...p, [key]: null }));
    try { const r = await fetch(url); if (!r.ok) throw new Error(`HTTP ${r.status}`); setter(await r.json()); }
    catch (e) { setEr(p => ({ ...p, [key]: e.message })); }
    finally { setLd(p => ({ ...p, [key]: false })); }
  }, []);

  const fetchAll = useCallback((s, t) => {
    fetchS('stock', `/data_pages/stock?symbol=${s}&timeframe=${t}&tradingDays=3`, setStock);
    fetchS('earn', `/data_pages/earnings?symbol=${s}`, setEarn);
    fetchS('fin', `/data_pages/financials?symbol=${s}`, setFin);
    fetchS('fc', `/data_pages/forecast?symbol=${s}`, setFc);
    fetchS('news', `/data_pages/news?symbol=${s}`, setNews);
  }, [fetchS]);

  useEffect(() => { fetchAll(sym, tf); }, [sym, tf, fetchAll]);

  // React to URL param changes (e.g. user picks `NVDA GP 1D` from the command
  // palette while already on this page). Also handle ?focus=... by scrolling
  // to the matching section once the page has settled.
  useEffect(() => {
    const urlSym = searchParams.get('sym')?.toUpperCase();
    const urlTf = searchParams.get('tf');
    const urlFocus = searchParams.get('focus');
    if (urlSym && urlSym !== sym) setSym(urlSym);
    if (urlTf && urlTf !== tf) setTf(urlTf);
    if (urlFocus && FOCUS_TO_ID[urlFocus]) {
      const el = document.getElementById(FOCUS_TO_ID[urlFocus]);
      if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
    }
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh 60s
  useEffect(() => {
    const i1 = setInterval(() => fetchS('stock', `/data_pages/stock?symbol=${sym}&timeframe=${tf}&tradingDays=3`, setStock), 60000);
    return () => clearInterval(i1);
  }, [sym, tf, fetchS]);

  // ── TradingView Lightweight Chart ──────────────────────────────────────────
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
        width: el.clientWidth, height: 500,
        layout: { background: { color: '#111117' }, textColor: '#555568', fontFamily: "'Geist Mono',monospace", fontSize: 10 },
        grid: { vertLines: { color: 'rgba(56,56,78,0.2)' }, horzLines: { color: 'rgba(56,56,78,0.2)' } },
        crosshair: { vertLine: { color: 'rgba(0,212,255,0.25)', labelBackgroundColor: '#18181f' }, horzLine: { color: 'rgba(0,212,255,0.25)', labelBackgroundColor: '#18181f' } },
        timeScale: { borderColor: '#282835', timeVisible: true, secondsVisible: false },
        rightPriceScale: { borderColor: '#282835' },
      });
      cInst.current = chart;

      const times = stock.bars.map(b => toTzEpoch(b.t, tz));
      const closes = stock.bars.map(b => b.c);
      const ohlcData = stock.bars.map((b, i) => ({ time: times[i], open: b.o, high: b.h, low: b.l, close: b.c }));
      const closeData = stock.bars.map((b, i) => ({ time: times[i], value: b.c }));

      if (chartType === 'line') {
        const s = chart.addLineSeries({ color: '#00d4ff', lineWidth: 2, crosshairMarkerVisible: true, crosshairMarkerRadius: 4 });
        s.setData(closeData);
      } else if (chartType === 'area') {
        const s = chart.addAreaSeries({ topColor: 'rgba(0,212,255,0.4)', bottomColor: 'rgba(0,212,255,0.02)', lineColor: '#00d4ff', lineWidth: 2 });
        s.setData(closeData);
      } else if (chartType === 'bar') {
        const s = chart.addBarSeries({ upColor: '#00f59b', downColor: '#ff3355' });
        s.setData(ohlcData);
      } else if (chartType === 'candle') {
        const s = chart.addCandlestickSeries({ upColor: '#00f59b', downColor: '#ff3355', borderUpColor: '#00f59b', borderDownColor: '#ff3355', wickUpColor: '#00f59b', wickDownColor: '#ff3355' });
        s.setData(ohlcData);
      } else {
        const s = chart.addCandlestickSeries({ upColor: '#00f59b', downColor: '#ff3355', borderUpColor: '#00f59b', borderDownColor: '#ff3355', wickUpColor: '#00f59b', wickDownColor: '#ff3355' });
        s.setData(toHA(stock.bars, tz));
      }

      const vol = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'vol' });
      chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
      vol.setData(stock.bars.map(b => ({ time: toTzEpoch(b.t, tz), value: b.v, color: b.c >= b.o ? 'rgba(0,245,155,0.15)' : 'rgba(255,51,85,0.15)' })));

      const addEma = (p, col, w) => {
        const vals = calcEMA(closes, p);
        const s = chart.addLineSeries({ color: col, lineWidth: w, crosshairMarkerVisible: false });
        s.setData(vals.map((v, i) => v != null ? { time: times[i], value: +v.toFixed(4) } : null).filter(Boolean));
      };
      addEma(8, '#00d4ff', 1); addEma(21, '#ff8833', 1); addEma(55, '#9955ff', 2);
      chart.timeScale().fitContent();

      ro = new ResizeObserver(() => { if (el) chart.applyOptions({ width: el.clientWidth }); });
      ro.observe(el);
    })();

    return () => {
      cancelled = true;
      if (ro) ro.disconnect();
      if (cInst.current) { try { cInst.current.remove(); } catch {} cInst.current = null; }
    };
  }, [stock, chartType, tz]);

  const bars = stock?.bars || [];
  const last = bars[bars.length - 1];
  const prev = bars[bars.length - 2];
  const price = last?.c;
  const chg = last && prev ? ((last.c - prev.c) / prev.c * 100) : null;
  const coName = fin?.profile?.companyName || fin?.profile?.name || '';

  // Ratios helpers
  const R = fin?.ratios || {};
  const ratioItems = [
    { l: 'P/E', v: R.priceToEarningsRatioTTM }, { l: 'P/B', v: R.priceToBookRatioTTM }, { l: 'P/S', v: R.priceToSalesRatioTTM },
    { l: 'Debt/Eq', v: R.debtToEquityRatioTTM }, { l: 'Debt/Assets', v: R.debtToAssetsRatioTTM }, { l: 'Curr Ratio', v: R.currentRatioTTM },
    { l: 'P/FCF', v: R.priceToFreeCashFlowRatioTTM }, { l: 'Gross Mgn', v: R.grossProfitMarginTTM, pct: true }, { l: 'Net Mgn', v: R.netProfitMarginTTM, pct: true },
  ];

  // Forecast
  const tgt = fc?.targets || null;

  return (
    <>
      <header className="topbar">
        <div className="topbar-l">
          <span className="brand">QUANTUM TERMINAL<span className="brand-dot" /></span>
          <span className="topbar-date">{fmtDate()} · {clock}</span>
        </div>
      </header>

      <div className="warn">⚠ Free-tier API data — prices may be delayed 15 min · IV from indicative feed · not financial advice</div>

      <main className="dash">
        <div id="sec-overview" className="sh fi">
          <span className="sh-tick">{sym}</span>
          <span className="sh-co">{coName}</span>
          <div className="sh-pb">
            {price != null && <span className="sh-price">${price.toFixed(2)}</span>}
            {chg != null && <span className={`sh-chg ${chg >= 0 ? 'up' : 'dn'}`}>{chg >= 0 ? '+' : ''}{chg.toFixed(2)}%</span>}
          </div>
        </div>

        {/* CHART */}
        <div id="sec-chart" className="cc fi fi1">
          <div className="cb">
            {['1Min','5Min','15Min','1Hour','1Day'].map(t => (
              <button key={t} className={`tf ${tf === t ? 'a' : ''}`} onClick={() => setTf(t)}>{t.replace('Min','m').replace('Hour','H').replace('Day','D')}</button>
            ))}
            <span className="cb-sep">|</span>
            {[['heikin','HA'],['candle','Candle'],['bar','Bar'],['line','Line'],['area','Area']].map(([id, lbl]) => (
              <button key={id} className={`tf ${chartType === id ? 'a' : ''}`} onClick={() => setChartType(id)}>{lbl}</button>
            ))}
            <span className="cb-sep">|</span>
            {[['America/New_York','ET'],['America/Chicago','CT'],['America/Denver','MT'],['America/Los_Angeles','PT'],['UTC','UTC']].map(([id, lbl]) => (
              <button key={id} className={`tf ${tz === id ? 'a' : ''}`} onClick={() => setTz(id)}>{lbl}</button>
            ))}
            <span className="cl">{chartType === 'candle' ? 'Candlestick' : chartType === 'bar' ? 'OHLC Bar' : chartType === 'line' ? 'Line' : chartType === 'area' ? 'Area' : 'Heikin Ashi'} · EMA 8/21/55 · Vol · 3D</span>
            {stock?.lastBarTimestamp && (
              <span className={`chart-freshness fr-${stock.marketStatus || 'closed'}`}>
                <span className="fr-dot" />
                <span className="fr-label">{stock.marketStatus === 'open' ? 'LIVE' : stock.marketStatus === 'pre' ? 'PRE' : stock.marketStatus === 'post' ? 'POST' : 'CLOSED'}</span>
                <span className="fr-feed">IEX</span>
                <span className="fr-time">Last bar {new Date(stock.lastBarTimestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'America/New_York' })} ET</span>
              </span>
            )}
          </div>
          {ld.stock ? <div style={{ height: 500 }}><Load t="Fetching bars..." /></div>
            : er.stock ? <div style={{ height: 500 }}><Err m={er.stock} /></div>
            : <div ref={cRef} className="ca" />}
        </div>

        {/* ROW 1: EARNINGS | FINANCIALS */}
        <div className="g2 fi fi2">
          <div id="sec-earn" className="card">
            <div className="card-h"><span className="card-t">Earnings</span><span className="badge b-c">FMP</span></div>
            <div className="card-b">
              {ld.earn ? <Load /> : er.earn ? <Err m={er.earn} /> : earn ? <>
                {earn.calendar?.[0]?.date && (
                  <div className="ne"><span className="ne-icon">📅</span><div><div className="ne-lbl">Next Earnings</div><div className="ne-date">{earn.calendar[0].date}</div></div></div>
                )}
                {earn.history?.length > 0 ? (
                  <table className="dt"><thead><tr><th>Date</th><th>Est.</th><th>Actual</th><th>Surprise</th></tr></thead>
                    <tbody>{earn.history.slice(0, 8).map((e, i) => {
                      const s = e.eps != null && e.epsEstimated ? ((e.eps - e.epsEstimated) / Math.abs(e.epsEstimated || 1) * 100) : null;
                      return <tr key={i}><td>{e.date}</td><td>${e.epsEstimated?.toFixed(2) ?? '—'}</td><td>${e.eps?.toFixed(2) ?? '—'}</td><td className={s != null ? (s >= 0 ? 'vg' : 'vr') : ''}>{s != null ? `${s >= 0 ? '+' : ''}${s.toFixed(1)}%` : '—'}</td></tr>;
                    })}</tbody></table>
                ) : <div className="loading" style={{ padding: 16 }}>No earnings estimate history available for {sym}</div>}
                {earn.quarterly_income?.length > 0 && (
                  <div style={{ marginTop: 16 }}><div className="sl">Quarterly Revenue</div>
                    <div className="rvb">{[...earn.quarterly_income].reverse().slice(-8).map((q, i, arr) => {
                      const max = Math.max(...arr.map(a => a.revenue || 0));
                      const pct = max > 0 ? ((q.revenue || 0) / max) : 0;
                      return <div key={i} className="rvb-c"><div className="rvb-bar" style={{ height: `${Math.max(pct * 70, 2)}px`, background: 'linear-gradient(to top, rgba(0,212,255,.6), rgba(0,245,155,.6))' }} /><div className="rvb-l">{q.period}</div></div>;
                    })}</div></div>
                )}
              </> : <div className="loading" style={{ padding: 24 }}>No earnings data available for {sym}</div>}
            </div>
          </div>

          <div id="sec-fin" className="card">
            <div className="card-h"><span className="card-t">Financials</span><span className="badge b-p">FMP</span></div>
            <div className="card-b">
              {ld.fin ? <Load /> : er.fin ? <Err m={er.fin} /> : fin ? <>
                <div className="rg" style={{ marginBottom: 14 }}>
                  {ratioItems.map((r, i) => <div key={i} className="rb"><div className="rb-l">{r.l}</div><div className="rb-v">{r.v != null ? (r.pct ? (r.v * 100).toFixed(1) + '%' : r.v.toFixed(2)) : '—'}</div></div>)}
                </div>
                {ratioItems.every(r => r.v == null) && <div className="loading" style={{ padding: 8, fontSize: 10 }}>Financial ratios unavailable — may require FMP premium plan</div>}
                <div className="tabs">
                  {[['income','Income'],['balance','Balance'],['cashflow','Cash Flow']].map(([id, lbl]) => (
                    <button key={id} className={`tab ${tab === id ? 'a' : ''}`} onClick={() => setTab(id)}>{lbl}</button>
                  ))}
                </div>
                {tab === 'income' && fin.income?.length > 0 && (
                  <table className="dt"><thead><tr><th>Qtr</th><th>Revenue</th><th>Net Inc</th><th>EPS</th></tr></thead>
                    <tbody>{fin.income.slice(0, 5).map((s, i) => <tr key={i}><td>{s.period} {new Date(s.date).getFullYear()}</td><td className="vc">{fmt(s.revenue)}</td><td className={s.netIncome >= 0 ? 'vg' : 'vr'}>{fmt(s.netIncome)}</td><td>{s.eps?.toFixed(2) ?? '—'}</td></tr>)}</tbody></table>
                )}
                {tab === 'balance' && fin.balance?.length > 0 && (
                  <table className="dt"><thead><tr><th>Qtr</th><th>Assets</th><th>Debt</th><th>Equity</th></tr></thead>
                    <tbody>{fin.balance.map((s, i) => <tr key={i}><td>{s.period} {new Date(s.date).getFullYear()}</td><td className="vc">{fmt(s.totalAssets)}</td><td className="vr">{fmt(s.totalDebt)}</td><td className="vg">{fmt(s.totalStockholdersEquity)}</td></tr>)}</tbody></table>
                )}
                {tab === 'cashflow' && fin.cashflow?.length > 0 && (
                  <table className="dt"><thead><tr><th>Qtr</th><th>Op CF</th><th>CapEx</th><th>Free CF</th></tr></thead>
                    <tbody>{fin.cashflow.map((s, i) => <tr key={i}><td>{s.period} {new Date(s.date).getFullYear()}</td><td className="vc">{fmt(s.operatingCashFlow)}</td><td className="vr">{fmt(s.capitalExpenditure)}</td><td className="vg">{fmt(s.freeCashFlow)}</td></tr>)}</tbody></table>
                )}
              </> : <div className="loading" style={{ padding: 24 }}>No financial data available for {sym}</div>}
            </div>
          </div>
        </div>

        {/* IV/Greeks/MC moved to dedicated /options page — link out from here. */}
        <div className="fi fi3" style={{ padding: '0 18px' }}>
          <a href={`/options?sym=${sym}`} className="card" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 18px', textDecoration: 'none', cursor: 'pointer' }}>
            <span style={{ fontSize: 24 }}>📈</span>
            <div style={{ flex: 1 }}>
              <div className="card-t" style={{ fontSize: 13 }}>Options Workbench →</div>
              <div style={{ fontSize: 11, color: 'var(--ash)', marginTop: 2 }}>IV Surface · IV−RV Gap · Greeks · Vol Smile · Term Structure · VIX · Monte Carlo</div>
            </div>
            <span className="badge b-c">/options</span>
          </a>
        </div>

        {/* FORECAST */}
        <div id="sec-fc" className="fc-card fi fi4">
          <div className="card-h"><span className="card-t">Analyst Price Targets & Forecast</span><span className="badge b-c">FMP</span></div>
          {ld.fc ? <Load /> : er.fc ? <Err m={er.fc} /> : <>
            {tgt ? (
              <div className="fc-grid">
                {[
                  { s: 'Last Month Avg', v: tgt.targetHigh, c: 'vg', l: 'Recent consensus' },
                  { s: 'Last Quarter Avg', v: tgt.targetMedian, c: 'vc', l: 'Quarterly consensus' },
                  { s: 'Last Year Avg', v: tgt.targetMean, c: 'vp', l: `${tgt.numberOfAnalysts || '?'} analysts` },
                  { s: 'All-Time Avg', v: tgt.targetLow, c: 'vr', l: 'Historical avg' },
                ].map((f, i) => <div key={i} className="fc-i"><div className="fc-src">{f.s}</div><div className={`fc-val ${f.c}`}>${f.v?.toFixed(2) || '—'}</div><div className="fc-lbl">{f.l}</div></div>)}
              </div>
            ) : <div className="loading" style={{ padding: 24 }}>No analyst targets available for {sym}</div>}

            {fc?.upgrades && (
              <div style={{ padding: '0 18px 16px' }}>
                <div className="sl">Analyst Consensus</div>
                <div style={{ display: 'flex', gap: 16, fontFamily: 'var(--mono)', fontSize: 12 }}>
                  <span className="vg">Buy: {fc.upgrades.buy || 0}</span>
                  <span className="vy">Hold: {fc.upgrades.hold || 0}</span>
                  <span className="vr">Sell: {fc.upgrades.sell || 0}</span>
                  <span className="vg">Strong Buy: {fc.upgrades.strongBuy || 0}</span>
                  <span className="vr">Strong Sell: {fc.upgrades.strongSell || 0}</span>
                </div>
              </div>
            )}

            {(news?.articles?.length > 0 || fc?.news?.length > 0) && (
              <div style={{ padding: '0 18px 16px' }}>
                <div className="sl" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span>Recent News {news?.sentimentAvailable ? '· FinBERT scored' : ''}</span>
                  {news?.rolling?.d7 != null && (
                    <span style={{ fontSize: 10, color: 'var(--ash)', fontFamily: 'var(--mono)' }}>
                      7d: <b className={news.rolling.d7 >= 0 ? 'vg' : 'vr'}>{news.rolling.d7 >= 0 ? '+' : ''}{news.rolling.d7?.toFixed(2)}</b>
                      {news.rolling.d30 != null && <> · 30d: <b className={news.rolling.d30 >= 0 ? 'vg' : 'vr'}>{news.rolling.d30 >= 0 ? '+' : ''}{news.rolling.d30?.toFixed(2)}</b></>}
                    </span>
                  )}
                </div>
                {(news?.articles || fc?.news || []).slice(0, 6).map((n, i) => {
                  const sentiment = n.sentiment || null;
                  const s = sentiment ? (sentiment.positive - sentiment.negative) : null;
                  const cls = s == null ? '' : (s > 0.1 ? 'vg' : s < -0.1 ? 'vr' : 'vy');
                  const badge = s == null ? null : (s > 0.1 ? 'b-g' : s < -0.1 ? 'b-p' : 'b-c');
                  return (
                    <div key={i} className="ni" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      {sentiment && <span className={`badge ${badge}`} style={{ minWidth: 60, textAlign: 'center', fontSize: 9 }}>{sentiment.label?.toUpperCase()}</span>}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <a href={n.url} target="_blank" rel="noopener noreferrer" className="nl">{n.title}</a>
                        <div className="nm">{n.site} · {(n.date || n.publishedDate)?.slice(0, 10)}</div>
                      </div>
                      {s != null && <span className={cls} style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{s >= 0 ? '+' : ''}{s.toFixed(2)}</span>}
                    </div>
                  );
                })}
              </div>
            )}

            <div className="fc-foot">
              Sources: <a href="https://financialmodelingprep.com" target="_blank" rel="noopener noreferrer">FMP</a> ·{' '}
              Cross-ref: <a href="https://www.tradingview.com" target="_blank" rel="noopener noreferrer">TradingView</a>{' '}
              · <a href="https://www.morningstar.com" target="_blank" rel="noopener noreferrer">Morningstar</a>{' '}
              · <a href="https://finviz.com" target="_blank" rel="noopener noreferrer">Finviz</a>{' '}
              · <a href="https://seekingalpha.com" target="_blank" rel="noopener noreferrer">SeekingAlpha</a>
            </div>
          </>}
        </div>
      </main>

      <footer className="footer">
        QUANTUM STOCK TERMINAL · Built by Taeheon ·{' '}
        <a href="https://alpaca.markets">Alpaca</a> ·{' '}
        <a href="https://financialmodelingprep.com">FMP</a>
        <br />Open source · Not financial advice · Free-tier data may be delayed
      </footer>
    </>
  );
}
