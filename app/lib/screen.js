// Predicate parser + evaluator for the Screener widget.
//
// Grammar:
//   expr   := term (("AND" | "OR") term)*
//   term   := atom | "(" expr ")"
//   atom   := field op value
//   field  := identifier | identifier "/" identifier   (e.g. P/E, DEBT/EQUITY)
//   op     := "<" | "<=" | ">" | ">=" | "=" | "!=" | "==" | "<>"
//   value  := number | string | identifier
//
// Field map below translates user-friendly field names into paths on the
// financials JSON shape returned by /data_pages/financials.

export const FIELD_MAP = {
  'P/E':           (f) => f?.ratios?.priceToEarningsRatioTTM,
  'PE':            (f) => f?.ratios?.priceToEarningsRatioTTM,
  'P/B':           (f) => f?.ratios?.priceToBookRatioTTM,
  'PB':            (f) => f?.ratios?.priceToBookRatioTTM,
  'P/S':           (f) => f?.ratios?.priceToSalesRatioTTM,
  'PS':            (f) => f?.ratios?.priceToSalesRatioTTM,
  'P/FCF':         (f) => f?.ratios?.priceToFreeCashFlowRatioTTM,
  'DEBT/EQUITY':   (f) => f?.ratios?.debtToEquityRatioTTM,
  'DE':            (f) => f?.ratios?.debtToEquityRatioTTM,
  'DEBT/ASSETS':   (f) => f?.ratios?.debtToAssetsRatioTTM,
  'CURRENT_RATIO': (f) => f?.ratios?.currentRatioTTM,
  'GROSS_MARGIN':  (f) => f?.ratios?.grossProfitMarginTTM,
  'NET_MARGIN':    (f) => f?.ratios?.netProfitMarginTTM,
  'ROE':           (f) => roeFrom(f),
  'ROA':           (f) => roaFrom(f),
  'SECTOR':        (f) => f?.profile?.sector,
  'INDUSTRY':      (f) => f?.profile?.industry,
  'NAME':          (f) => f?.profile?.companyName || f?.profile?.name,
  'IV30':          (f) => f?.iv30 ?? null,
};

function roeFrom(f) {
  // ROE = netIncome (TTM, sum of last 4 quarters) / equity (latest quarter)
  const inc = f?.income || [];
  const bal = f?.balance || [];
  if (inc.length < 1 || bal.length < 1) return null;
  const ni = inc.slice(0, 4).reduce((s, x) => s + (x.netIncome ?? 0), 0);
  const eq = bal[0]?.totalStockholdersEquity ?? bal[0]?.equity ?? null;
  if (!ni || !eq) return null;
  return ni / eq;
}

function roaFrom(f) {
  const inc = f?.income || [];
  const bal = f?.balance || [];
  if (inc.length < 1 || bal.length < 1) return null;
  const ni = inc.slice(0, 4).reduce((s, x) => s + (x.netIncome ?? 0), 0);
  const ta = bal[0]?.totalAssets ?? null;
  if (!ni || !ta) return null;
  return ni / ta;
}

// ── Tokenizer ────────────────────────────────────────────────────────────────
function tokenize(input) {
  const tokens = [];
  let i = 0;
  const s = input;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '(' || c === ')') { tokens.push({ t: c, v: c }); i++; continue; }
    if (c === '"' || c === "'") {
      const q = c;
      let j = i + 1;
      let str = '';
      while (j < s.length && s[j] !== q) { str += s[j]; j++; }
      tokens.push({ t: 'str', v: str });
      i = j + 1;
      continue;
    }
    // Two-char ops
    const two = s.slice(i, i + 2);
    if (['<=','>=','==','!=','<>'].includes(two)) {
      tokens.push({ t: 'op', v: two === '==' ? '=' : two });
      i += 2;
      continue;
    }
    if (c === '<' || c === '>' || c === '=') {
      tokens.push({ t: 'op', v: c });
      i++;
      continue;
    }
    // Number
    if (/[0-9.]/.test(c) || (c === '-' && /[0-9.]/.test(s[i+1] || ''))) {
      let j = i;
      if (c === '-') j++;
      while (j < s.length && /[0-9.eE+\-%]/.test(s[j])) j++;
      let raw = s.slice(i, j);
      let mul = 1;
      if (raw.endsWith('%')) { mul = 0.01; raw = raw.slice(0, -1); }
      const n = parseFloat(raw);
      if (!isNaN(n)) {
        tokens.push({ t: 'num', v: n * mul });
        i = j;
        continue;
      }
    }
    // Identifier (allow / for fields like P/E, DEBT/EQUITY)
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < s.length && /[A-Za-z0-9_/.]/.test(s[j])) j++;
      const word = s.slice(i, j).toUpperCase();
      if (word === 'AND' || word === 'OR') tokens.push({ t: 'logic', v: word });
      else tokens.push({ t: 'ident', v: word });
      i = j;
      continue;
    }
    // Unknown char — skip
    i++;
  }
  return tokens;
}

// ── Parser ───────────────────────────────────────────────────────────────────
export function parsePredicate(input) {
  if (!input || !input.trim()) return null;
  const tokens = tokenize(input);
  let pos = 0;
  const peek = () => tokens[pos];
  const eat = (t, v) => {
    const tk = tokens[pos];
    if (!tk || tk.t !== t || (v != null && tk.v !== v)) return null;
    pos++;
    return tk;
  };

  function parseExpr() {
    let left = parseTerm();
    if (!left) return null;
    while (true) {
      const op = peek();
      if (!op || op.t !== 'logic') break;
      pos++;
      const right = parseTerm();
      if (!right) return null;
      left = { type: 'logic', op: op.v, left, right };
    }
    return left;
  }
  function parseTerm() {
    if (eat('(')) {
      const e = parseExpr();
      eat(')');
      return e;
    }
    return parseAtom();
  }
  function parseAtom() {
    const fld = eat('ident');
    if (!fld) return null;
    const op = eat('op');
    if (!op) return null;
    const valTk = peek();
    if (!valTk) return null;
    pos++;
    let val;
    if (valTk.t === 'num') val = valTk.v;
    else if (valTk.t === 'str') val = valTk.v;
    else if (valTk.t === 'ident') val = valTk.v;
    else return null;
    return { type: 'cmp', field: fld.v, op: op.v, value: val };
  }

  const ast = parseExpr();
  if (pos < tokens.length) {
    // residual tokens — predicate not fully consumed. Still return ast (partial).
  }
  return ast;
}

// ── Evaluator ────────────────────────────────────────────────────────────────
export function evalPredicate(ast, fin) {
  if (!ast) return true;
  if (ast.type === 'logic') {
    const l = evalPredicate(ast.left, fin);
    const r = evalPredicate(ast.right, fin);
    return ast.op === 'AND' ? (l && r) : (l || r);
  }
  if (ast.type === 'cmp') {
    const getter = FIELD_MAP[ast.field];
    if (!getter) return false;
    const lhs = getter(fin);
    if (lhs == null) return false;
    const rhs = ast.value;
    if (typeof lhs === 'string' || typeof rhs === 'string') {
      const a = String(lhs).toLowerCase();
      const b = String(rhs).toLowerCase();
      if (ast.op === '=') return a === b;
      if (ast.op === '!=' || ast.op === '<>') return a !== b;
      return false;
    }
    const a = +lhs, b = +rhs;
    switch (ast.op) {
      case '<': return a < b;
      case '<=': return a <= b;
      case '>': return a > b;
      case '>=': return a >= b;
      case '=': return a === b;
      case '!=': case '<>': return a !== b;
      default: return false;
    }
  }
  return false;
}

// ── Helper: extract every field referenced in an AST (for results table cells) ──
export function fieldsUsed(ast) {
  const out = new Set();
  function walk(n) {
    if (!n) return;
    if (n.type === 'logic') { walk(n.left); walk(n.right); return; }
    if (n.type === 'cmp') { out.add(n.field); }
  }
  walk(ast);
  return [...out];
}