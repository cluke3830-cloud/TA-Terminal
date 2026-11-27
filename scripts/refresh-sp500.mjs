// Rebuilds app/lib/sp500.js from the constituents table on Wikipedia
// ("List of S&P 500 companies"). Run weekly by
// .github/workflows/refresh-universe.yml, which commits the file when it
// changed. Two guards stop a broken page from wiping the list: the count must
// look like the S&P 500, and one run may not swap more than 25 names.

import { readFileSync, writeFileSync } from 'node:fs';

const FILE = new URL('../app/lib/sp500.js', import.meta.url);
const API = 'https://en.wikipedia.org/w/api.php?action=parse&page=List_of_S%26P_500_companies'
  + '&prop=wikitext&section=1&format=json&formatversion=2';

const r = await fetch(API, {
  headers: { 'User-Agent': 'TA-Terminal/2.1 (weekly S&P 500 list refresh; github.com/cluke3830-cloud/TA-Terminal)' },
  signal: AbortSignal.timeout(30000),
});
if (!r.ok) throw new Error(`Wikipedia HTTP ${r.status}`);
const wikitext = (await r.json())?.parse?.wikitext || '';

// Each table row starts with a cell like "{{NyseSymbol|MMM}}".
const symbols = [...new Set(
  wikitext.split('\n|-').slice(1)
    .map((row) => /\{\{[^{}|]+\|([A-Z][A-Z0-9.\-]*)\}\}/.exec(row.trim().split('\n')[0] || '')?.[1])
    .filter(Boolean),
)].sort();

if (symbols.length < 490 || symbols.length > 515) {
  throw new Error(`Refusing to write: parsed ${symbols.length} symbols, expected about 503`);
}

const before = [...readFileSync(FILE, 'utf8').matchAll(/'([A-Z][A-Z0-9.\-]*)'/g)].map((m) => m[1]);
const added = symbols.filter((s) => !before.includes(s));
const removed = before.filter((s) => !symbols.includes(s));
// The first automated run replaces a hand-kept list, so it may move more.
const limit = process.env.SP500_MAX_SWAPS ? +process.env.SP500_MAX_SWAPS : 25;
if (added.length > limit || removed.length > limit) {
  throw new Error(`Refusing to write: ${added.length} added and ${removed.length} removed in one run (limit ${limit})`);
}

if (added.length === 0 && removed.length === 0) {
  console.log(`No change: ${symbols.length} symbols.`);
  process.exit(0);
}

const rows = [];
for (let i = 0; i < symbols.length; i += 12) {
  rows.push(`  ${symbols.slice(i, i + 12).map((s) => `'${s}'`).join(',')},`);
}
writeFileSync(FILE, [
  '// S&P 500 tickers, the default screener universe.',
  '// Written by scripts/refresh-sp500.mjs from the constituents table on Wikipedia.',
  '// Do not edit by hand: the weekly GitHub workflow overwrites this file.',
  `// Last change: ${new Date().toISOString().slice(0, 10)} (${symbols.length} symbols).`,
  '',
  'export const SP500 = [',
  ...rows,
  '];',
  '',
].join('\n'));
console.log(`Updated: ${symbols.length} symbols. Added ${added.join(', ') || 'none'}. Removed ${removed.join(', ') || 'none'}.`);
