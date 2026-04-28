# ⚛ Taeheon Terminal · Quantum Stock + Macro

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