export const dynamic = 'force-dynamic';

import { loadFin } from '../financials/route';
import { parsePredicate, evalPredicate, fieldsUsed, FIELD_MAP } from '../../lib/screen';
import { SP500 } from '../../lib/sp500';

async function runBatch(symbols, predicateAst, usedFields) {
  const matches = [];
  const errors = [];
  const BATCH = 16;
  for (let i = 0; i < symbols.length; i += BATCH) {
    const slice = symbols.slice(i, i + BATCH);
    const settled = await Promise.allSettled(slice.map(s => loadFin(s)));
    settled.forEach((r, j) => {
      const sym = slice[j];
      if (r.status !== 'fulfilled' || !r.value) { errors.push(sym); return; }
      const fin = r.value;
      let ok = false;
      try { ok = evalPredicate(predicateAst, fin); } catch { ok = false; }
      if (!ok) return;
      const cells = {};
      for (const f of usedFields) {
        const getter = FIELD_MAP[f];
        cells[f] = getter ? getter(fin) : null;
      }
      cells.NAME = fin?.profile?.companyName || fin?.profile?.name || sym;
      matches.push({ symbol: sym, cells });
    });
  }
  return { matches, errors };
}

export async function POST(req) {
  const t0 = Date.now();
  let body = {};
  try { body = await req.json(); } catch {}
  const predicate = (body?.predicate || '').toString();
  const universeArg = body?.universe;
  const customList = Array.isArray(body?.tickers) ? body.tickers.map(s => String(s).toUpperCase()) : null;

  const ast = parsePredicate(predicate);
  if (!ast) return Response.json({ matches: [], stats: { error: 'Invalid predicate' } }, { status: 400 });

  let universe;
  if (universeArg === 'CUSTOM' && customList && customList.length) universe = customList;
  else universe = SP500;

  const used = fieldsUsed(ast);
  const { matches, errors } = await runBatch(universe, ast, used);

  return Response.json({
    matches,
    stats: {
      scanned: universe.length,
      matched: matches.length,
      errored: errors.length,
      ms: Date.now() - t0,
      fields: used,
    },
  });
}