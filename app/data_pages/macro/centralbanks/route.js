export const dynamic = 'force-dynamic';

import { getCached, setCache } from '../../_cache';

// Snapshot of policy rates — manually maintained. Update when rates change.
// Source: each central bank's official policy rate target (mid-2025 levels).
const BANKS = [
  { name: 'Federal Reserve',        abbr: 'FED',  country: 'US', flag: '🇺🇸', currency: 'USD', rate: 4.50, prevRate: 4.75, lastChange: '2025-09-18', trend: 'cut',  meetingKeywords: ['Fed Interest Rate', 'FOMC'] },
  { name: 'European Central Bank',  abbr: 'ECB',  country: 'EU', flag: '🇪🇺', currency: 'EUR', rate: 2.50, prevRate: 2.75, lastChange: '2025-03-06', trend: 'cut',  meetingKeywords: ['ECB Interest Rate', 'ECB Main'] },
  { name: 'Bank of Japan',          abbr: 'BOJ',  country: 'JP', flag: '🇯🇵', currency: 'JPY', rate: 0.50, prevRate: 0.25, lastChange: '2025-01-24', trend: 'hike', meetingKeywords: ['BoJ Interest Rate', 'Japan Interest'] },
  { name: 'Bank of England',        abbr: 'BOE',  country: 'GB', flag: '🇬🇧', currency: 'GBP', rate: 4.25, prevRate: 4.50, lastChange: '2025-05-08', trend: 'cut',  meetingKeywords: ['BoE Interest Rate', 'UK Interest'] },
  { name: "People's Bank of China", abbr: 'PBOC', country: 'CN', flag: '🇨🇳', currency: 'CNY', rate: 3.10, prevRate: 3.10, lastChange: '2024-10-21', trend: 'hold', meetingKeywords: ['PBoC', 'China Loan'] },
  { name: 'Reserve Bank Australia', abbr: 'RBA',  country: 'AU', flag: '🇦🇺', currency: 'AUD', rate: 4.10, prevRate: 4.35, lastChange: '2025-02-18', trend: 'cut',  meetingKeywords: ['RBA Interest', 'Australia Interest'] },
  { name: 'Swiss National Bank',    abbr: 'SNB',  country: 'CH', flag: '🇨🇭', currency: 'CHF', rate: 0.25, prevRate: 0.50, lastChange: '2025-03-20', trend: 'cut',  meetingKeywords: ['SNB Interest', 'Switzerland Interest'] },
  { name: 'Bank of Canada',         abbr: 'BOC',  country: 'CA', flag: '🇨🇦', currency: 'CAD', rate: 2.75, prevRate: 3.00, lastChange: '2025-03-12', trend: 'cut',  meetingKeywords: ['BoC Interest', 'Canada Interest'] },
];

export async function GET() {
  const cached = getCached('macro:centralbanks');
  if (cached) return Response.json(cached);

  const KEY = process.env.FMP_API_KEY;
  let calendarEvents = [];
  if (KEY) {
    try {
      const today = new Date();
      const future = new Date(today);
      future.setDate(today.getDate() + 90);
      const from = today.toISOString().slice(0, 10);
      const to = future.toISOString().slice(0, 10);
      const r = await fetch(`https://financialmodelingprep.com/stable/economic-calendar?from=${from}&to=${to}&apikey=${KEY}`, { cache: 'no-store' });
      if (r.ok) calendarEvents = await r.json();
    } catch (_) { /* ignore */ }
  }

  const banks = BANKS.map((b) => {
    let nextMeeting = null;
    let nextEvent = null;
    if (Array.isArray(calendarEvents)) {
      const matches = calendarEvents
        .filter((e) => {
          const ev = (e.event || '').toLowerCase();
          return b.meetingKeywords.some((k) => ev.includes(k.toLowerCase()));
        })
        .sort((a, b) => new Date(a.date) - new Date(b.date));
      if (matches.length > 0) {
        nextMeeting = matches[0].date?.slice(0, 10) || null;
        nextEvent = matches[0].event;
      }
    }
    return {
      name: b.name,
      abbr: b.abbr,
      country: b.country,
      flag: b.flag,
      currency: b.currency,
      rate: b.rate,
      prevRate: b.prevRate,
      change: +(b.rate - b.prevRate).toFixed(2),
      lastChange: b.lastChange,
      trend: b.trend,
      nextMeeting,
      nextEvent,
    };
  });

  const data = { banks, lastUpdated: new Date().toISOString() };
  setCache('macro:centralbanks', data);
  return Response.json(data);
}