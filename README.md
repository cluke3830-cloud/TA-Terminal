# TA Terminal

A market terminal for individual investors: charts, fundamentals, options analytics, a macro dashboard, portfolio
tools and an AI analyst, in one Next.js app.

**Live:** https://ta-terminal-orcin.vercel.app

Every figure on the site is read from its source when the page loads, and is shown with that source and its as-of
date. No rate, yield or reference table is typed into the code. When a source does not answer, the card says so; it
is not filled in with an estimate.

## Pages

| Page | What it shows |
|---|---|
| `/` Terminal | Price chart with indicators, fundamentals, earnings, insider filings, institutional holders, short interest, news |
| `/macro` Macro | Fear and greed gauge, world map, central bank rates, economic calendar, yield curve, currencies, commodities, reserve holdings, sector news sentiment |
| `/options` Options | Implied volatility surface, smile, term structure, Greeks, implied against realized volatility, VIX term structure |
| `/portfolio` Portfolio | Efficient frontier, walk-forward backtest, value-at-risk breakdown |
| `/mc` Monte Carlo | Pricer for Asian, barrier, lookback and American options, run in the browser |
| `/regime` Regime | Six-state market regime classifier (needs the separate regime service, see below) |
| `/custom` Custom | Build your own dashboard from the widgets above |
| `/ai` AI Analyst | Chat grounded in Google Search (Gemini) |

## Where the numbers come from

| Data | Source | Key needed |
|---|---|---|
| Treasury yield curve, and the risk-free rate used by every pricer | US Treasury daily par yield curve | no |
| Fed funds rate and FOMC target range | Federal Reserve Bank of New York | no |
| Central bank policy rates (8 banks) | Bank for International Settlements, daily series | no |
| Consumer price index | Bureau of Labor Statistics | no |
| Reserve currency shares | IMF COFER, latest quarter | no |
| Reserve holders | World Bank | no |
| Political stability map | World Bank Worldwide Governance Indicators (yearly) | no |
| Oil reserves map (shown only when the EIA answers) | US Energy Information Administration | `EIA_API_KEY` |
| Currencies | European Central Bank fixings, through Frankfurter | no |
| Commodities, VIX, quotes, price history | Yahoo Finance | no |
| Stock bars and option quotes | Alpaca | `ALPACA_API_KEY`, `ALPACA_SECRET_KEY` |
| Fundamentals, analyst targets, calendar | Financial Modeling Prep | `FMP_API_KEY` |
| Insider filings | SEC EDGAR | no |
| Aircraft positions | OpenSky Network, adsb.fi | optional |

Three things are worth knowing before you read the screens:

- **The risk-free rate is live and matched to maturity.** Implied volatility and Greeks discount each contract at
  today's Treasury yield for its own time to expiry. The Monte Carlo and portfolio pages start from today's 3-month
  yield, and you can type over it. If the Treasury site is down the rate falls back to FRED, then to the 13-week
  bill index; if all three fail the page says the rate is unavailable.
- **The fear and greed gauge is this terminal's own.** It averages five market gauges (S&P 500 against its 125-day
  average and its 52-week high, VIX against its 50-day average, stocks against Treasuries, high yield against
  investment grade), each ranked against its own past year. It is not CNN's index.
- **The stability map is a yearly score, not a conflict tracker.** It is the World Bank's political stability
  estimate, rescaled to 0 to 10. It moves slowly and does not react to this week's news.

## It keeps itself current

Nothing in this repository needs a person to update it.

| Workflow | When | What it does |
|---|---|---|
| `data-health.yml` | Twice each weekday | Calls every live route on the production site. If a source is broken or stale it opens an issue with the report, and closes it when the check passes again |
| `refresh-universe.yml` | Weekly | Rebuilds the S&P 500 list in `app/lib/sp500.js` from the current constituents and commits it when it changed |
| `ci.yml` | Every push and pull request | Builds the app and fails if a fixed interest rate is written back into the code |
| Dependabot | Weekly | Opens pull requests for dependency updates |

Run the health check yourself with `node scripts/check-live-data.mjs` (set `BASE_URL` to check another deployment).

## Run it locally

```bash
npm install
cp .env.example .env.local   # then fill in the keys you have
npm run dev
```

The macro page works with no keys at all. Charts and options need the Alpaca keys; fundamentals need the FMP key.

## Optional services

- **Regime service** (`regime-service/`, Python): the `/regime` page calls it through `REGIME_API_URL`. Without it
  the page shows that the service is offline.
- **GPU service** (`gpu-service/`, Python): FinBERT news scoring and GPU Monte Carlo, through `MC_GPU_URL`. The
  public site does not run one. News is scored with the Loughran-McDonald financial word list and Monte Carlo runs
  in the browser.

## Stack

Next.js 14 (App Router), TradingView Lightweight Charts, Plotly, deployed on Vercel.

This is a research and education tool. Nothing on it is investment advice.
