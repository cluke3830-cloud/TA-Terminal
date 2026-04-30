# ⚛ TA Terminal · Quantum Stock + Macro

A two-page financial intelligence platform built for retail traders.
Equity analytics on `/` and global macro signals on `/macro`.

> Built for the **AMD Hackathon Championship Edition**

## Stack
- **Frontend:** Next.js 14 + TradingView Lightweight Charts + Plotly.js (CDN)
- **Equity APIs:** Alpaca (bars + options/IV) · FMP (financials + earnings + forecasts)
- **Macro APIs:** FRED (yields) · FMP (FX/commodities/calendar) · OpenSky (live flights) · World Bank · EIA · IMF COFER
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

| Name | Page | Free Key At |
|------|------|-------------|
| `ALPACA_API_KEY` | `/` | https://alpaca.markets → Paper Trading → API Keys |
| `ALPACA_SECRET_KEY` | `/` | (same as above) |
| `FMP_API_KEY` | `/` and `/macro` | https://financialmodelingprep.com → Dashboard |
| `FRED_API_KEY` | `/macro` | https://fred.stlouisfed.org/docs/api/api_key.html |
| `EIA_API_KEY` | `/macro` | https://www.eia.gov/opendata/register.php |

OpenSky Network and World Bank APIs need no key.

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

**3. Create your `.env` file** at the project root with all 5 keys:
```
ALPACA_API_KEY=your_alpaca_key
ALPACA_SECRET_KEY=your_alpaca_secret
FMP_API_KEY=your_fmp_key
FRED_API_KEY=your_fred_key
EIA_API_KEY=your_eia_key
```

**4. Start the dev server:**
```bash
npm run dev
```

Open **http://localhost:3000** in your browser.
- `/` → Equity Terminal (Heikin Ashi, IV surfaces, earnings)
- `/macro` → Macro Analysis (yields, FX, commodities, world map)
- `/mc` → Monte Carlo Option Pricer (browser CPU vs AMD MI300X GPU)

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
- 🌊 3D Implied Volatility Surface (Black-Scholes solver)
- ⚡ 3D IV−RV Gap Surface (options mispricing detector)
- 🎯 Analyst price targets, consensus ratings, news feed
- 🔍 Live symbol search · 🔄 Auto-refresh every 60s

## 🎲 `/mc` — Monte Carlo Option Pricer

A retail-friendly Monte Carlo simulator that estimates a fair option price by simulating thousands of price paths. Run the same job in your browser (CPU) or on an AMD MI300X GPU and watch the speedup banner light up.

### How to use it

**1. Pick a ticker.** Type a symbol into the search bar at the top of the page (e.g. `NVDA`, `AAPL`, `TSLA`). Spot price auto-fills from live market data, and the strike snaps to ATM unless you've already moved it.

**2. Choose an option type.** Each button has a one-line plain-English blurb:
- **European** — standard option, pays at expiry only
- **American** — can be exercised any day before expiry
- **Asian** — pays on the *average* price over the period (less volatile)
- **Barrier** — knocks out (worth $0) if the price crosses your barrier
- **Lookback** — pays based on the best (call) or worst (put) price seen

Then pick **Call** (profits if price goes up) or **Put** (profits if price goes down).

**3. Set the parameters.**
- **Stock price (today)** — auto-filled, override if you want a hypothetical
- **Strike price** — where the option pays off vs current price
- **Days to expiry** — how long until the option expires
- **Volatility (annual)** — expected % swing per year (typical equities: 25–60%)
- **Risk-free rate** — roughly the Treasury yield (4–5% lately)
- **Knock-out barrier** — only enabled when option type is *Barrier*; auto-suggested at ±15% of spot
- **Time steps** — granularity of the simulation (252 = daily for one year)
- **Simulations** — drag the slider from 1K to 10M paths (more = more accurate, slower)

**4. Pick where to run.**
- **Quick · in your browser** — pure JavaScript, works on any laptop, slower at large simulation counts
- **Fast · AMD MI300X GPU** — PyTorch on ROCm, 192 GB HBM3 memory, ~70× faster than CPU. If the badge shows `offline`, the GPU service isn't reachable; stick with CPU.

**5. Hit ▶ Run.** Watch the progress bar and the elapsed timer. When it finishes you'll see:
- **Estimated fair price** — with a 95% confidence interval (`± stderr`)
- **How long it took** + simulated paths/sec
- **Engine** badge (Browser or AMD MI300X)
- A **100-path fan chart** with the 5th / 50th (median) / 95th percentile bands, your strike line, and the barrier (if set)

**6. Compare engines.** Run once on CPU, switch the radio to GPU, and run again with the *same* parameters. A `⚡ MI300X is N× faster than CPU` banner appears once both engines have run against the current input set.

### Quick start with presets

Tap a preset button to fill the form with a common scenario:
- **ATM Call · 30 days** — at-the-money European call expiring in a month
- **OTM Put 10% · 60 days** — 10% out-of-the-money European put, 2 months out
- **Asian Avg · 30 days** — Asian average-price call, 30 days
- **Knock-out Call** — Barrier call with the knock-out auto-set 15% above spot

### Deep-link via URL

You can land directly on a preconfigured pricer from anywhere (handy for the global ⌘K palette):

```
/mc?sym=AAPL&type=asian&K=180&T=30D&paths=1000000
```

Supported params: `sym`, `type` (asian/barrier/lookback/american/european), `K` (strike), `T` (days, e.g. `30D`), `paths`.

### GPU service (optional)

The Fast engine talks to a separate Python service in [gpu-service/](gpu-service/) that runs PyTorch on ROCm. Without it, the GPU radio shows `offline` and the page falls back to CPU only. The CPU engine works out-of-the-box with no extra setup.

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

---

## 🏗️ Architecture

```
app/
├── page.js                  # Equity terminal (single-page dashboard)
├── macro/page.js            # Macro analysis dashboard (8 sections)
├── components/
│   ├── Nav.js               # Shared TERMINAL ↔ MACRO navigation
│   └── ui.js                # Shared Load/Err/fmt utilities
├── data_pages/              # Server-side route handlers (Next.js route.js)
│   ├── stock/options/...    # Equity routes (Alpaca + FMP)
│   └── macro/
│       ├── yields/          # FRED Treasury curve
│       ├── centralbanks/    # Policy rates + FMP calendar
│       ├── calendar/        # Economic events + surprises
│       ├── commodities/     # FMP + EIA
│       ├── fx/              # FMP forex matrix + DXY
│       ├── flows/           # World Bank + IMF COFER
│       ├── flights/         # OpenSky Network
│       ├── geopolitical/    # Static curated risk + oil reserves
│       └── feargreed/       # Composite aggregator
└── globals.css              # Dark terminal theme · neon accents
```

Zero new npm dependencies were added for the macro page — Plotly.js loaded once via CDN handles every map and chart (choropleth, scattergeo, line, sankey, pie).

---

## ⚠️ Important
- **Rotate API keys** if you ever shared them publicly (especially before pushing this repo)
- Alpaca free-tier data is delayed ~15 min (IEX feed)
- FMP free tier = 250 calls/day · cache TTL 5–60 min reduces calls
- FRED API limit: 120 req/min (cold yield fetch makes ~44 calls)
- OpenSky free tier: ~10 req/min unauthenticated (cache TTL 60s)
- This is a research tool — **not** investment advice
