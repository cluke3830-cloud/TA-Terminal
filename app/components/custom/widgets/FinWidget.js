'use client';

import { useEffect, useState } from 'react';
import { fmt } from '../../ui';

export default function FinWidget({ params }) {
  const symbol = (params?.symbol || 'NVDA').toUpperCase();
  const [fin, setFin] = useState(null);
  const [tab, setTab] = useState('income');
  const [err, setErr] = useState('');

  useEffect(() => {
    let cancelled = false;
    setFin(null); setErr('');
    fetch(`/data_pages/financials?symbol=${symbol}`)
      .then((r) => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
      .then((j) => { if (!cancelled) setFin(j); })
      .catch((e) => { if (!cancelled) setErr(String(e)); });
    return () => { cancelled = true; };
  }, [symbol]);

  if (err) return <div className="err">⚠ {err}</div>;
  if (!fin) return <div className="loading"><div className="spinner" />Loading financials…</div>;

  const R = fin?.ratios || {};
  const ratios = [
    { l: 'P/E', v: R.priceToEarningsRatioTTM }, { l: 'P/B', v: R.priceToBookRatioTTM }, { l: 'P/S', v: R.priceToSalesRatioTTM },
    { l: 'Debt/Eq', v: R.debtToEquityRatioTTM }, { l: 'Curr', v: R.currentRatioTTM },
    { l: 'Gross', v: R.grossProfitMarginTTM, pct: true }, { l: 'Net', v: R.netProfitMarginTTM, pct: true },
  ];

  return (
    <div className="fin-widget">
      <div className="rg" style={{ marginBottom: 10 }}>
        {ratios.map((r, i) => (
          <div key={i} className="rb">
            <div className="rb-l">{r.l}</div>
            <div className="rb-v">{r.v != null ? (r.pct ? (r.v * 100).toFixed(1) + '%' : r.v.toFixed(2)) : '—'}</div>
          </div>
        ))}
      </div>
      <div className="tabs">
        {[['income','Income'],['balance','Balance'],['cashflow','Cash Flow']].map(([id, lbl]) => (
          <button key={id} className={`tab ${tab === id ? 'a' : ''}`} onClick={() => setTab(id)}>{lbl}</button>
        ))}
      </div>
      {tab === 'income' && fin.income?.length > 0 && (
        <table className="dt"><thead><tr><th>Qtr</th><th>Revenue</th><th>Net Inc</th></tr></thead>
          <tbody>{fin.income.slice(0, 5).map((s, i) => <tr key={i}><td>{s.period} {new Date(s.date).getFullYear()}</td><td>{fmt(s.revenue)}</td><td className={s.netIncome >= 0 ? 'vg' : 'vr'}>{fmt(s.netIncome)}</td></tr>)}</tbody></table>
      )}
      {tab === 'balance' && fin.balance?.length > 0 && (
        <table className="dt"><thead><tr><th>Qtr</th><th>Assets</th><th>Debt</th><th>Equity</th></tr></thead>
          <tbody>{fin.balance.map((s, i) => <tr key={i}><td>{s.period} {new Date(s.date).getFullYear()}</td><td>{fmt(s.totalAssets)}</td><td className="vr">{fmt(s.totalDebt)}</td><td className="vg">{fmt(s.totalStockholdersEquity)}</td></tr>)}</tbody></table>
      )}
      {tab === 'cashflow' && fin.cashflow?.length > 0 && (
        <table className="dt"><thead><tr><th>Qtr</th><th>Op CF</th><th>CapEx</th><th>FCF</th></tr></thead>
          <tbody>{fin.cashflow.map((s, i) => <tr key={i}><td>{s.period} {new Date(s.date).getFullYear()}</td><td>{fmt(s.operatingCashFlow)}</td><td className="vr">{fmt(s.capitalExpenditure)}</td><td className="vg">{fmt(s.freeCashFlow)}</td></tr>)}</tbody></table>
      )}
    </div>
  );
}