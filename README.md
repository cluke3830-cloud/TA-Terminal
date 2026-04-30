# ⚛ TA Terminal · Quantum Stock + Macro + Options + Portfolio

A four-page financial intelligence platform built for retail traders.
Equity analytics on `/`, global macro signals on `/macro`, options workbench on `/options`, and portfolio construction on `/portfolio`.

> Built for the **AMD Hackathon Championship Edition** — three real GPU workloads (Monte Carlo path simulation, FinBERT batched inference, SEC RAG retrieval) running on AMD MI300X.

## Stack
- **Frontend:** Next.js 14 + TradingView Lightweight Charts + Plotly.js (CDN)
- **Equity APIs:** Alpaca (bars + options/IV) · FMP (financials + earnings + forecasts)
- **Macro APIs:** FRED (yields) · FMP (FX/commodities/calendar) · OpenSky (live flights) · World Bank · EIA · IMF COFER
- **History/VIX:** yahoo-finance2 (multi-year daily closes, VIX/VIX3M/VIX6M)
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

OpenSky Network, World Bank, and yahoo-finance2 need no key. The GPU widgets (`MC_GPU_URL`) degrade gracefully — if unset, the MC pricer falls back to browser-CPU and FinBERT widgets show a clear "offline" badge.

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
- `/` → Equity Terminal (Heikin Ashi, financials, earnings, FinBERT-scored news)
- `/macro` → Macro Analysis (yields, FX, commodities, world map, sector sentiment heatmap)
- `/options` → Options Workbench (IV surface, IV-RV gap, Greeks, vol smile, term structure, VIX, sentiment, Monte Carlo)
- `/portfolio` → Portfolio Construction (Markowitz Efficient Frontier with CAL + tangency, Walk-Forward Backtest)

If port 3000 is busy, run on another port:
```bash
npm run dev -- -p 3737
```

> **⚠ macOS / zsh tip:** Do NOT copy commands with inline `#` comments — zsh treats `#` as a literal character by default and will fail with `EINVALIDTAGNAME` or `Invalid project directory`. Either copy commands one line at a time, or run `setopt interactivecomments` once in your shell to enable comment parsing.

---

## 📊 `/` — Equity Terminal
- ⚡ Heikin Ashi candlestick chart with EMA 8/21/55 + volume
- 📊 Earnings history, next earnings date, quarterly revenue bars
- 📈 9 financial ratios + Income/Balance/Cash Flow statements
- 🎯 Analyst price targets, consensus ratings
- 📰 **News feed with FinBERT sentiment column** — colored badges (positive/neutral/negative) + 7d/30d rolling sentiment readouts
- 🔍 Live symbol search · 🔄 Auto-refresh every 60s
- 📈 Quick-link card to the dedicated Options Workbench

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

## 📐 `/options` — Options Workbench

Everything options-related in one scrollable page, ticker-driven via `?sym=`:

- 🌊 **3D Implied Volatility Surface** — Black-Scholes solver over the live Alpaca chain
- ⚡ **3D IV − RV Gap Surface** — options "expensive" (teal) vs "cheap" (red) vs realized vol
- 🔢 **Greeks Table** — Δ Γ ν Θ ρ by strike × expiry, ATM row highlighted, calls/puts toggle, expiry filter
- 😊 **Vol Smile / Skew (2D slice)** — IV vs moneyness at a selected expiry, with **Risk Reversal (25Δ)** and **Butterfly (25Δ)** readouts
- 📈 **ATM IV Term Structure** — IV across maturities with **contango / backwardation** flag
- 🎢 **VIX Term Structure** — VIX / VIX3M / VIX6M with `VIX/VIX3M` ratio signal + 90-day history overlay
- 🧠 **News Sentiment (FinBERT)** — daily rolling sentiment chart for the active ticker + scored headline list
- 🎲 **Monte Carlo Option Pricer (embedded)** — Black-Scholes-Merton path simulation on AMD MI300X, browser-CPU fallback

## 💼 `/portfolio` — Portfolio Construction

Two stacked sections that turn raw historical data into actionable allocations.

### Section 1 · Efficient Frontier
- Inputs: tickers (comma-separated), start/end year, objective (max Sharpe / min vol / target return), per-asset min/max weight bounds
- Solver: hand-rolled Markowitz QP with projected gradient + simplex projection (no native deps), full parabolic frontier traced by sweeping the Lagrangian dual `q` through both halves
- Plot matches the textbook reference:
  - **Efficient Frontier** (full parabola)
  - **Best possible CAL** (tangent from `(0, r_f)` through tangency portfolio, slope = Sharpe)
  - **Tangency Portfolio** (red dot)
  - **risk-free rate** marker on y-axis
  - **Individual Assets** as orange diamonds with ticker labels
- Live feasibility readout: `Σ min ≤ 1` and `Σ max ≥ 1` — Solve auto-disables when bounds can't sum to 100%

### Section 2 · Walk-Forward Backtest
- Inputs: tickers + per-ticker weights, start/end year, transaction cost (bps), rebalance cadence (monthly/quarterly/yearly), T+1 execution toggle
- Daily NAV walk-forward simulation with turnover-weighted cost drag
- Outputs: equity curve + drawdown overlay, Total Return / Max DD / Sharpe / Annual Vol / Final NAV / # rebalances

## 🎲 `/mc` — Monte Carlo Option Pricer

A retail-friendly Monte Carlo simulator that estimates a fair option price by simulating thousands of price paths. Run the same job in your browser (CPU) or on an AMD MI300X GPU and watch the speedup banner light up. Also embedded inside the `/options` page so you don't have to leave the workbench.

### How to use it

**1. Pick a ticker.** Type a symbol into the search bar (e.g. `NVDA`). Spot price auto-fills from live market data, and the strike snaps to ATM.

**2. Choose an option type:**
- **European** — pays at expiry only
- **American** — can be exercised any day before expiry
- **Asian** — pays on the *average* price over the period
- **Barrier** — knocks out (worth $0) if the price crosses your barrier
- **Lookback** — pays based on the best (call) or worst (put) price seen

**3. Set parameters:** spot, strike, days-to-expiry, volatility, risk-free rate, optional barrier, time steps, simulation count (1K → 10M).

**4. Pick where to run:**
- **Quick · in your browser** — pure JS, works on any laptop
- **Fast · AMD MI300X GPU** — PyTorch on ROCm, 192 GB HBM3, ~70× faster than CPU. If the badge shows `offline`, set `MC_GPU_URL`.

**5. Hit ▶ Run.** Get the fair price ± 95% CI, runtime + paths/sec, engine badge, and a 100-path fan chart with 5/50/95 percentile bands.

**6. Compare engines.** Run on CPU then GPU with identical params — a `⚡ MI300X is N× faster` banner lights up.

### Deep-link via URL

```
/mc?sym=AAPL&type=asian&K=180&T=30D&paths=1000000
```

Supported params: `sym`, `type` (asian/barrier/lookback/american/european), `K`, `T` (e.g. `30D`), `paths`.

### Embed mode

`/mc?embed=1` strips the page chrome — used by the Options Workbench iframe.

---

## 🤖 AMD MI300X Integration · `gpu-service/`

Three real GPU workloads run on the same FastAPI service ([gpu-service/main.py](gpu-service/main.py)):

| Endpoint | Workload | Library |
|----------|----------|---------|
| `POST /mc/run` | Monte Carlo option pricing (Asian/Barrier/Lookback/American/European) | PyTorch on ROCm |
| `POST /finbert/score` | FinBERT batched headline sentiment | `ProsusAI/finbert` via `transformers` |
| `POST /rag/search` | Top-k cosine search over SEC EDGAR filings | ChromaDB + `bge-small-en-v1.5` |
| `GET /health` | Device + model + chunk-count snapshot | — |

### Run the gpu-service

On the MI300X box (or any GPU box; falls back to CPU if no CUDA):

```bash
cd gpu-service
# Install PyTorch separately for ROCm (substitute the right rocm version):
pip install torch --index-url https://download.pytorch.org/whl/rocm6.0
pip install -r requirements.txt
# (Optional) Ingest SEC filings into ChromaDB before first RAG query:
python ingest_edgar.py
uvicorn main:app --host 0.0.0.0 --port 8000
```

Then point Next.js at it:
```
MC_GPU_URL=http://<mi300x-host>:8000
```

FinBERT lazy-loads on first request and warms in a background thread on startup, so the first user request doesn't pay the ~30s HuggingFace download cost.

---

## 🏗️ Architecture

```
app/
├── page.js                       # Equity terminal (single-page dashboard)
├── macro/
│   ├── page.js                   # Macro analysis (8 sections)
│   └── components/
│       └── SentimentHeatmap.js   # Section 08 — FinBERT sector grid
├── options/
│   ├── page.js                   # Options workbench
│   └── components/
│       ├── IVSurface.js          # 3D IV surface (Plotly)
│       ├── IVRVGap.js            # 3D IV-RV gap heatmap
│       ├── Greeks.js             # Δ Γ ν Θ ρ table
│       ├── VolSmile.js           # 2D smile + RR/BF readouts
│       ├── TermStructure.js     # ATM IV term structure
│       ├── VixTerm.js            # VIX/VIX3M/VIX6M
│       ├── SentimentRolling.js   # FinBERT rolling chart
│       └── McEmbed.js            # /mc?embed=1 iframe
├── portfolio/
│   ├── page.js                   # Frontier + Backtest sections
│   └── lib/
│       ├── markowitz.js          # QP solver (projected gradient + simplex)
│       └── backtest.js           # Walk-forward NAV simulator
├── mc/
│   ├── page.js                   # Standalone Monte Carlo pricer
│   └── lib/cpu.js                # JS reference engine
├── components/
│   ├── Nav.js                    # Top-bar links
│   └── ui.js                     # Shared Load/Err/fmt utilities
├── lib/
│   └── sectors.js                # GICS bellwether map for sentiment heatmap
└── data_pages/                   # Server-side route handlers
    ├── stock/                    # Alpaca bars
    ├── options/
    │   ├── route.js              # IV surface + smoothing
    │   └── greeks/route.js       # Black-Scholes Greeks
    ├── earnings/ · financials/ · forecast/ · search/
    ├── history/                  # yahoo-finance2 daily closes (multi-year)
    ├── news/                     # Yahoo + FMP merged + FinBERT-scored
    ├── sentiment/
    │   ├── gpu/route.js          # Next.js → MI300X /finbert/score proxy
    │   └── sectors/route.js      # Per-sector FinBERT aggregation
    ├── mc/gpu/route.js           # Next.js → MI300X /mc/run proxy
    ├── portfolio/
    │   ├── frontier/route.js     # Markowitz solve
    │   └── backtest/route.js     # Walk-forward simulation
    └── macro/
        ├── yields/ · centralbanks/ · calendar/
        ├── commodities/ · commodity-history/ · fx/
        ├── flows/ · flights/ · geopolitical/ · feargreed/
        └── vix/route.js          # VIX term structure (yahoo-finance2)

gpu-service/
├── main.py                       # FastAPI app
├── mc.py                         # PyTorch MC engine
├── finbert.py                    # ProsusAI/finbert lazy loader
├── rag.py                        # ChromaDB top-k search
├── ingest_edgar.py               # SEC EDGAR → ChromaDB
└── requirements.txt
```

Plotly.js (loaded once via CDN) handles every chart — 3D surfaces, choropleth, scattergeo, smile, term structure, frontier, equity curve, sentiment heatmap.

---

## ⚠️ Important
- **Rotate API keys** if you ever shared them publicly (especially before pushing this repo)
- Alpaca free-tier data is delayed ~15 min (IEX feed)
- FMP free tier = 250 calls/day · cache TTL 5–60 min reduces calls
- FRED API limit: 120 req/min (cold yield fetch makes ~44 calls)
- OpenSky free tier: ~10 req/min unauthenticated (cache TTL 60s)
- Yahoo Finance free tier: ~5 req/sec — multi-ticker history requests are chunked
- FinBERT first-call cold start: ~30s (HuggingFace download). Subsequent calls are batched on GPU
- Backtest assumes T+1 close fills + turnover-weighted cost drag; survivorship bias is unhandled (delisted tickers will error)
- This is a research tool — **not** investment advice