// Central bank policy rates, read live from the Bank for International
// Settlements' daily policy-rate series (dataset WS_CBPOL, no key). The level,
// the previous level and the date of the last change all come from that
// history. This file holds names and codes only, never a rate.
//
// For the Federal Reserve the BIS reports the midpoint of the target range;
// the range itself is added from the New York Fed.

import { getCached, setCache } from '../_cache';
import { getText, getJson, parseCsv } from './http';
import { getFedFunds } from './rates';

const BANKS = [
  { area: 'US', name: 'Federal Reserve',        abbr: 'FED',  country: 'US', flag: '🇺🇸', currency: 'USD', meetingKeywords: ['Fed Interest Rate', 'FOMC'] },
  { area: 'XM', name: 'European Central Bank',  abbr: 'ECB',  country: 'EU', flag: '🇪🇺', currency: 'EUR', meetingKeywords: ['ECB Interest Rate', 'ECB Main'] },
  { area: 'JP', name: 'Bank of Japan',          abbr: 'BOJ',  country: 'JP', flag: '🇯🇵', currency: 'JPY', meetingKeywords: ['BoJ Interest Rate', 'Japan Interest'] },
  { area: 'GB', name: 'Bank of England',        abbr: 'BOE',  country: 'GB', flag: '🇬🇧', currency: 'GBP', meetingKeywords: ['BoE Interest Rate', 'UK Interest'] },
  { area: 'CN', name: "People's Bank of China", abbr: 'PBOC', country: 'CN', flag: '🇨🇳', currency: 'CNY', meetingKeywords: ['PBoC', 'China Loan'] },
  { area: 'AU', name: 'Reserve Bank Australia', abbr: 'RBA',  country: 'AU', flag: '🇦🇺', currency: 'AUD', meetingKeywords: ['RBA Interest', 'Australia Interest'] },
  { area: 'CH', name: 'Swiss National Bank',    abbr: 'SNB',  country: 'CH', flag: '🇨🇭', currency: 'CHF', meetingKeywords: ['SNB Interest', 'Switzerland Interest'] },
  { area: 'CA', name: 'Bank of Canada',         abbr: 'BOC',  country: 'CA', flag: '🇨🇦', currency: 'CAD', meetingKeywords: ['BoC Interest', 'Canada Interest'] },
];

const SOURCE = 'BIS central bank policy rates (WS_CBPOL), daily';
const DAY = 24 * 60 * 60 * 1000;

// A move older than this is shown as "hold": the bank has not acted in a year.
const TREND_WINDOW_DAYS = 365;

function isoYearsAgo(years) {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
}

// -> { US: [{ date, value }, ...oldest first], ... }
export function parseBisCsv(text) {
  const by = {};
  for (const row of parseCsv(text)) {
    const v = parseFloat(row.OBS_VALUE);
    if (!row.REF_AREA || !row.TIME_PERIOD || !Number.isFinite(v)) continue;
    (by[row.REF_AREA] = by[row.REF_AREA] || []).push({ date: row.TIME_PERIOD, value: v });
  }
  Object.values(by).forEach((arr) => arr.sort((a, b) => a.date.localeCompare(b.date)));
  return by;
}

// Level, previous level and last change date from one bank's daily history.
export function summarize(series, today = new Date()) {
  if (!series || series.length === 0) return null;
  const last = series[series.length - 1];
  let prevRate = null;
  let lastChange = null;
  for (let i = series.length - 1; i > 0; i--) {
    if (series[i].value !== series[i - 1].value) {
      prevRate = series[i - 1].value;
      lastChange = series[i].date;
      break;
    }
  }
  let trend = 'hold';
  if (lastChange) {
    const ageDays = (today.getTime() - new Date(`${lastChange}T00:00:00Z`).getTime()) / DAY;
    if (ageDays <= TREND_WINDOW_DAYS) trend = last.value < prevRate ? 'cut' : 'hike';
  }
  return {
    rate: last.value,
    prevRate,
    change: prevRate != null ? +(last.value - prevRate).toFixed(3) : null,
    lastChange,
    trend,
    asOf: last.date,
  };
}

async function fmpMeetings() {
  const KEY = process.env.FMP_API_KEY;
  if (!KEY) return [];
  try {
    const today = new Date();
    const future = new Date(today.getTime() + 90 * DAY);
    const from = today.toISOString().slice(0, 10);
    const to = future.toISOString().slice(0, 10);
    const j = await getJson(
      `https://financialmodelingprep.com/stable/economic-calendar?from=${from}&to=${to}&apikey=${KEY}`, {}, 6000,
    );
    return Array.isArray(j) ? j : [];
  } catch { return []; }
}

export async function loadCentralBanks() {
  const cached = getCached('macro:centralbanks');
  if (cached) return cached;

  const areas = BANKS.map((b) => b.area).join('+');
  const url = `https://stats.bis.org/api/v1/data/WS_CBPOL/D.${areas}`
    + `?startPeriod=${isoYearsAgo(3)}&format=csv&detail=dataonly`;

  const [bisText, fed, calendarEvents] = await Promise.all([
    getText(url, {}, 12000),
    getFedFunds().catch(() => null),
    fmpMeetings(),
  ]);
  const history = parseBisCsv(bisText);

  const banks = BANKS.map((b) => {
    const s = summarize(history[b.area]);
    if (!s) return null;

    let range = null;
    if (b.area === 'US' && fed && fed.targetLower != null && fed.targetUpper != null) {
      range = { lower: fed.targetLower, upper: fed.targetUpper };
      const mid = (fed.targetLower + fed.targetUpper) / 2;
      // The New York Fed shows a decision the day after it is made; the BIS
      // file can be a few days behind. If they differ, the newer one wins.
      if (Math.abs(mid - s.rate) > 1e-9 && fed.asOf > s.asOf) {
        s.prevRate = s.rate;
        s.rate = mid;
        s.change = +(s.rate - s.prevRate).toFixed(3);
        s.lastChange = fed.asOf;
        s.trend = s.rate < s.prevRate ? 'cut' : 'hike';
        s.asOf = fed.asOf;
      }
    }

    const matches = calendarEvents
      .filter((e) => {
        const ev = (e.event || '').toLowerCase();
        return b.meetingKeywords.some((k) => ev.includes(k.toLowerCase()));
      })
      .sort((x, y) => new Date(x.date) - new Date(y.date));

    return {
      name: b.name, abbr: b.abbr, country: b.country, flag: b.flag, currency: b.currency,
      ...s,
      range,
      nextMeeting: matches[0]?.date?.slice(0, 10) || null,
      nextEvent: matches[0]?.event || null,
    };
  }).filter(Boolean);

  if (banks.length === 0) throw new Error('BIS returned no policy rates');

  const data = { banks, source: SOURCE, lastUpdated: new Date().toISOString() };
  setCache('macro:centralbanks', data, 60 * 60 * 1000);
  return data;
}
