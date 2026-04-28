import { getCached, setCache } from '../../_cache';

const CC_FLAG = {
  USD: '🇺🇸', EUR: '🇪🇺', JPY: '🇯🇵', GBP: '🇬🇧', CNY: '🇨🇳', AUD: '🇦🇺',
  CAD: '🇨🇦', CHF: '🇨🇭', NZD: '🇳🇿', SEK: '🇸🇪', NOK: '🇳🇴', BRL: '🇧🇷',
  INR: '🇮🇳', KRW: '🇰🇷', MXN: '🇲🇽', ZAR: '🇿🇦',
};

function parseNum(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  const s = String(v).replace(/[^\d.\-]/g, '');
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

export async function GET() {
  const cached = getCached('macro:calendar');
  if (cached) return Response.json(cached);

  const KEY = process.env.FMP_API_KEY;
  if (!KEY) return Response.json({ error: 'FMP_API_KEY not configured' }, { status: 500 });

  try {
    const today = new Date();
    const past = new Date(today); past.setDate(today.getDate() - 7);
    const future = new Date(today); future.setDate(today.getDate() + 21);
    const from = past.toISOString().slice(0, 10);
    const to = future.toISOString().slice(0, 10);

    const r = await fetch(`https://financialmodelingprep.com/stable/economic-calendar?from=${from}&to=${to}&apikey=${KEY}`, { cache: 'no-store' });
    if (!r.ok) throw new Error('FMP calendar fetch failed');
    const raw = await r.json();
    if (!Array.isArray(raw)) throw new Error('Unexpected calendar response');

    const events = raw
      .filter((e) => e.event && (e.impact === 'High' || e.impact === 'Medium'))
      .map((e) => {
        const actual = parseNum(e.actual);
        const estimate = parseNum(e.estimate);
        const previous = parseNum(e.previous);
        let surprisePct = null;
        let direction = 'pending';
        if (actual != null && estimate != null) {
          if (estimate === 0) {
            surprisePct = actual === 0 ? 0 : (actual > 0 ? 100 : -100);
          } else {
            surprisePct = ((actual - estimate) / Math.abs(estimate)) * 100;
          }
          if (surprisePct > 2) direction = 'beat';
          else if (surprisePct < -2) direction = 'miss';
          else direction = 'inline';
        }
        const cur = (e.currency || '').toUpperCase();
        return {
          date: e.date,
          country: e.country || cur,
          currency: cur,
          flag: CC_FLAG[cur] || '🌐',
          event: e.event,
          actual,
          estimate,
          previous,
          impact: e.impact,
          surprisePct: surprisePct != null ? +surprisePct.toFixed(1) : null,
          direction,
          unit: e.unit || '',
        };
      })
      .sort((a, b) => new Date(b.date) - new Date(a.date));

    const recentUSD = events.filter((e) => e.currency === 'USD' && e.surprisePct != null).slice(0, 12);
    const citiProxy = recentUSD.length > 0
      ? +(recentUSD.reduce((s, e) => s + Math.max(-50, Math.min(50, e.surprisePct)), 0) / recentUSD.length).toFixed(1)
      : 0;

    const upcoming = events.filter((e) => new Date(e.date) >= new Date(today.setHours(0, 0, 0, 0))).reverse().slice(0, 30);
    const recent = events.filter((e) => e.surprisePct != null).slice(0, 25);

    const data = {
      upcoming,
      recent,
      citiProxy,
      counts: {
        beat: events.filter((e) => e.direction === 'beat').length,
        miss: events.filter((e) => e.direction === 'miss').length,
        inline: events.filter((e) => e.direction === 'inline').length,
      },
      lastUpdated: new Date().toISOString(),
    };
    setCache('macro:calendar', data);
    return Response.json(data);
  } catch (e) {
    return Response.json({ error: e.message || 'Calendar fetch failed' }, { status: 500 });
  }
}