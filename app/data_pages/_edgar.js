// Shared SEC EDGAR utilities — no API key required.
// Policy requires a descriptive User-Agent with contact info.
// Rate limit: 10 requests/second max.

export const EDGAR_HEADERS = {
  'User-Agent': 'Quantum Terminal contact@quantum-terminal.dev',
  'Accept': 'application/json',
};

// ── Ticker → CIK lookup (refreshed once per day, shared across routes) ──────
let _tickerMap = null;
let _tickerMapTs = 0;

export async function getCIK(symbol) {
  const now = Date.now();
  if (!_tickerMap || now - _tickerMapTs > 24 * 3600 * 1000) {
    try {
      const r = await fetch('https://www.sec.gov/files/company_tickers.json', { headers: EDGAR_HEADERS });
      if (!r.ok) return null;
      const j = await r.json();
      _tickerMap = new Map(
        Object.values(j).map(row => [row.ticker?.toUpperCase(), String(row.cik_str).padStart(10, '0')])
      );
      _tickerMapTs = now;
    } catch { return null; }
  }
  return _tickerMap?.get(symbol.toUpperCase()) ?? null;
}

// ── XBRL companyconcept fetcher ──────────────────────────────────────────────
export async function fetchConcept(cik, conceptName) {
  try {
    const r = await fetch(
      `https://data.sec.gov/api/xbrl/companyconcept/CIK${cik}/us-gaap/${conceptName}.json`,
      { headers: EDGAR_HEADERS }
    );
    if (!r.ok) return [];
    const j = await r.json();
    return j?.units?.USD ?? [];
  } catch { return []; }
}

// Try concept names in order, return first with data
export async function bestConcept(cik, ...names) {
  for (const name of names) {
    const data = await fetchConcept(cik, name);
    if (data.length) return data;
  }
  return [];
}

// Extract last N distinct quarterly/annual periods from XBRL concept data.
// Deduplicates by end date, keeping the latest amended filing.
export function quarterly(data, n = 5) {
  if (!data?.length) return [];
  const byEnd = new Map();
  for (const e of data) {
    if (!e.end || !['10-Q', '10-K'].includes(e.form)) continue;
    const prev = byEnd.get(e.end);
    if (!prev || e.filed > prev.filed) byEnd.set(e.end, e);
  }
  return [...byEnd.values()]
    .sort((a, b) => b.end.localeCompare(a.end))
    .slice(0, n);
}

export function matchVal(data, endDate) {
  return data.find(e => e.end === endDate && ['10-Q', '10-K'].includes(e.form))?.val ?? null;
}

export function periodLabel(e) {
  if (e.fp === 'FY') return 'FY';
  if (/^Q[1-4]$/.test(e.fp ?? '')) return e.fp;
  const m = parseInt(e.end?.slice(5, 7) ?? '3', 10);
  return `Q${Math.ceil(m / 3)}`;
}

// ── Form 4 XML parsing ───────────────────────────────────────────────────────

// Extracts content of a tag, unwrapping inner <value> if present.
// Works for both <tag>val</tag> and <tag><value>val</value></tag> patterns.
export function xmlVal(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const outer = xml.match(re)?.[1] ?? '';
  const inner = outer.match(/<value>\s*([\s\S]*?)\s*<\/value>/i)?.[1];
  return (inner ?? outer).replace(/<[^>]+>/g, '').trim() || null;
}

// Returns all occurrences of a tag block as raw XML strings
export function xmlAll(xml, tag) {
  const results = [];
  const re = new RegExp(`<${tag}[^>]*>[\\s\\S]*?</${tag}>`, 'gi');
  let m;
  while ((m = re.exec(xml)) !== null) results.push(m[0]);
  return results;
}

// Parse a single Form 4 XML file, return array of transaction objects.
// Handles both nonDerivativeTransaction (open-market) and
// derivativeTransaction (options/RSUs) — needed for execs like NVDA's.
export async function parseForm4XML(cik, accNo, primaryDoc) {
  const accNoDash = accNo.replace(/-/g, '');
  const intCik = parseInt(cik, 10);
  const url = `https://www.sec.gov/Archives/edgar/data/${intCik}/${accNoDash}/${primaryDoc}`;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': EDGAR_HEADERS['User-Agent'] } });
    if (!r.ok) return [];
    const xml = await r.text();

    const ownerName = xmlVal(xml, 'rptOwnerName');
    const title = xmlVal(xml, 'officerTitle') || xmlVal(xml, 'relationship');

    const rows = [];

    // Open-market buys/sells
    for (const block of xmlAll(xml, 'nonDerivativeTransaction')) {
      const date = xmlVal(block, 'transactionDate')?.slice(0, 10) ?? null;
      const shares = parseFloat(xmlVal(block, 'transactionShares') ?? '0') || 0;
      const price = parseFloat(xmlVal(block, 'transactionPricePerShare') ?? '0') || 0;
      // A = Acquired (BUY), D = Disposed (SELL), F = tax withholding (skip)
      const code = (xmlVal(block, 'transactionAcquiredDisposedCode') ?? '').toUpperCase();
      if (!date || shares === 0 || code === 'F') continue;
      rows.push({
        date, insider: ownerName, title,
        type: code === 'A' ? 'BUY' : code === 'D' ? 'SELL' : 'OTHER',
        rawCode: code, shares, price, value: shares * price, link: url,
      });
    }

    // Derivative transactions: option exercises, RSU vests (common for tech execs)
    for (const block of xmlAll(xml, 'derivativeTransaction')) {
      const date = xmlVal(block, 'transactionDate')?.slice(0, 10) ?? null;
      // derivativeTransaction uses underlyingSecurityShares for the share count
      const shares = parseFloat(xmlVal(block, 'transactionShares') ?? xmlVal(block, 'underlyingSecurityShares') ?? '0') || 0;
      const price = parseFloat(xmlVal(block, 'transactionPricePerShare') ?? xmlVal(block, 'conversionOrExercisePrice') ?? '0') || 0;
      const code = (xmlVal(block, 'transactionAcquiredDisposedCode') ?? '').toUpperCase();
      if (!date || shares === 0) continue;
      rows.push({
        date, insider: ownerName, title,
        type: code === 'A' ? 'BUY' : code === 'D' ? 'SELL' : 'OTHER',
        rawCode: `D-${code}`, shares, price, value: shares * price, link: url,
      });
    }

    return rows;
  } catch { return []; }
}

// Fetch tasks in small parallel batches to stay well under 10 req/sec
export async function batchFetch(tasks, batchSize = 5, delayMs = 600) {
  const results = [];
  for (let i = 0; i < tasks.length; i += batchSize) {
    const batch = tasks.slice(i, i + batchSize).map(t => t());
    results.push(...await Promise.all(batch));
    if (i + batchSize < tasks.length) await new Promise(res => setTimeout(res, delayMs));
  }
  return results;
}