// Shared command parser + dispatcher for Quantum Terminal.
// Used by both <CommandPalette /> (global ⌘K) and <CustomSearchBar /> (/custom).

export const WIDGET_KINDS = [
  'CHART','DES','EARN','FIN','OPT_IV','OPT_GREEKS','OPT_SMILE','OPT_TERM',
  'MC','NEWS','MACRO_YIELDS','MACRO_FX','MACRO_COMM','MACRO_CAL',
  'MACRO_FG','WATCHLIST','ALERTS','SCREENER','NEWS_SENTIMENT','REGIME',
];

const MACRO_PANELS = {
  YIELDS: 'yields', COMM: 'comm', FX: 'fx', BANKS: 'banks', CAL: 'cal', FLIGHTS: 'flights',
};

export function normalizeTf(raw) {
  const t = (raw || '').toUpperCase();
  if (t === '1M' || t === '1MIN') return '1Min';
  if (t === '5M' || t === '5MIN') return '5Min';
  if (t === '15M' || t === '15MIN') return '15Min';
  if (t === '1H' || t === '1HOUR') return '1Hour';
  return '1Day';
}

// Return everything after the Nth token (preserving original casing, quoted strings).
function tail(raw, n) {
  const parts = raw.trim().split(/\s+/);
  return parts.slice(n).join(' ').trim();
}

export function parseCommand(input) {
  const raw = (input || '').trim();
  if (!raw) return null;
  const tokens = raw.toUpperCase().split(/\s+/).filter(Boolean);
  const head = tokens[0];

  // ── Custom workspace verbs ─────────────────────────────────────────────────
  if (head === 'ADD') {
    const kind = tokens[1];
    if (!kind || !WIDGET_KINDS.includes(kind)) return { kind: 'add_invalid', raw };
    const params = {};
    let i = 2;
    if (tokens[i] && /^[A-Z]{1,5}$/.test(tokens[i]) && !tokens[i].includes('=')) {
      params.symbol = tokens[i++];
    }
    if (tokens[i] && /^(1M|1MIN|5M|5MIN|15M|15MIN|1H|1HOUR|1D|1DAY|1W|1WEEK)$/.test(tokens[i])) {
      params.tf = normalizeTf(tokens[i++]);
    }
    for (; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.startsWith('D=')) params.days = parseInt(t.slice(2), 10);
      else if (t.startsWith('K=')) params.K = t.slice(2);
      else if (t.startsWith('T=')) params.T = t.slice(2);
      else if (t.startsWith('PATHS=')) params.paths = t.slice(6);
      else if (['ASIAN','BARRIER','LOOKBACK','AMERICAN','EUROPEAN'].includes(t)) params.mcType = t.toLowerCase();
    }
    return { kind: 'add', widget: kind, params };
  }
  if (head === 'RM' || head === 'REMOVE' || head === 'CLOSE') {
    const target = tokens[1];
    if (!target) return null;
    if (/^\d+$/.test(target)) return { kind: 'rm', slot: parseInt(target, 10) };
    if (WIDGET_KINDS.includes(target)) return { kind: 'rm_kind', widget: target };
    return null;
  }
  if (head === 'MOVE') {
    return { kind: 'move', slot: parseInt(tokens[1], 10), x: parseInt(tokens[2], 10), y: parseInt(tokens[3], 10) };
  }
  if (head === 'RESIZE') {
    return { kind: 'resize', slot: parseInt(tokens[1], 10), w: parseInt(tokens[2], 10), h: parseInt(tokens[3], 10) };
  }
  if (head === 'CLEAR') return { kind: 'clear' };
  if (head === 'EXPORT') return { kind: 'export' };

  // ── Watchlist verbs ────────────────────────────────────────────────────────
  if (head === 'WATCH') {
    const op = tokens[1];
    if (op === 'ADD' && tokens[2]) return { kind: 'watch_add', symbol: tokens[2] };
    if ((op === 'RM' || op === 'REMOVE') && tokens[2]) return { kind: 'watch_rm', symbol: tokens[2] };
    if (op === 'CLEAR') return { kind: 'watch_clear' };
    return null;
  }

  // ── Alert verbs ────────────────────────────────────────────────────────────
  if (head === 'ALERT') {
    const sym = tokens[1];
    const akind = tokens[2];
    if (!sym || !akind) return null;
    if (akind === 'NEWS') {
      const m = raw.match(/"([^"]+)"|'([^']+)'/);
      const term = m ? (m[1] || m[2]) : tokens.slice(3).join(' ');
      return { kind: 'alert_add', alert: { symbol: sym, kind: 'NEWS', term } };
    }
    const op = tokens[3];
    const value = parseFloat(tokens[4]);
    if (!['>','<','>=','<='].includes(op) || isNaN(value)) return null;
    if (akind === 'PRICE') return { kind: 'alert_add', alert: { symbol: sym, kind: 'PRICE', op, value } };
    if (akind === 'IV') return { kind: 'alert_add', alert: { symbol: sym, kind: 'IV', op, value } };
    if (akind === 'MCPROB') return { kind: 'alert_add', alert: { symbol: sym, kind: 'MCPROB', op, value } };
    return null;
  }

  // ── Screener verbs ─────────────────────────────────────────────────────────
  if (head === 'SCREEN') {
    if (tokens[1] === 'UNIVERSE') {
      const u = tokens[2];
      if (u === 'SP500' || u === 'CUSTOM') return { kind: 'screen_universe', universe: u };
      return null;
    }
    const predicate = tail(raw, 1);
    if (!predicate) return null;
    return { kind: 'screen', predicate };
  }

  // ── Macro ──────────────────────────────────────────────────────────────────
  if (head === 'MACRO') {
    return { kind: 'macro', panel: tokens[1] || null };
  }

  // ── Ticker-headed verbs ────────────────────────────────────────────────────
  if (/^[A-Z]{1,5}$/.test(head)) {
    const verb = tokens[1];
    if (!verb) return { kind: 'ticker', symbol: head };
    if (verb === 'GP') {
      const tf = tokens[2] || '1D';
      let days = null;
      for (let i = 3; i < tokens.length; i++) {
        if (tokens[i].startsWith('D=')) days = parseInt(tokens[i].slice(2), 10);
      }
      return { kind: 'chart', symbol: head, tf, days };
    }
    if (verb === 'DES') return { kind: 'focus', symbol: head, panel: 'overview' };
    if (verb === 'EARN') return { kind: 'focus', symbol: head, panel: 'earn' };
    if (verb === 'FIN') return { kind: 'focus', symbol: head, panel: 'fin' };
    if (verb === 'OPT') return { kind: 'focus', symbol: head, panel: 'opt' };
    if (verb === 'MC') {
      const args = { type: 'asian' };
      for (let i = 2; i < tokens.length; i++) {
        const t = tokens[i];
        if (['ASIAN','BARRIER','LOOKBACK','AMERICAN','EUROPEAN'].includes(t)) args.type = t.toLowerCase();
        else if (t.startsWith('K=')) args.K = t.slice(2);
        else if (t.startsWith('T=')) args.T = t.slice(2);
        else if (t.startsWith('PATHS=')) args.paths = t.slice(6);
      }
      return { kind: 'mc', symbol: head, ...args };
    }
  }

  return null;
}

// Dispatch a parsed command. Workspace-mutating commands (add/rm/move/clear/watch/alert)
// are emitted as a window event so that the /custom page picks them up regardless
// of where they were issued from. Navigational commands use router.push.
export function dispatch(cmd, router) {
  if (!cmd) return;
  switch (cmd.kind) {
    case 'ticker':
      router.push(`/?sym=${cmd.symbol}`);
      return;
    case 'chart': {
      const params = new URLSearchParams({ sym: cmd.symbol, tf: normalizeTf(cmd.tf), focus: 'chart' });
      if (cmd.days) params.set('days', String(cmd.days));
      router.push(`/?${params.toString()}`);
      return;
    }
    case 'focus':
      router.push(`/?sym=${cmd.symbol}&focus=${cmd.panel}`);
      return;
    case 'mc': {
      const params = new URLSearchParams({ sym: cmd.symbol, type: cmd.type });
      if (cmd.K) params.set('K', cmd.K);
      if (cmd.T) params.set('T', cmd.T);
      if (cmd.paths) params.set('paths', cmd.paths);
      router.push(`/mc?${params.toString()}`);
      return;
    }
    case 'macro': {
      const slug = cmd.panel ? MACRO_PANELS[cmd.panel] : null;
      router.push(slug ? `/macro?focus=${slug}` : '/macro');
      return;
    }
    case 'add':
    case 'rm':
    case 'rm_kind':
    case 'move':
    case 'resize':
    case 'clear':
    case 'export':
    case 'watch_add':
    case 'watch_rm':
    case 'watch_clear':
    case 'alert_add':
    case 'screen':
    case 'screen_universe':
      // Workspace-bound. Route to /custom and emit an event for the page to handle.
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('qt:custom:apply', { detail: cmd }));
      }
      if (router && typeof window !== 'undefined' && !window.location.pathname.startsWith('/custom')) {
        router.push('/custom');
      }
      return;
    default:
  }
}

export function previewLabel(cmd) {
  if (!cmd) return '';
  switch (cmd.kind) {
    case 'ticker': return `Switch to ${cmd.symbol}`;
    case 'chart': return `${cmd.symbol} chart · ${normalizeTf(cmd.tf)}${cmd.days ? ` · ${cmd.days}d` : ''}`;
    case 'focus': return `${cmd.symbol} · ${cmd.panel}`;
    case 'mc': return `MC ${cmd.type} · ${cmd.symbol}${cmd.K?` K=${cmd.K}`:''}${cmd.T?` T=${cmd.T}`:''}${cmd.paths?` paths=${cmd.paths}`:''}`;
    case 'macro': return cmd.panel ? `Macro · ${cmd.panel}` : 'Macro dashboard';
    case 'add': return `Add ${cmd.widget}${cmd.params?.symbol ? ` · ${cmd.params.symbol}` : ''}`;
    case 'add_invalid': return `Unknown widget: ${cmd.raw}`;
    case 'rm': return `Remove slot ${cmd.slot}`;
    case 'rm_kind': return `Remove ${cmd.widget}`;
    case 'move': return `Move slot ${cmd.slot} → (${cmd.x}, ${cmd.y})`;
    case 'resize': return `Resize slot ${cmd.slot} → ${cmd.w}×${cmd.h}`;
    case 'clear': return 'Clear workspace';
    case 'export': return 'Export layout JSON';
    case 'watch_add': return `Watchlist + ${cmd.symbol}`;
    case 'watch_rm': return `Watchlist − ${cmd.symbol}`;
    case 'watch_clear': return 'Watchlist clear';
    case 'alert_add': return `Alert ${cmd.alert.symbol} ${cmd.alert.kind} ${cmd.alert.op || ''} ${cmd.alert.value ?? cmd.alert.term ?? ''}`.trim();
    case 'screen': return `Screen: ${cmd.predicate.length > 60 ? cmd.predicate.slice(0,60)+'…' : cmd.predicate}`;
    case 'screen_universe': return `Universe → ${cmd.universe}`;
    default: return 'Run';
  }
}

export const SUGGESTIONS = [
  {
    title: 'Tickers',
    items: [
      { id: 'nvda', label: 'NVDA', hint: 'switch ticker', cmd: { kind: 'ticker', symbol: 'NVDA' } },
      { id: 'aapl', label: 'AAPL', hint: 'switch ticker', cmd: { kind: 'ticker', symbol: 'AAPL' } },
      { id: 'tsla', label: 'TSLA', hint: 'switch ticker', cmd: { kind: 'ticker', symbol: 'TSLA' } },
      { id: 'amd', label: 'AMD', hint: 'switch ticker', cmd: { kind: 'ticker', symbol: 'AMD' } },
    ],
  },
  {
    title: 'Chart',
    items: [
      { id: 'nvda-1d', label: 'NVDA GP 1D D=180', hint: 'NVDA · 6mo daily', cmd: { kind: 'chart', symbol: 'NVDA', tf: '1D', days: 180 } },
      { id: 'nvda-1h', label: 'NVDA GP 1H D=10', hint: 'NVDA · 10d hourly', cmd: { kind: 'chart', symbol: 'NVDA', tf: '1H', days: 10 } },
      { id: 'nvda-5m', label: 'NVDA GP 5M', hint: 'NVDA · 5-minute', cmd: { kind: 'chart', symbol: 'NVDA', tf: '5M' } },
    ],
  },
  {
    title: 'Equity panels',
    items: [
      { id: 'nvda-earn', label: 'NVDA EARN', hint: 'jump to earnings card', cmd: { kind: 'focus', symbol: 'NVDA', panel: 'earn' } },
      { id: 'nvda-fin', label: 'NVDA FIN', hint: 'jump to financials', cmd: { kind: 'focus', symbol: 'NVDA', panel: 'fin' } },
      { id: 'nvda-opt', label: 'NVDA OPT', hint: 'IV surface', cmd: { kind: 'focus', symbol: 'NVDA', panel: 'opt' } },
      { id: 'nvda-des', label: 'NVDA DES', hint: 'overview header', cmd: { kind: 'focus', symbol: 'NVDA', panel: 'overview' } },
    ],
  },
  {
    title: 'Custom workspace',
    items: [
      { id: 'add-chart', label: 'ADD CHART NVDA 1D D=180', hint: 'chart widget · 180d', cmd: { kind: 'add', widget: 'CHART', params: { symbol: 'NVDA', tf: '1Day', days: 180 } } },
      { id: 'add-iv', label: 'ADD OPT_IV NVDA', hint: 'IV surface widget', cmd: { kind: 'add', widget: 'OPT_IV', params: { symbol: 'NVDA' } } },
      { id: 'add-watch', label: 'ADD WATCHLIST', hint: 'watchlist widget', cmd: { kind: 'add', widget: 'WATCHLIST', params: {} } },
      { id: 'add-alerts', label: 'ADD ALERTS', hint: 'alerts widget', cmd: { kind: 'add', widget: 'ALERTS', params: {} } },
      { id: 'add-screen', label: 'ADD SCREENER', hint: 'screener widget', cmd: { kind: 'add', widget: 'SCREENER', params: {} } },
      { id: 'add-news', label: 'ADD NEWS NVDA', hint: 'news widget', cmd: { kind: 'add', widget: 'NEWS', params: { symbol: 'NVDA' } } },
      { id: 'clear', label: 'CLEAR', hint: 'remove all widgets', cmd: { kind: 'clear' } },
    ],
  },
  {
    title: 'Watchlist',
    items: [
      { id: 'w-nvda', label: 'WATCH ADD NVDA', hint: 'add ticker', cmd: { kind: 'watch_add', symbol: 'NVDA' } },
      { id: 'w-rm', label: 'WATCH RM AAPL', hint: 'remove ticker', cmd: { kind: 'watch_rm', symbol: 'AAPL' } },
      { id: 'w-clear', label: 'WATCH CLEAR', hint: 'clear watchlist', cmd: { kind: 'watch_clear' } },
    ],
  },
  {
    title: 'Alerts',
    items: [
      { id: 'a-price', label: 'ALERT NVDA PRICE > 500', hint: 'price trigger', cmd: { kind: 'alert_add', alert: { symbol: 'NVDA', kind: 'PRICE', op: '>', value: 500 } } },
      { id: 'a-iv', label: 'ALERT NVDA IV > 0.5', hint: 'IV trigger', cmd: { kind: 'alert_add', alert: { symbol: 'NVDA', kind: 'IV', op: '>', value: 0.5 } } },
      { id: 'a-news', label: 'ALERT NVDA NEWS "earnings"', hint: 'keyword trigger', cmd: { kind: 'alert_add', alert: { symbol: 'NVDA', kind: 'NEWS', term: 'earnings' } } },
    ],
  },
  {
    title: 'Screener',
    items: [
      { id: 's-pe', label: 'SCREEN P/E < 20 AND ROE > 0.15', hint: 'value + quality', cmd: { kind: 'screen', predicate: 'P/E < 20 AND ROE > 0.15' } },
      { id: 's-tech', label: 'SCREEN SECTOR = "Technology" AND DEBT/EQUITY < 0.5', hint: 'low-leverage tech', cmd: { kind: 'screen', predicate: 'SECTOR = "Technology" AND DEBT/EQUITY < 0.5' } },
      { id: 's-uni', label: 'SCREEN UNIVERSE SP500', hint: 'switch universe', cmd: { kind: 'screen_universe', universe: 'SP500' } },
    ],
  },
  {
    title: 'Monte Carlo',
    items: [
      { id: 'mc-asian', label: 'NVDA MC ASIAN K=490 PATHS=10000000', hint: 'pricer · 10M paths', cmd: { kind: 'mc', symbol: 'NVDA', type: 'asian', K: '490', paths: '10000000' } },
      { id: 'mc-barrier', label: 'NVDA MC BARRIER K=490 T=30D', hint: 'knock-out call', cmd: { kind: 'mc', symbol: 'NVDA', type: 'barrier', K: '490', T: '30D' } },
      { id: 'mc-american', label: 'NVDA MC AMERICAN K=490', hint: 'Longstaff–Schwartz', cmd: { kind: 'mc', symbol: 'NVDA', type: 'american', K: '490' } },
    ],
  },
  {
    title: 'Macro',
    items: [
      { id: 'm-yields', label: 'MACRO YIELDS', hint: 'yield curve', cmd: { kind: 'macro', panel: 'YIELDS' } },
      { id: 'm-comm', label: 'MACRO COMM', hint: 'commodities', cmd: { kind: 'macro', panel: 'COMM' } },
      { id: 'm-fx', label: 'MACRO FX', hint: 'FX strength matrix', cmd: { kind: 'macro', panel: 'FX' } },
      { id: 'm-flights', label: 'MACRO FLIGHTS', hint: 'live flight tracker', cmd: { kind: 'macro', panel: 'FLIGHTS' } },
      { id: 'm-cal', label: 'MACRO CAL', hint: 'economic calendar', cmd: { kind: 'macro', panel: 'CAL' } },
      { id: 'm-banks', label: 'MACRO BANKS', hint: 'central banks', cmd: { kind: 'macro', panel: 'BANKS' } },
    ],
  },
];