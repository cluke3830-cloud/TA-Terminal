# ⚛ TA Terminal · Quantum Stock + Macro + Options + Portfolio

A four-page financial intelligence platform built for retail traders who want institutional-grade analytics without a Bloomberg terminal.

> Built for the **AMD Hackathon Championship Edition** — three real GPU workloads (Monte Carlo path simulation, FinBERT batched inference, SEC RAG retrieval) running on AMD MI300X.

## Stack
- **Frontend:** Next.js 14 + TradingView Lightweight Charts + Plotly.js (CDN)
- **Equity / Smart Money APIs:** Alpaca (bars + options/IV) · FMP (financials, earnings, forecasts, insider Form 4, 13F holdings) · yahoo-finance2 (short interest, FINRA biweekly, 90d price)
- **Macro APIs:** FRED (yields) · FMP (FX/commodities/calendar) · OpenSky (live flights) · World Bank · EIA · IMF COFER
- **History / VIX:** yahoo-finance2 (multi-year daily closes, VIX/VIX3M/VIX6M)
- **SEC fallback:** EDGAR direct (`data.sec.gov/submissions`) for insider Form 4 filings when FMP is unavailable
- **GPU service:** FastAPI + PyTorch on ROCm — Monte Carlo, FinBERT (`ProsusAI/finbert`), RAG (ChromaDB + bge-small embeddings)
- **Deploy:** Vercel (free tier, one-click)

---

## 🚀 Deploy in 2 Minutes

### Step 1: Clone & push to your GitHub

```bash
git clone https://github.com/cluke3830-cloud/Taeheon-Terminal.git
cd Taeheon-Terminal
git remote set-url origin https://github.com/YOUR_USERNAME/Taeheon-Terminal.git
git push -u origin main
```

### Step 2: Deploy on Vercel

1. Go to **[vercel.com/new](https://vercel.com/new)**
2. Click **Import** next to your repo
3. Add the **Environment Variables** below
4. Click **Deploy** ✅

| Name | Used by | Free key at |
|------|---------|-------------|
| `ALPACA_API_KEY` | `/`, `/options` | https://alpaca.markets → Paper Trading → API Keys |
| `ALPACA_SECRET_KEY` | `/`, `/options` | (same as above) |
| `FMP_API_KEY` | all pages | https://financialmodelingprep.com → Dashboard |
| `FRED_API_KEY` | `/macro` | https://fred.stlouisfed.org/docs/api/api_key.html |
| `EIA_API_KEY` | `/macro` | https://www.eia.gov/opendata/register.php |
| `MC_GPU_URL` | MC pricer · FinBERT sentiment (optional) | URL of your `gpu-service` host (e.g. `http://mi300x.example:8000`) |

OpenSky Network, World Bank, and yahoo-finance2 need no key. The GPU widgets degrade gracefully — if `MC_GPU_URL` is unset, the MC pricer falls back to browser-CPU and FinBERT widgets show a clear "offline" badge.

The Smart Money cards (Insider, 13F, Short Interest) and Portfolio Risk Decomposition work without a GPU key — they require only `FMP_API_KEY`. Short interest always works via Yahoo Finance with no key.

---

## 🖥️ Run Locally

**1. Clone and enter the folder:**
```bash
git clone https://github.com/cluke3830-cloud/Taeheon-Terminal.git
cd Taeheon-Terminal
```

**2. Install dependencies (first time only):**
```bash
npm install
```

**3. Create your `.env.local` file** at the project root:
```
ALPACA_API_KEY=your_alpaca_key
ALPACA_SECRET_KEY=your_alpaca_secret
FMP_API_KEY=your_fmp_key
FRED_API_KEY=your_fred_key
EIA_API_KEY=your_eia_key
# Optional — only needed for MI300X-accelerated MC + FinBERT
MC_GPU_URL=http://localhost:8000
```

**4. Start the dev server:**
```bash
npm run dev
```

Open **http://localhost:3000** — pages:
- `/` → Equity Terminal (price chart, financials, earnings, Smart Money — Insider / 13F / Short Interest)
- `/macro` → Macro Analysis (yields, FX, commodities, world map, sector sentiment heatmap)
- `/options` → Options Workbench (IV surface, IV-RV gap, Greeks, vol smile, term structure, VIX, sentiment, Monte Carlo)
- `/portfolio` → Portfolio Construction (Markowitz Efficient Frontier + Walk-Forward Backtest + Risk Decomposition)

If port 3000 is busy:
```bash
npm run dev -- -p 3737
```

> **⚠ macOS / zsh tip:** Do NOT copy commands with inline `#` comments — zsh treats `#` as a literal character by default. Copy one line at a time, or run `setopt interactivecomments` first.

---

## 📊 `/` — Equity Terminal

### Price & Chart
- ⚡ Heikin Ashi candlestick chart with EMA 8/21/55 + volume bars
- 🔄 Auto-refresh every 60s · Live symbol search

### Fundamentals
- 📊 Earnings history, next earnings date, quarterly revenue bars
- 📈 9 financial ratios + Income / Balance / Cash Flow statements
- 🎯 Analyst price targets and consensus ratings
- 📰 News feed with **FinBERT sentiment** — positive/neutral/negative badges + 7d/30d rolling readouts

### Smart Money Section
Three institutional-analytics cards rendered below the fundamentals for the active symbol.

#### Insider Form 4 Transactions
- Real SEC Form 4 filings via FMP `/stable/insider-trading/search` with EDGAR direct fallback
- Lookback window selector: **30 / 90 / 180 / 365 days**
- Summary tiles: Net USD, Buy count, Sell count, Unique insiders
- Buy/Sell pressure bar (proportional green/red)
- **By Insider** tab — aggregated buys, sells, net shares, net USD per officer (zero-activity rows filtered out)
- **Transactions** tab — per-trade table with date, insider name, title, type badge (BUY / SELL / OTHER), shares, price, SEC filing link

#### 13F Institutional Flow
- FMP quarterly aggregate: `stable/institutional-ownership/symbol-positions-summary`
- Tiles: Institutional Ownership % with period-point delta, Holder count with QoQ delta, Capital Invested, Flow Score
- **Flow Score** = (adds − cuts) ÷ (adds + cuts) → −100 (all cutting) to +100 (all adding), labeled BULLISH / NEUTRAL / BEARISH
- Position flow pills: ▲ New · ↑ Added · ↓ Reduced · ▼ Closed + Put/Call Ratio
- Adds/cuts ratio bar
- Quarterly history table with holder counts, **Δ Shares %** (pure position-count change — not mark-to-market), capital invested, institutional ownership %
- Incomplete-quarter detection: partial quarters dropped automatically (filing window = 45 days post-quarter-end)

#### FINRA Short Interest
- Yahoo Finance snapshot: **% of Float**, **Days to Cover**, Shares Short, Squeeze Score
- Color-coded severity: cyan (<5% float) → yellow (5–10%) → red (>10%)
- **STALE badge** (orange) when the FINRA settlement date is more than 14 days old
- MoM trend strip: share delta vs prior settlement + % change
- **90-day price overlay** — SVG line chart color-keyed to SI severity level, with min/mid/max price ticks and 4 date markers
- Biweekly history sparkline + table (when FMP data available)
- **Squeeze Score (0–100):** heuristic — 40pts %float, 40pts DTC, 20pts MoM trend. Labeled LOW / MODERATE / HIGH / EXTREME. Clearly noted as a heuristic, not a signal

---

## 🌍 `/macro` — Global Macro Intelligence
- 🎯 **Fear & Greed Composite Gauge** — 6 weighted signals (yield curve, real rate, DXY momentum, commodity momentum, yield volatility, central bank stance)
- 🗺️ **World Map** — Geopolitical Risk heatmap · Oil Reserves · live Flight Tracker (OpenSky, refresh every 60s)
- 🏦 **Central Bank Monitor** — Fed/ECB/BOJ/BOE/PBOC/RBA/SNB/BOC rates with next-meeting dates
- 📅 **Economic Calendar & Surprise Index** — beat/miss pills + Citi-style USD aggregate
- 📉 **US Treasury Yield Curve** — 1M to 30Y from FRED with 1Y/2Y/5Y historical overlays + inversion detection
- 💱 **8×8 FX Strength Matrix** — USD/EUR/JPY/GBP/CNY/AUD/CAD/CHF + ICE-formula DXY
- 🛢️ **Commodity & Energy Pulse** — WTI, Brent, Nat Gas, Copper, Gold, Silver, Uranium proxy, US electricity (with 30-day sparklines)
- 🌐 **Global Flows / Multipolar Map** — World Bank reserve holdings choropleth + IMF COFER reserve currency composition
- 🧠 **Sector Sentiment Heatmap (FinBERT)** — 11 GICS sectors color-coded by mean sentiment over recent bellwether headlines

---

## 📐 `/options` — Options Workbench

Everything options-related in one scrollable page, ticker-driven via `?sym=`:

- 🌊 **3D Implied Volatility Surface** — Black-Scholes solver over the live Alpaca chain
- ⚡ **3D IV − RV Gap Surface** — options "expensive" (teal) vs "cheap" (red) vs realized vol
- 🔢 **Greeks Table** — Δ Γ ν Θ ρ by strike × expiry, ATM row highlighted, calls/puts toggle, expiry filter
- 😊 **Vol Smile / Skew (2D slice)** — IV vs moneyness at a selected expiry, with **Risk Reversal (25Δ)** and **Butterfly (25Δ)** readouts
- 📈 **ATM IV Term Structure** — IV across maturities with **contango / backwardation** flag
- 🎢 **VIX Term Structure** — VIX / VIX3M / VIX6M with `VIX/VIX3M` ratio signal + 90-day history overlay
- 🧠 **News Sentiment (FinBERT)** — daily rolling sentiment chart for the active ticker + scored headline list
- 🎲 **Monte Carlo Option Pricer (embedded)** — BSM path simulation on AMD MI300X, browser-CPU fallback

---

## 💼 `/portfolio` — Portfolio Construction

Three stacked sections for full portfolio lifecycle: allocation → execution → risk.

### Section 1 · Efficient Frontier
- Inputs: tickers (comma-separated), start/end year, objective (max Sharpe / min vol / target return), per-asset min/max weight bounds
- Solver: hand-rolled Markowitz QP (projected gradient + simplex projection), full parabolic frontier traced by sweeping the Lagrangian dual `q`
- Plot: **Efficient Frontier** parabola · **Best CAL** (tangent from risk-free rate) · **Tangency Portfolio** (red dot) · **Individual Assets** (orange diamonds) · **risk-free rate** marker
- Live feasibility check: `Σ min ≤ 1` and `Σ max ≥ 1` — Solve auto-disables when bounds are infeasible

### Section 2 · Walk-Forward Backtest
- Inputs: tickers + weights, start/end year, transaction cost (bps), rebalance cadence (monthly/quarterly/yearly), T+1 execution toggle
- Daily NAV simulation with turnover-weighted cost drag
- Outputs: equity curve + drawdown overlay, Total Return / Max DD / Sharpe / Annual Vol / Final NAV / # rebalances

### Section 3 · Risk Decomposition
Full portfolio risk report with VaR decomposition.

**Inputs:** same tickers/weights as Backtest, plus benchmark ticker, confidence level (90/95/99%), date range, rebalance cadence, and cost bps.

**Headline metrics — 8 tiles with hover tooltips explaining each formula:**

| Metric | Formula |
|--------|---------|
| Hist VaR | −quantile(1−conf) of realized daily returns |
| Hist CVaR (ES) | Mean of the worst (1−conf)% tail days |
| Param VaR | Gaussian: −(μ − z·σ) |
| Param CVaR | Gaussian ES: −(μ − σ·φ(z)/(1−conf)) |
| Max Drawdown | Largest peak-to-trough NAV decline |
| Beta | Cov(portfolio, benchmark) / Var(benchmark) |
| Annual Vol | Daily std × √252 |
| Sharpe | Mean daily return / daily std × √252 (rf = 0) |

> **Sharpe and Max DD match the Backtest section exactly.** Both sections derive from the same realized NAV series (same rebalance schedule + cost drag). VaR/CVaR decomposition uses the theoretical constant-weight covariance matrix.

**Per-asset decomposition table:**

| Column | Explanation |
|--------|-------------|
| Ann. Return | Mean daily return × 252 |
| Ann. Vol | Daily std × √252 |
| Beta | Asset beta vs selected benchmark |
| Marginal VaR | Incremental VaR per unit of weight: `z·(Σw)ᵢ/σₚ − μᵢ` |
| Component VaR | `wᵢ × Marginal VaR` — all components sum exactly to Param VaR |
| % of VaR | Asset's fractional contribution to total portfolio risk |

**Three Plotly charts:**
1. **Return Distribution** — histogram colored by loss region, Hist VaR and Param VaR cutoff lines at separate vertical positions
2. **Drawdown Curve** — full-resolution daily series (no stride sampling), red fill under zero
3. **Risk Contribution Bar** — % of parametric VaR per asset, y-axis auto-padded so outside labels never clip

---

## 🎲 `/mc` — Monte Carlo Option Pricer

Simulate thousands of price paths to estimate a fair option price. Run in-browser (CPU) or on AMD MI300X GPU.

**Option types:** European · American · Asian (average price) · Barrier (knock-out) · Lookback

**How to use:**
1. Type a ticker — spot auto-fills, strike snaps to ATM
2. Choose option type, DTE, vol, risk-free rate, optional barrier, path count (1K → 10M)
3. Click **Run** on CPU or GPU
4. Compare engines — a `⚡ MI300X is N× faster` banner appears

Deep-link: `/mc?sym=AAPL&type=asian&K=180&T=30D&paths=1000000`  
Embed mode: `/mc?embed=1` (used by the Options Workbench)

---

## 🤖 AMD MI300X Integration · `gpu-service/`

| Endpoint | Workload | Library |
|----------|----------|---------|
| `POST /mc/run` | Monte Carlo option pricing | PyTorch on ROCm |
| `POST /finbert/score` | FinBERT batched headline sentiment | `ProsusAI/finbert` via `transformers` |
| `POST /rag/search` | Top-k cosine search over SEC EDGAR filings | ChromaDB + `bge-small-en-v1.5` |
| `GET /health` | Device + model + chunk-count snapshot | — |

```bash
cd gpu-service
pip install torch --index-url https://download.pytorch.org/whl/rocm6.0
pip install -r requirements.txt
python ingest_edgar.py   # optional: pre-load SEC filings into ChromaDB
uvicorn main:app --host 0.0.0.0 --port 8000
```

Then set `MC_GPU_URL=http://<mi300x-host>:8000` in your environment.

---

## 🏗️ Architecture

```
app/
├── page.js                         # Equity terminal — chart, fundamentals, Smart Money
├── components/
│   ├── ChartWithIndicators.js      # TradingView-style candlestick + indicator system
│   ├── InsiderCard.js              # SEC Form 4 insider transactions
│   ├── HoldingsCard.js             # 13F institutional flow
│   └── ShortInterestCard.js        # FINRA short interest + 90d price overlay
├── macro/
│   ├── page.js                     # Macro analysis (8 sections)
│   └── components/
│       └── SentimentHeatmap.js     # FinBERT sector grid
├── options/
│   ├── page.js
│   └── components/
│       ├── IVSurface.js · IVRVGap.js · Greeks.js
│       ├── VolSmile.js · TermStructure.js · VixTerm.js
│       ├── SentimentRolling.js · McEmbed.js
├── portfolio/
│   ├── page.js                     # Frontier + Backtest + Risk Decomposition
│   └── lib/
│       ├── markowitz.js            # Markowitz QP solver (no native deps)
│       ├── backtest.js             # Walk-forward NAV simulator
│       └── risk.js                 # VaR/CVaR/MaxDD/Beta/Marginal+Component VaR
├── mc/
│   ├── page.js                     # Standalone MC pricer
│   └── lib/cpu.js                  # JS reference engine
└── data_pages/                     # Next.js server-side route handlers
    ├── stock/                      # Alpaca bars
    ├── options/ · greeks/          # IV surface, Black-Scholes Greeks
    ├── earnings/ · financials/ · forecast/ · search/
    ├── history/                    # yahoo-finance2 aligned daily closes
    ├── news/                       # Yahoo + FMP merged + FinBERT-scored
    ├── insider/route.js            # Form 4 via FMP stable + EDGAR fallback
    ├── holdings/route.js           # 13F quarterly aggregate via FMP stable
    ├── short-interest/route.js     # FINRA SI via Yahoo + FMP biweekly + 90d price
    ├── sentiment/ · mc/gpu/        # MI300X proxies
    ├── portfolio/
    │   ├── frontier/route.js       # Markowitz solve
    │   ├── backtest/route.js       # Walk-forward simulation
    │   └── risk/route.js           # VaR decomp (reuses backtest NAV for headline stats)
    └── macro/
        ├── yields/ · centralbanks/ · calendar/
        ├── commodities/ · fx/ · flows/ · flights/
        ├── geopolitical/ · feargreed/
        └── vix/route.js

gpu-service/
├── main.py · mc.py · finbert.py · rag.py
├── ingest_edgar.py
└── requirements.txt
```

---

## ⚠️ Important Notes

- **Rotate API keys** if you ever pushed them publicly
- Alpaca free tier: ~15 min delayed data (IEX feed)
- FMP free tier: 250 calls/day · server-side cache (5–60 min TTL) reduces daily usage significantly
- FRED: 120 req/min · cold yield fetch makes ~44 calls
- OpenSky: ~10 req/min unauthenticated (cache TTL 60s)
- FINRA short interest: biweekly settlements — data can lag up to 30 days; STALE badge appears after 14 days
- 13F filings: 45-day filing window post-quarter-end — most recent quarter may be under-reported and is auto-dropped if holder count < 60% of prior quarter
- FinBERT first-call cold start: ~30s (HuggingFace download); subsequent calls batch on GPU
- Backtest: T+1 close fills + turnover-weighted cost drag; survivorship bias unhandled (delisted tickers error)
- Risk Decomposition: constant-weight covariance for marginal/component VaR; Sharpe + Max DD derive from the same realistic NAV series as the Backtest section
- **Research tool — not investment advice**
