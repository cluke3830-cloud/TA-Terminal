# Quantum Terminal — Command Reference

This file is the canonical reference for every command, keyboard shortcut, and
verb the terminal recognises. Open the **Custom** tab and start typing in the
top search bar, or press <kbd>⌘K</kbd> from anywhere to open the global palette.

> **Tip:** Press <kbd>?</kbd> in any page to open the in-app cheat sheet.

---

## Top-bar tabs

| Tab | Route | Shortcut |
|-----|-------|----------|
| Terminal | `/` | <kbd>1</kbd> |
| Macro | `/macro` | <kbd>2</kbd> |
| Options | `/options` | <kbd>3</kbd> |
| Portfolio | `/portfolio` | <kbd>4</kbd> |
| Custom (workspace) | `/custom` | <kbd>5</kbd> |

Digit shortcuts are global. They are ignored while you are typing in any input,
textarea, or content-editable region.

---

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| <kbd>⌘K</kbd> / <kbd>Ctrl+K</kbd> | Open / close the global command palette |
| <kbd>?</kbd> | Open / close the keyboard-shortcut help overlay |
| <kbd>Esc</kbd> | Close the palette / help overlay / nav search |
| <kbd>↵</kbd> | Run the currently-typed command |
| <kbd>↑</kbd> / <kbd>↓</kbd> | Navigate suggestion list |
| <kbd>1</kbd>–<kbd>5</kbd> | Jump to top-nav tab |

---

## Custom workspace verbs

The **Custom** tab is a Bloomberg-style empty workspace. You compose your own
dashboard by issuing `ADD` commands; each command spawns a self-contained
widget. Layout is persisted to `localStorage` (`qt.custom.layout`), so widgets
survive page refresh.

### Composing the workspace

| Command | What it does |
|---------|--------------|
| `ADD <KIND> [SYM] [TF] [args]` | Add a widget. Symbol-bound widgets accept a ticker; chart widgets accept a timeframe and `D=<n>` for days of history. |
| `RM <slot>` | Remove the widget at slot number `<slot>` (the `#N` shown in the widget title). |
| `RM <KIND>` | Remove the first widget of that kind. |
| `RESIZE <slot> <w> <h>` | Resize widget. `w` and `h` are grid units (12-wide grid). |
| `CLEAR` | Remove every widget. |
| `EXPORT` | Print the current layout JSON to the browser console (and toast). |

### Widget catalog (kinds)

| `KIND` | Description |
|--------|-------------|
| `CHART` | Heikin Ashi chart with timeframe + days-of-history input + live polling |
| `DES` | Ticker overview header (name, sector, price, %Δ) |
| `EARN` | Earnings calendar + history table |
| `FIN` | Financial ratios + income / balance / cash-flow tabs |
| `NEWS` | News headlines with sentiment scores |
| `OPT_IV` | IV surface compact table (strike × DTE) |
| `OPT_GREEKS` | Greeks table (Δ, Γ, ν, Θ) for a chain |
| `OPT_SMILE` | Volatility smile bar chart at a chosen DTE |
| `OPT_TERM` | Term structure of ATM IV |
| `MC` | Monte Carlo pricer (Asian / Barrier / Lookback / American / European) |
| `MACRO_YIELDS` | US Treasury yield curve |
| `MACRO_FX` | FX strength matrix |
| `MACRO_COMM` | Commodities table |
| `MACRO_FLIGHTS` | Live flight tracker |
| `MACRO_CAL` | Economic calendar |
| `MACRO_FG` | CNN fear / greed score |
| `WATCHLIST` | Mini-quote rows with 5 s polling, click to focus main panel |
| `ALERTS` | Price / IV / MC / news triggers with toast notifications |
| `SCREENER` | Predicate filter over the S&P 500 (or a user-defined list) |

### Examples

```
ADD CHART NVDA 1D D=180        # NVDA daily candles, 180 days of history
ADD CHART NVDA 5M              # NVDA 5-minute, default lookback (~3 trading days)
ADD CHART AAPL 1D D=1825       # AAPL daily, 5 years
ADD WATCHLIST                  # add the watchlist widget
ADD SCREENER                   # add the screener widget
ADD OPT_IV NVDA                # NVDA IV surface
ADD MC TSLA ASIAN K=240 PATHS=10000000   # Monte Carlo Asian call
RM 3                           # remove widget at slot #3
RESIZE 1 12 2                  # make slot #1 12 cols wide × 2 rows
CLEAR                          # clear the workspace
```

---

## Watchlist

The watchlist is shared across the workspace (whether the widget is mounted or
not). Quotes refresh every 5 s while the tab is visible.

| Command | What it does |
|---------|--------------|
| `WATCH ADD <SYM>` | Add a ticker to the watchlist. |
| `WATCH RM <SYM>` | Remove a ticker. |
| `WATCH CLEAR` | Empty the watchlist. |

Click any row in the widget to navigate to `/?sym=<SYM>` and load the ticker
on the Terminal page.

---

## Alerts

Alerts are evaluated every **15 s while the tab is open** (no background
worker — close the tab and evaluation pauses). Each alert fires a toast on
each `inactive → active` transition.

| Form | Meaning |
|------|---------|
| `ALERT <SYM> PRICE <op> <value>` | Fires when last price satisfies the predicate. `<op>` ∈ `>`, `<`, `>=`, `<=`. |
| `ALERT <SYM> IV <op> <value>` | Fires when 30-day IV (from the options endpoint) satisfies the predicate. |
| `ALERT <SYM> MCPROB <op> <value>` | Fires when probability of the price reaching `<value>` within 30 trading days (GBM proxy) satisfies the predicate. |
| `ALERT <SYM> NEWS "<term>"` | Fires when a fresh news article whose title or summary contains `<term>` appears. |

### Examples

```
ALERT NVDA PRICE > 500
ALERT TSLA IV > 0.6
ALERT AAPL MCPROB > 0.3
ALERT META NEWS "earnings"
```

---

## Screener

The screener evaluates a Boolean predicate against every ticker in a universe
(default: S&P 500) and returns matches with the relevant fundamental cells.

| Command | What it does |
|---------|--------------|
| `SCREEN <predicate>` | Run a predicate. Use `AND` and `OR` to combine. |
| `SCREEN UNIVERSE SP500` | Switch to the S&P 500 universe. |
| `SCREEN UNIVERSE CUSTOM` | Switch to a user-defined universe (paste tickers in the widget input). |

### Predicate grammar

```
expr   := term (("AND" | "OR") term)*
term   := atom | "(" expr ")"
atom   := <field> <op> <value>
op     := < | <= | > | >= | = | != | <>
value  := number | quoted-string | identifier
```

### Recognised fields

| Field | Source |
|-------|--------|
| `P/E`, `PE` | TTM price/earnings |
| `P/B`, `PB` | TTM price/book |
| `P/S`, `PS` | TTM price/sales |
| `P/FCF` | TTM price/free-cash-flow |
| `DEBT/EQUITY`, `DE` | TTM debt-to-equity |
| `DEBT/ASSETS` | TTM debt-to-assets |
| `CURRENT_RATIO` | TTM current ratio |
| `GROSS_MARGIN` | TTM gross margin (decimal — e.g. `0.5`, or `50%`) |
| `NET_MARGIN` | TTM net margin |
| `ROE` | Net income (TTM, sum of last 4 quarters) ÷ latest equity |
| `ROA` | Net income (TTM) ÷ latest total assets |
| `SECTOR`, `INDUSTRY`, `NAME` | profile fields (string compare) |
| `IV30` | 30-day ATM implied volatility |

Numbers may use a `%` suffix (`50%` ⇒ `0.50`).

### Examples

```
SCREEN P/E < 20 AND ROE > 0.15
SCREEN SECTOR = "Technology" AND DEBT/EQUITY < 0.5
SCREEN P/B < 3 AND NET_MARGIN > 10%
SCREEN GROSS_MARGIN > 50% AND P/E < 30
SCREEN UNIVERSE CUSTOM
```

---

## Existing terminal verbs

The verbs below predate the Custom workspace and continue to navigate inside
the original pages. They're available from <kbd>⌘K</kbd> as well.

### Ticker / chart / panels

| Command | What it does |
|---------|--------------|
| `<TICKER>` | Switch the active ticker on the Terminal page. |
| `<TICKER> GP <TF> [D=<n>]` | Load chart with timeframe `<TF>` (`1M`, `5M`, `15M`, `1H`, `1D`) and optionally `<n>` days of history. |
| `<TICKER> EARN` | Jump to the Earnings card. |
| `<TICKER> FIN` | Jump to the Financials card. |
| `<TICKER> OPT` | Open the Options page. |
| `<TICKER> DES` | Jump to the overview header. |
| `<TICKER> MC <TYPE> [K=<strike>] [T=<n>D] [PATHS=<n>]` | Open the Monte Carlo pricer pre-filled. `<TYPE>` ∈ `ASIAN`, `BARRIER`, `LOOKBACK`, `AMERICAN`, `EUROPEAN`. |

### Macro

| Command | What it does |
|---------|--------------|
| `MACRO YIELDS` | Yield curve. |
| `MACRO COMM` | Commodities. |
| `MACRO FX` | FX strength matrix. |
| `MACRO BANKS` | Central banks. |
| `MACRO CAL` | Economic calendar. |
| `MACRO FLIGHTS` | Live flight tracker. |

---

## Heikin Ashi chart — days of history + live data

The Terminal page chart toolbar now includes:

- A **days input** (numeric, with preset chips `1D · 5D · 1M · 3M · 6M · 1Y`).
- **Live polling** that pauses when the browser tab is hidden:
  - intraday timeframes (`1Min` / `5Min` / `15Min` / `1Hour`) refresh every 15 s
  - daily timeframe refreshes every 5 min
- The same controls (and a wider 5-year cap) are available on the workspace
  `CHART` widget.

Backend caps:
- `tradingDays` (Alpaca-aligned) — capped at **252** trading days (~1 year intraday).
- `days` (calendar days) — capped at **1825** (~5 years daily).

Days passed via the URL (`?days=180`) or the command palette (`NVDA GP 1D D=180`)
are honoured by both the Terminal page and the Custom workspace.

---

## AI syntax summarisation

While you type in the command palette or the Custom search bar, a single-line
plain-English explanation streams in beneath the input — generated by Claude
(Haiku 4.5) with the parser grammar embedded in the system prompt.

- Requires `ANTHROPIC_API_KEY` in your environment.
- Falls back silently to no-op if the key is unset.
- Debounced 300 ms; aborts on each new keystroke.

---

## Persistence

Every workspace-bound piece of state lives in `localStorage` and is
per-browser:

| Key | Contents |
|-----|----------|
| `qt.custom.layout` | Widgets, slots, params, sizes |
| `qt.watchlist` | `string[]` of tickers |
| `qt.alerts` | Alert objects (id, symbol, kind, op, value, term, active, lastValue) |

To reset, run `CLEAR` (workspace), `WATCH CLEAR` (watchlist), or remove the
keys via DevTools.

---

## Caveats

- Free-tier upstream feeds may delay quotes by ~15 minutes.
- Alert evaluation runs only while the tab is open. There is no server-side
  worker.
- The Monte Carlo widget posts to the `MC_GPU_URL` service. Without that
  service running, the widget shows the upstream's "GPU offline" payload.
- Not financial advice.
