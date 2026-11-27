// Calls every live data route of a deployed TA Terminal and fails when a
// source is broken or stale. Run by .github/workflows/data-health.yml on a
// schedule, so nobody has to open the site to find out a feed died.
//
//   BASE_URL=https://ta-terminal-orcin.vercel.app node scripts/check-live-data.mjs
//
// Exit code 0 = every check passed, 1 = at least one failed. A Markdown
// report is written to REPORT_FILE (default data-health-report.md).

import { writeFileSync } from 'node:fs';

const BASE = (process.env.BASE_URL || 'https://ta-terminal-orcin.vercel.app').replace(/\/$/, '');
const REPORT_FILE = process.env.REPORT_FILE || 'data-health-report.md';
const DAY = 24 * 60 * 60 * 1000;

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const ageDays = (iso) => (Date.now() - new Date(`${String(iso).slice(0, 10)}T00:00:00Z`).getTime()) / DAY;
// "as of" dates may lag by weekends and holidays; maxDays allows for that.
const fresh = (iso, maxDays) => !!iso && ageDays(iso) <= maxDays;

function need(cond, msg, problems) { if (!cond) problems.push(msg); }

const CHECKS = [
  {
    name: 'Risk-free rate (Treasury 3M)', path: '/data_pages/macro/riskfree',
    test(d, p) {
      need(isNum(d.rate) && d.rate > -0.02 && d.rate < 0.25, `rate looks wrong: ${d.rate}`, p);
      need(fresh(d.asOf, 7), `as-of date is old or missing: ${d.asOf}`, p);
      return `${(d.rate * 100).toFixed(2)}% as of ${d.asOf} (${d.source})`;
    },
  },
  {
    name: 'Yield curve, fed funds, CPI', path: '/data_pages/macro/yields',
    test(d, p) {
      const filled = (d.current || []).filter((x) => isNum(x.yield)).length;
      need(filled >= 8, `only ${filled} of 10 curve points have a yield`, p);
      need(fresh(d.asOf, 7), `curve as-of date is old or missing: ${d.asOf}`, p);
      need(isNum(d.fedFundsRate), 'fed funds rate is missing', p);
      need(isNum(d.cpiLatest), 'CPI index is missing', p);
      need(!d.errors, `sources reported errors: ${JSON.stringify(d.errors)}`, p);
      return `curve ${d.asOf}, fed funds ${d.fedFundsRate}, CPI ${d.cpiPeriod}`;
    },
  },
  {
    name: 'Central bank policy rates', path: '/data_pages/macro/centralbanks',
    test(d, p) {
      const banks = d.banks || [];
      need(banks.length === 8, `expected 8 banks, got ${banks.length}`, p);
      for (const b of banks) {
        need(isNum(b.rate), `${b.abbr}: rate missing`, p);
        need(fresh(b.asOf, 21), `${b.abbr}: latest reading is old (${b.asOf})`, p);
      }
      return banks.map((b) => `${b.abbr} ${b.rate}`).join(', ');
    },
  },
  {
    name: 'Fear & Greed composite', path: '/data_pages/macro/feargreed',
    test(d, p) {
      need(isNum(d.score) && d.score >= 0 && d.score <= 100, `score out of range: ${d.score}`, p);
      need((d.components || []).length === 5, 'expected 5 gauges', p);
      need(fresh(d.asOf, 7), `as-of date is old or missing: ${d.asOf}`, p);
      return `${d.score} ${d.label} as of ${d.asOf}`;
    },
  },
  {
    name: 'VIX term structure', path: '/data_pages/macro/vix',
    test(d, p) {
      need(isNum(d.current?.VIX), 'VIX missing', p);
      need(isNum(d.current?.ratio), 'VIX/VIX3M ratio missing', p);
      need(fresh(d.current?.ratioAsOf, 7), `ratio as-of date is old: ${d.current?.ratioAsOf}`, p);
      return `VIX ${d.current?.VIX}, ratio ${d.current?.ratio} (${d.current?.ratioAsOf})`;
    },
  },
  {
    name: 'FX matrix', path: '/data_pages/macro/fx',
    test(d, p) {
      need(fresh(d.anchors?.latest, 7), `latest fixing is old: ${d.anchors?.latest}`, p);
      need(isNum(d.usdRates?.EUR), 'EUR rate missing', p);
      return `fixing ${d.anchors?.latest}`;
    },
  },
  {
    name: 'Commodities', path: '/data_pages/macro/commodities',
    test(d, p) {
      const priced = (d.commodities || []).filter((c) => isNum(c.price)).length;
      need(priced >= 12, `only ${priced} commodities have a price`, p);
      return `${priced} priced`;
    },
  },
  {
    name: 'Reserve currencies and holders', path: '/data_pages/macro/flows',
    test(d, p) {
      need((d.reserveComposition || []).length >= 8, 'reserve currency shares missing', p);
      const m = /^(\d{4})-Q([1-4])$/.exec(d.compositionPeriod || '');
      const quartersOld = m ? (new Date().getUTCFullYear() - +m[1]) * 4 + (Math.floor(new Date().getUTCMonth() / 3) + 1 - +m[2]) : 99;
      need(quartersOld <= 5, `COFER quarter is old or missing: ${d.compositionPeriod}`, p);
      need((d.reserveHolders || []).length >= 30, 'reserve holders missing', p);
      need(!d.errors, `sources reported errors: ${JSON.stringify(d.errors)}`, p);
      return `COFER ${d.compositionPeriod}, ${d.reserveHolders?.length} holders`;
    },
  },
  {
    name: 'Political stability map', path: '/data_pages/macro/geopolitical?view=risk',
    test(d, p) {
      need((d.data || []).length >= 150, `only ${d.data?.length} countries`, p);
      need(+d.year >= new Date().getUTCFullYear() - 3, `survey year is old: ${d.year}`, p);
      return `${d.data?.length} countries, ${d.year}`;
    },
  },
  {
    name: 'Oil reserves map', path: '/data_pages/macro/geopolitical?view=oil',
    test(d, p) {
      need((d.data || []).length >= 20, `only ${d.data?.length} countries`, p);
      return `${d.data?.length} countries, ${d.year}`;
    },
  },
  {
    name: 'Quotes', path: '/data_pages/quote?symbols=SPY,AAPL',
    test(d, p) {
      need((d.quotes || []).length === 2 && d.quotes.every((q) => isNum(q.price) && q.price > 0), 'quotes missing', p);
      return (d.quotes || []).map((q) => `${q.symbol} ${q.price}`).join(', ');
    },
  },
  {
    name: 'Option surface discount rate', path: '/data_pages/options?symbol=SPY',
    test(d, p) {
      // The surface itself can be empty outside market hours; the rate and
      // the spot price must still be live.
      need(isNum(d.r), `discount rate missing (${d.error || d.msg || 'no reason given'})`, p);
      need(fresh(d.rAsOf, 7), `rate as-of date is old or missing: ${d.rAsOf}`, p);
      need(isNum(d.spot) && d.spot > 0, 'spot price missing', p);
      return `r ${isNum(d.r) ? (d.r * 100).toFixed(2) : '?'}% (${d.rAsOf}), ${d.surface?.length ?? 0} surface points`;
    },
  },
  {
    name: 'News', path: '/data_pages/news?symbol=AAPL',
    test(d, p) {
      need((d.articles || []).length > 0, 'no articles', p);
      return `${d.articles?.length} articles`;
    },
  },
];

async function runCheck(c) {
  const problems = [];
  let detail = '';
  const t0 = Date.now();
  try {
    const r = await fetch(`${BASE}${c.path}`, { signal: AbortSignal.timeout(45000), headers: { 'User-Agent': 'TA-Terminal-health-check' } });
    const text = await r.text();
    let d = null;
    try { d = JSON.parse(text); } catch { problems.push(`HTTP ${r.status}, body is not JSON: ${text.slice(0, 80)}`); }
    if (d) {
      if (!r.ok) problems.push(`HTTP ${r.status}: ${d.error || 'no error text'}`);
      else if (d.error) problems.push(`route returned an error: ${d.error}`);
      if (r.ok) detail = c.test(d, problems) || '';
    }
  } catch (e) {
    problems.push(`request failed: ${e.message}`);
  }
  return { name: c.name, path: c.path, ok: problems.length === 0, problems, detail, ms: Date.now() - t0 };
}

const results = [];
for (const c of CHECKS) {
  let res = await runCheck(c);
  // One retry: a cold serverless start or a single upstream blip is not an outage.
  if (!res.ok) { await new Promise((r) => setTimeout(r, 15000)); res = await runCheck(c); }
  results.push(res);
  console.log(`${res.ok ? 'PASS' : 'FAIL'}  ${res.name}  ${res.ok ? res.detail : res.problems.join('; ')}`);
}

const failed = results.filter((r) => !r.ok);
const lines = [
  `# TA Terminal data health: ${failed.length === 0 ? 'all sources live' : `${failed.length} of ${results.length} checks failed`}`,
  '',
  `Checked ${BASE} at ${new Date().toISOString()}.`,
  '',
  '| Check | Result | Detail |',
  '|---|---|---|',
  ...results.map((r) => `| ${r.name} | ${r.ok ? 'pass' : '**FAIL**'} | ${(r.ok ? r.detail : r.problems.join('; ')).replace(/\|/g, '/')} |`),
  '',
];
writeFileSync(REPORT_FILE, lines.join('\n'));
process.exit(failed.length === 0 ? 0 : 1);
