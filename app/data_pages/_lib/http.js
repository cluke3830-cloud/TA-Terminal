// Shared fetch helpers for the data routes.
//
// Every upstream call goes through here so that one slow source can never
// hold a serverless function until it times out. A failed call returns null
// (or throws for the *OrThrow variants); routes report which source failed
// instead of filling the gap with an invented number.

// A plain product token. It names this client truthfully and is not dressed
// up as a browser. (Treasury.gov delays agents that carry a URL by ~18 s.)
export const UA = 'TA-Terminal/2.1';

export async function fetchWithTimeout(url, opts = {}, ms = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, {
      cache: 'no-store',
      ...opts,
      headers: { 'User-Agent': UA, ...(opts.headers || {}) },
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function getText(url, opts = {}, ms = 8000) {
  const r = await fetchWithTimeout(url, opts, ms);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

export async function getJson(url, opts = {}, ms = 8000) {
  const r = await fetchWithTimeout(url, opts, ms);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// Races a promise against a timer. Used for library calls (yahoo-finance2)
// that do not take an AbortSignal.
export function withTimeout(promise, ms, label = 'request') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Runs tasks with at most `limit` in flight. Each task is a function that
// returns a promise. Results keep the input order; a failed task yields null.
export async function pooled(tasks, limit = 5) {
  const out = new Array(tasks.length).fill(null);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      try { out[i] = await tasks[i](); } catch { out[i] = null; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return out;
}

// Splits one CSV line, honouring double quotes.
export function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i++; } else quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      out.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

export function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const header = splitCsvLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const row = {};
    header.forEach((h, i) => { row[h] = cells[i] != null ? cells[i].trim() : ''; });
    return row;
  });
}
