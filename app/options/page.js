'use client';
import { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

import IVSurface from './components/IVSurface';
import IVRVGap from './components/IVRVGap';
import Greeks from './components/Greeks';
import VolSmile from './components/VolSmile';
import TermStructure from './components/TermStructure';
import VixTerm from './components/VixTerm';
import McEmbed from './components/McEmbed';
import SentimentRolling from './components/SentimentRolling';

const Load = ({ t = 'Loading...' }) => <div className="loading"><div className="spinner" />{t}</div>;
const Err = ({ m }) => <div className="err">⚠ {m}</div>;

export default function OptionsPage() {
  return (
    <Suspense fallback={<div className="loading"><div className="spinner" />Loading options…</div>}>
      <OptionsInner />
    </Suspense>
  );
}

function OptionsInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialSym = searchParams.get('sym')?.toUpperCase() || 'AMD';

  const [sym, setSym] = useState(initialSym);
  const [tickerInput, setTickerInput] = useState(initialSym);
  const [opts, setOpts] = useState(null);
  const [greeks, setGreeks] = useState(null);
  const [ld, setLd] = useState({});
  const [er, setEr] = useState({});
  const [plotlyReady, setPlotlyReady] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.Plotly) { setPlotlyReady(true); return; }
    const t = setInterval(() => { if (window.Plotly) { setPlotlyReady(true); clearInterval(t); } }, 100);
    return () => clearInterval(t);
  }, []);

  const fetchS = useCallback(async (key, url, setter) => {
    setLd((p) => ({ ...p, [key]: true })); setEr((p) => ({ ...p, [key]: null }));
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setter(d);
    } catch (e) {
      setEr((p) => ({ ...p, [key]: e.message }));
    } finally {
      setLd((p) => ({ ...p, [key]: false }));
    }
  }, []);

  useEffect(() => {
    fetchS('opts', `/data_pages/options?symbol=${sym}`, setOpts);
    fetchS('greeks', `/data_pages/options/greeks?symbol=${sym}`, setGreeks);
  }, [sym, fetchS]);

  // Sync URL ?sym= with state.
  useEffect(() => {
    const urlSym = searchParams.get('sym')?.toUpperCase();
    if (urlSym && urlSym !== sym) { setSym(urlSym); setTickerInput(urlSym); }
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  const submitTicker = (e) => {
    e.preventDefault();
    const t = (tickerInput || '').trim().toUpperCase();
    if (!t) return;
    router.push(`/options?sym=${encodeURIComponent(t)}`);
  };

  return (
    <main className="dash">
      <header className="topbar">
        <div className="topbar-l">
          <span className="brand">OPTIONS<span className="brand-dot" /></span>
          <span className="topbar-date">IV · Greeks · MC · Term · VIX</span>
        </div>
      </header>

      <div className="warn">⚠ Options data via Alpaca indicative feed; Greeks computed via Black-Scholes (r = 4.3%) · not advice</div>

      <div className="sh fi" style={{ padding: '14px 18px', alignItems: 'center', gap: 12 }}>
        <span className="sh-tick">{sym}</span>
        <span className="sh-co">Options Workbench</span>
        <form onSubmit={submitTicker} style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <input
            value={tickerInput}
            onChange={(e) => setTickerInput(e.target.value.toUpperCase())}
            placeholder="Ticker"
            style={{ background: '#18181f', border: '1px solid #282835', color: '#cfcfdc', padding: '6px 10px', fontFamily: 'var(--mono)', borderRadius: 6, width: 100 }}
          />
          <button type="submit" className="tf a">Load</button>
        </form>
      </div>

      {/* ROW 1: IV Surface | IV-RV Gap (moved from main dashboard) */}
      <div className="g2 fi fi1">
        <div className="card">
          <div className="card-h"><span className="card-t">Implied Volatility Surface</span><span className="badge b-c">ALPACA</span></div>
          {ld.opts ? <div className="ivbox"><Load t="Computing IV surface..." /></div>
            : er.opts ? <div className="ivbox"><Err m={er.opts} /></div>
            : opts && opts.surface?.filter((d) => d.type === 'call').length >= 5 ? (
              <>
                <IVSurface sym={sym} opts={opts} plotlyReady={plotlyReady} />
                <div className="ivleg"><b>X:</b> Strike. <b>Y:</b> DTE. <b>Z:</b> IV (%) — market&apos;s expected annualized move.</div>
              </>
            ) : <div className="ivbox"><div className="loading">No IV surface data available for {sym}</div></div>}
        </div>
        <div className="card">
          <div className="card-h"><span className="card-t">IV − RV Gap Surface</span><span className="badge b-g">{opts?.rv ? `RV = ${opts.rv.toFixed(1)}%` : 'COMPUTING'}</span></div>
          {ld.opts ? <div className="ivbox"><Load t="Computing IV-RV gap..." /></div>
            : er.opts ? <div className="ivbox"><Err m={er.opts} /></div>
            : opts && opts.surface?.length && opts.rv ? (
              <>
                <IVRVGap sym={sym} opts={opts} plotlyReady={plotlyReady} />
                <div className="ivleg"><b style={{ color: 'var(--neon-cyan)' }}>Teal:</b> IV &gt; RV (sell premium). <b style={{ color: 'var(--neon-red)' }}>Red:</b> IV &lt; RV (buy protection).</div>
              </>
            ) : <div className="ivbox"><div className="loading">No IV-RV data available for {sym}</div></div>}
        </div>
      </div>

      {/* ROW 2: Greeks panel (full width) */}
      <div className="fi fi2" style={{ padding: '0 18px' }}>
        <div className="card">
          <div className="card-h"><span className="card-t">Greeks · Δ Γ ν Θ ρ by Strike × Expiry</span><span className="badge b-c">BLACK-SCHOLES</span></div>
          {ld.greeks ? <Load t="Computing Greeks..." /> : er.greeks ? <Err m={er.greeks} /> : <Greeks data={greeks} />}
        </div>
      </div>

      {/* ROW 3: Vol Smile | Term Structure */}
      <div className="g2 fi fi3">
        <div className="card">
          <div className="card-h"><span className="card-t">Vol Smile · 2D Slice</span><span className="badge b-p">RR · BF</span></div>
          {ld.opts ? <Load /> : er.opts ? <Err m={er.opts} /> : <VolSmile sym={sym} opts={opts} plotlyReady={plotlyReady} />}
        </div>
        <div className="card">
          <div className="card-h"><span className="card-t">ATM IV Term Structure</span><span className="badge b-c">CONTANGO/BACK</span></div>
          {ld.opts ? <Load /> : er.opts ? <Err m={er.opts} /> : <TermStructure sym={sym} opts={opts} plotlyReady={plotlyReady} />}
        </div>
      </div>

      {/* ROW 4: VIX Term Structure (full width) */}
      <div className="fi fi4" style={{ padding: '0 18px' }}>
        <div className="card">
          <div className="card-h"><span className="card-t">VIX Term Structure · VIX / VIX3M / VIX6M</span><span className="badge b-c">YAHOO · 1h cache</span></div>
          <VixTerm plotlyReady={plotlyReady} />
        </div>
      </div>

      {/* ROW 4b: News sentiment via FinBERT (full width) */}
      <div className="fi fi4" style={{ padding: '0 18px' }}>
        <div className="card">
          <div className="card-h"><span className="card-t">News Sentiment · FinBERT on MI300X</span><span className="badge b-p">{sym} · 7d/30d rolling</span></div>
          <SentimentRolling sym={sym} plotlyReady={plotlyReady} />
        </div>
      </div>

      {/* ROW 5: Monte Carlo Option Pricer (embedded) */}
      <div className="fi fi4" style={{ padding: '0 18px 24px' }}>
        <div className="card">
          <div className="card-h"><span className="card-t">Monte Carlo Option Pricer · MI300X</span><span className="badge b-g">{sym} pre-filled</span></div>
          <McEmbed sym={sym} />
        </div>
      </div>
    </main>
  );
}