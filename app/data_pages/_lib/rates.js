// Live US interest rates. Nothing in this file is a typed-in number.
//
//   Treasury curve  US Treasury daily par yield curve (home.treasury.gov), no key
//   Fed funds       New York Fed markets API (EFFR + FOMC target range), no key
//   CPI             Bureau of Labor Statistics public API, no key
//
// The risk-free rate every pricing route uses is read from the Treasury curve
// at the option's own maturity. If the Treasury site is down the 3-month rate
// falls back to FRED (when FRED_API_KEY is set) and then to the 13-week bill
// index on Yahoo. If all three fail the callers get null and say so: they do
// not substitute a constant.

import YahooFinance from 'yahoo-finance2';
import { getCached, setCache } from '../_cache';
import { getText, getJson, parseCsv, withTimeout } from './http';

const yahoo = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

// Treasury CSV column -> label and maturity in years. The page plots these ten.
export const TENORS = [
  { col: '1 Mo', label: '1M', mat: 1 / 12 },
  { col: '3 Mo', label: '3M', mat: 3 / 12 },
  { col: '6 Mo', label: '6M', mat: 6 / 12 },
  { col: '1 Yr', label: '1Y', mat: 1 },
  { col: '2 Yr', label: '2Y', mat: 2 },
  { col: '5 Yr', label: '5Y', mat: 5 },
  { col: '7 Yr', label: '7Y', mat: 7 },
  { col: '10 Yr', label: '10Y', mat: 10 },
  { col: '20 Yr', label: '20Y', mat: 20 },
  { col: '30 Yr', label: '30Y', mat: 30 },
];

export const TREASURY_SOURCE = 'US Treasury daily par yield curve';

function treasuryUrl(year) {
  return 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/'
    + `daily-treasury-rates.csv/${year}/all?type=daily_treasury_yield_curve`
    + `&field_tdr_date_value=${year}&page&_format=csv`;
}

// "11/25/2026" -> "2026-11-25"
function isoFromUsDate(s) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s || '');
  if (!m) return null;
  return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

export function parseTreasuryCsv(text) {
  return parseCsv(text)
    .map((row) => {
      const date = isoFromUsDate(row.Date);
      if (!date) return null;
      const y = {};
      for (const t of TENORS) {
        const v = parseFloat(row[t.col]);
        y[t.label] = Number.isFinite(v) ? v : null;
      }
      return { date, y };
    })
    .filter(Boolean)
    .sort((a, b) => a.date.localeCompare(b.date));
}

// One calendar year of daily curves, oldest first. Past years never change,
// so they are cached for a day; the current year for 30 minutes.
export async function treasuryYear(year, timeoutMs = 9000) {
  const key = `rates:treasury:${year}`;
  const hit = getCached(key);
  if (hit) return hit;
  const rows = parseTreasuryCsv(await getText(treasuryUrl(year), {}, timeoutMs));
  const isCurrent = year === new Date().getUTCFullYear();
  if (rows.length > 0) setCache(key, rows, isCurrent ? 30 * MIN : 24 * HOUR);
  return rows;
}

// The latest published curve. In the first days of January the new year's
// file is still empty, so fall back to the last row of the previous year.
export async function latestTreasuryCurve() {
  const year = new Date().getUTCFullYear();
  let rows = [];
  try { rows = await treasuryYear(year); } catch { rows = []; }
  if (rows.length === 0) rows = await treasuryYear(year - 1);
  if (rows.length === 0) throw new Error('Treasury curve: no rows');
  return rows[rows.length - 1];
}

// The curve on the last publication date on or before `isoDate`.
export async function treasuryCurveOn(isoDate) {
  const year = +isoDate.slice(0, 4);
  for (const y of [year, year - 1]) {
    let rows = [];
    try { rows = await treasuryYear(y); } catch { rows = []; }
    let best = null;
    for (const r of rows) { if (r.date <= isoDate) best = r; else break; }
    if (best) return best;
  }
  return null;
}

export function curvePoints(row) {
  return TENORS.map((t) => ({ label: t.label, maturity: t.mat, yield: row ? row.y[t.label] : null }));
}

// ── Risk-free rate ──────────────────────────────────────────────────────────

// Par yield in percent at maturity T (years): straight-line between the
// published tenors, flat beyond the first and last.
export function interpolateYield(points, T) {
  const pts = points.filter((p) => p.yield != null).sort((a, b) => a.maturity - b.maturity);
  if (pts.length === 0) return null;
  if (T <= pts[0].maturity) return pts[0].yield;
  if (T >= pts[pts.length - 1].maturity) return pts[pts.length - 1].yield;
  for (let i = 1; i < pts.length; i++) {
    if (T <= pts[i].maturity) {
      const a = pts[i - 1];
      const b = pts[i];
      const w = (T - a.maturity) / (b.maturity - a.maturity);
      return a.yield + w * (b.yield - a.yield);
    }
  }
  return pts[pts.length - 1].yield;
}

// Black-Scholes wants a continuously compounded rate. Treasury quotes bills
// as a simple annual yield and notes and bonds as a semi-annual one.
export function toContinuous(yieldPct, T) {
  const y = yieldPct / 100;
  if (T <= 0) return y;
  if (T <= 1) return Math.log(1 + y * T) / T;
  return 2 * Math.log(1 + y / 2);
}

async function fredLatest(seriesId) {
  const key = process.env.FRED_API_KEY;
  if (!key) return null;
  const params = new URLSearchParams({
    series_id: seriesId, api_key: key, file_type: 'json', sort_order: 'desc', limit: '15',
  });
  const j = await getJson(`https://api.stlouisfed.org/fred/series/observations?${params}`, {}, 6000);
  const obs = (j.observations || []).find((o) => o.value && o.value !== '.');
  return obs ? { value: parseFloat(obs.value), date: obs.date } : null;
}

async function yahooBill() {
  const period2 = new Date();
  const period1 = new Date(period2.getTime() - 14 * 24 * HOUR);
  const res = await withTimeout(yahoo.chart('^IRX', { period1, period2, interval: '1d' }), 6000, 'Yahoo ^IRX');
  const q = (res?.quotes || []).filter((x) => x && x.close != null);
  if (q.length === 0) return null;
  const last = q[q.length - 1];
  return { value: last.close, date: new Date(last.date).toISOString().slice(0, 10) };
}

// The discount curve the pricing routes use.
//   { points, asOf, source, flat, rateFor(T) -> continuous decimal rate }
// Returns null when no live source answers.
export async function getDiscountCurve() {
  const hit = getCached('rates:discount');
  if (hit) return withRateFor(hit);

  let base = null;
  try {
    const row = await latestTreasuryCurve();
    const points = curvePoints(row);
    if (points.some((p) => p.yield != null)) {
      base = { points, asOf: row.date, source: TREASURY_SOURCE, flat: false };
    }
  } catch { /* next source */ }

  if (!base) {
    try {
      const f = await fredLatest('DGS3MO');
      if (f) base = { points: [{ label: '3M', maturity: 0.25, yield: f.value }], asOf: f.date, source: 'FRED DGS3MO (3-month Treasury)', flat: true };
    } catch { /* next source */ }
  }

  if (!base) {
    try {
      const b = await yahooBill();
      if (b) base = { points: [{ label: '3M', maturity: 0.25, yield: b.value }], asOf: b.date, source: 'Yahoo ^IRX (13-week Treasury bill)', flat: true };
    } catch { /* give up */ }
  }

  if (!base) return null;
  setCache('rates:discount', base, 30 * MIN);
  return withRateFor(base);
}

function withRateFor(base) {
  return {
    ...base,
    rateFor(T) {
      const y = interpolateYield(base.points, T);
      return y == null ? null : toContinuous(y, T);
    },
  };
}

// The headline number: the 3-month Treasury yield.
export async function getRiskFree() {
  const curve = await getDiscountCurve();
  if (!curve) return null;
  const pct = interpolateYield(curve.points, 0.25);
  if (pct == null) return null;
  return {
    rate: +(pct / 100).toFixed(6),
    pct: +pct.toFixed(3),
    tenor: '3M',
    asOf: curve.asOf,
    source: curve.source,
    points: curve.points,
  };
}

// ── Fed funds ───────────────────────────────────────────────────────────────

export async function getFedFunds() {
  const hit = getCached('rates:fedfunds');
  if (hit) return hit;
  const j = await getJson('https://markets.newyorkfed.org/api/rates/unsecured/effr/last/1.json', {}, 6000);
  const r = j?.refRates?.[0];
  if (!r || typeof r.percentRate !== 'number') throw new Error('NY Fed: no EFFR in response');
  const out = {
    effr: r.percentRate,
    targetLower: r.targetRateFrom ?? null,
    targetUpper: r.targetRateTo ?? null,
    asOf: r.effectiveDate,
    source: 'Federal Reserve Bank of New York',
  };
  setCache('rates:fedfunds', out, HOUR);
  return out;
}

// ── CPI ─────────────────────────────────────────────────────────────────────

// All-items CPI for urban consumers, not seasonally adjusted (the series the
// headline year-over-year figure is quoted from).
export async function getCpi() {
  const hit = getCached('rates:cpi');
  if (hit) return hit;
  const year = new Date().getUTCFullYear();
  const j = await getJson(
    `https://api.bls.gov/publicAPI/v2/timeseries/data/CUUR0000SA0?startyear=${year - 2}&endyear=${year}`,
    {}, 7000,
  );
  const rows = (j?.Results?.series?.[0]?.data || [])
    .filter((d) => /^M(0[1-9]|1[0-2])$/.test(d.period) && Number.isFinite(parseFloat(d.value)))
    .map((d) => ({ ym: `${d.year}-${d.period.slice(1)}`, value: parseFloat(d.value) }))
    .sort((a, b) => b.ym.localeCompare(a.ym));
  if (rows.length === 0) throw new Error('BLS: no CPI rows');
  const latest = rows[0];
  const priorYm = `${+latest.ym.slice(0, 4) - 1}-${latest.ym.slice(5)}`;
  const prior = rows.find((r) => r.ym === priorYm);
  const out = {
    index: latest.value,
    period: latest.ym,
    // Year over year needs the same month a year earlier. If BLS did not
    // publish that month the figure is left empty, not estimated.
    yoyPct: prior ? +(((latest.value / prior.value) - 1) * 100).toFixed(2) : null,
    source: 'Bureau of Labor Statistics, CPI-U all items (CUUR0000SA0)',
  };
  setCache('rates:cpi', out, 12 * HOUR);
  return out;
}
