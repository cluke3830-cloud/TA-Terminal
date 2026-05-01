'use client';

import { useEffect, useMemo, useState } from 'react';

export default function MacroCalWidget() {
  const [calendar, setCalendar] = useState(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState('upcoming');
  const [filter, setFilter] = useState({ impact: 'ALL', currency: 'ALL' });
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let cancelled = false;
    fetch('/data_pages/macro/calendar')
      .then((r) => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
      .then((j) => { if (!cancelled) setCalendar(j); })
      .catch((e) => { if (!cancelled) setErr(String(e)); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const nextHigh = useMemo(() => calendar?.upcoming?.find((e) => e.impact === 'High') || null, [calendar]);

  const filtered = useMemo(() => {
    if (!calendar) return [];
    const src = tab === 'upcoming' ? calendar.upcoming : calendar.recent;
    return (src || []).filter((e) => {
      if (filter.impact !== 'ALL' && e.impact !== filter.impact) return false;
      if (filter.currency !== 'ALL' && e.currency !== filter.currency) return false;
      return true;
    });
  }, [calendar, tab, filter]);

  const grouped = useMemo(() => {
    if (!filtered.length) return [];
    const groups = {};
    for (const e of filtered) {
      const day = (e.date || '').slice(0, 10);
      if (!groups[day]) groups[day] = [];
      groups[day].push(e);
    }
    const todayKey = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowKey = tomorrow.toISOString().slice(0, 10);
    const yest = new Date(); yest.setDate(yest.getDate() - 1);
    const yestKey = yest.toISOString().slice(0, 10);
    return Object.entries(groups)
      .sort(([a], [b]) => tab === 'upcoming' ? a.localeCompare(b) : b.localeCompare(a))
      .map(([day, events]) => {
        const d = new Date(day + 'T00:00:00');
        const wd = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase();
        let label;
        if (day === todayKey) label = `TODAY · ${wd}`;
        else if (day === tomorrowKey) label = `TOMORROW · ${wd}`;
        else if (day === yestKey) label = `YESTERDAY · ${wd}`;
        else label = wd;
        return { day, label, events };
      });
  }, [filtered, tab]);

  if (err) return <div className="err">⚠ {err}</div>;
  if (!calendar) return <div className="loading"><div className="spinner" />Loading economic calendar…</div>;

  return (
    <div style={{ padding: '8px 14px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 4 }}>
        <button className={`tf ${tab === 'upcoming' ? 'a' : ''}`} onClick={() => setTab('upcoming')}>Upcoming</button>
        <button className={`tf ${tab === 'recent' ? 'a' : ''}`} onClick={() => setTab('recent')}>Recent</button>
      </div>

      {nextHigh && (() => {
        const ms = new Date(nextHigh.date).getTime() - now;
        const past = ms < 0;
        const abs = Math.abs(ms);
        const d = Math.floor(abs / 86400000);
        const h = Math.floor((abs % 86400000) / 3600000);
        const m = Math.floor((abs % 3600000) / 60000);
        const s = Math.floor((abs % 60000) / 1000);
        return (
          <div className="ec-next">
            <div className="ec-next-l">{past ? 'JUST RELEASED' : 'NEXT HIGH-IMPACT'}</div>
            <div className="ec-next-event">{nextHigh.flag} {nextHigh.event}</div>
            <div className="ec-next-cd">{d > 0 ? `${d}D ` : ''}{String(h).padStart(2, '0')}H {String(m).padStart(2, '0')}M {String(s).padStart(2, '0')}S</div>
          </div>
        );
      })()}

      {calendar.citiProxy != null && (
        <div className="ec-summary">
          <div>
            <div className="ec-summary-l">USD Surprise Index (Citi-style proxy)</div>
            <div className="ec-summary-v" style={{ color: calendar.citiProxy >= 0 ? '#00f59b' : '#ff3355' }}>
              {calendar.citiProxy >= 0 ? '+' : ''}{calendar.citiProxy}
            </div>
          </div>
          {calendar.counts && (
            <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--smoke)', textAlign: 'right' }}>
              <div>BEAT: <span style={{ color: '#00f59b' }}>{calendar.counts.beat}</span></div>
              <div>MISS: <span style={{ color: '#ff3355' }}>{calendar.counts.miss}</span></div>
              <div>INLINE: <span style={{ color: 'var(--fog)' }}>{calendar.counts.inline}</span></div>
            </div>
          )}
        </div>
      )}

      <div className="ec-filters">
        <div className="ec-filter-row">
          <span className="ec-filter-l">IMPACT</span>
          {['ALL', 'High', 'Medium'].map((i) => (
            <button key={i} className={`mt ${filter.impact === i ? 'a' : ''}`} onClick={() => setFilter((f) => ({ ...f, impact: i }))}>{i}</button>
          ))}
        </div>
        <div className="ec-filter-row">
          <span className="ec-filter-l">CCY</span>
          {['ALL', 'USD', 'EUR', 'JPY', 'GBP', 'CNY', 'CAD', 'AUD', 'CHF'].map((c) => (
            <button key={c} className={`mt ${filter.currency === c ? 'a' : ''}`} onClick={() => setFilter((f) => ({ ...f, currency: c }))}>{c}</button>
          ))}
        </div>
      </div>

      <div className="ec-list" style={{ maxHeight: 320, overflowY: 'auto' }}>
        {grouped.length === 0 && <div className="loading" style={{ padding: 16 }}>No events match these filters.</div>}
        {grouped.map(({ day, label, events }) => (
          <div key={day}>
            <div className="ec-day-h">
              <span>{label}</span>
              <span>{events.length} EVENT{events.length !== 1 ? 'S' : ''}</span>
            </div>
            {events.map((e, i) => (
              <div key={`${day}-${i}`} className="ec-row">
                <span className="ec-date">{(e.date || '').slice(11, 16) || '—'}</span>
                <div>
                  <div className="ec-event">{e.flag} {e.event}</div>
                  <div className="ec-event-c">{e.currency} · {e.impact}</div>
                </div>
                <div className="ec-vals">
                  <span>EST {e.estimate ?? '—'}</span>
                  {e.actual != null
                    ? <span style={{ color: '#cccce0', fontSize: 11 }}>ACT {e.actual}</span>
                    : <span>PRV {e.previous ?? '—'}</span>}
                </div>
                <span className={`ec-pill ${e.direction === 'beat' ? 'beat' : e.direction === 'miss' ? 'miss' : e.direction === 'inline' ? 'inline' : 'upcoming'}`}>
                  {e.direction === 'pending' ? 'pending' : e.surprisePct != null ? (e.surprisePct >= 0 ? '+' : '') + e.surprisePct.toFixed(0) + '%' : '—'}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}