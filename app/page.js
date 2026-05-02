'use client';
import './globals.css';
import { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import ChartWithIndicators from './components/ChartWithIndicators';

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
  const initialDays = parseInt(searchParams.get('days') || '0', 10) || null;

  const [sym, setSym] = useState(initialSym);
  const [tf, setTf] = useState(initialTf);
  const [chartType, setChartType] = useState('heikin');
  const [tz, setTz] = useState('America/New_York');
  const [days, setDays] = useState(initialDays); // null = use default (3 trading days)

  const [stock, setStock] = useState(null);
  const [earn, setEarn] = useState(null);
  const [fin, setFin] = useState(null);
  const [fc, setFc] = useState(null);
  const [news, setNews] = useState(null);

  const [ld, setLd] = useState({});
  const [er, setEr] = useState({});
  const [tab, setTab] = useState('income');
  const [clock, setClock] = useState(fmtTime());

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

  const buildStockUrl = useCallback((s, t, d) => {
    if (d && d > 0) return `/data_pages/stock?symbol=${s}&timeframe=${t}&days=${d}`;
    return `/data_pages/stock?symbol=${s}&timeframe=${t}&tradingDays=3`;
  }, []);

  const fetchAll = useCallback((s, t, d) => {
    fetchS('stock', buildStockUrl(s, t, d), setStock);
    fetchS('earn', `/data_pages/earnings?symbol=${s}`, setEarn);
    fetchS('fin', `/data_pages/financials?symbol=${s}`, setFin);
    fetchS('fc', `/data_pages/forecast?symbol=${s}`, setFc);
    fetchS('news', `/data_pages/news?symbol=${s}`, setNews);
  }, [fetchS, buildStockUrl]);

  useEffect(() => { fetchAll(sym, tf, days); }, [sym, tf, days, fetchAll]);

  // React to URL param changes (e.g. user picks `NVDA GP 1D` from the command
  // palette while already on this page). Also handle ?focus=... by scrolling
  // to the matching section once the page has settled.
  useEffect(() => {
    const urlSym = searchParams.get('sym')?.toUpperCase();
    const urlTf = searchParams.get('tf');
    const urlFocus = searchParams.get('focus');
    const urlDays = parseInt(searchParams.get('days') || '0', 10) || null;
    if (urlSym && urlSym !== sym) setSym(urlSym);
    if (urlTf && urlTf !== tf) setTf(urlTf);
    if (urlDays !== days) setDays(urlDays);
    if (urlFocus && FOCUS_TO_ID[urlFocus]) {
      const el = document.getElementById(FOCUS_TO_ID[urlFocus]);
      if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
    }
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live polling — interval depends on timeframe; pauses when tab is hidden.
  useEffect(() => {
    const period = tf === '1Day' ? 5 * 60_000 : tf === '1Hour' ? 60_000 : 15_000;
    const tick = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      fetchS('stock', buildStockUrl(sym, tf, days), setStock);
    };
    const i1 = setInterval(tick, period);
    return () => clearInterval(i1);
  }, [sym, tf, days, fetchS, buildStockUrl]);


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

        {/* CHART WITH TRADINGVIEW-STYLE INDICATORS */}
        <div id="sec-chart" className="fi fi1">
          {ld.stock ? <div style={{ height: 500, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Load t="Fetching bars..." /></div>
            : er.stock ? <div style={{ height: 500, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Err m={er.stock} /></div>
            : stock?.bars ? <ChartWithIndicators bars={stock.bars} tf={tf} tz={tz} chartType={chartType} />
            : <div style={{ height: 500, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Load t="Waiting for data..." /></div>}
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
