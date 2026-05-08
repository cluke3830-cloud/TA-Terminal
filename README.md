# ⚛ Quantum Terminal

**A full-stack equity intelligence platform — built for the AMD Hackathon.**

Eight pages of institutional-grade analytics for retail traders, with **four real GPU workloads** running on AMD Instinct MI300X: FinBERT batched sentiment, Monte Carlo exotic option pricing, a six-state HMM+LSTM market regime classifier, and SEC RAG retrieval. Plus a dedicated AI Analyst page powered by **Gemini 2.5 Flash with live Google Search grounding**.

> **Live demo:** https://ta-terminal-orcin.vercel.app
> **Built for:** AMD Developer Hackathon — Championship Edition

---

## 🚀 The Eight Pages

| Page | What it does | AMD GPU work |
|------|--------------|--------------|
| **`/`** Terminal | Heikin Ashi chart, EMA overlays, AI summary, fundamentals, Smart Money cards (Insider Form 4, 13F, Short Interest) | — |
| **`/macro`** Macro | Fear/Greed gauge, world risk heatmap, central bank monitor, yield curve, FX matrix, commodities, sector sentiment | FinBERT sector heatmap |
| **`/regime`** Regime | Six-state market regime classifier with confidence + playbook | **HMM+LSTM ensemble on MI300X** |
| **`/options`** Options | 3D IV surface, IV-RV gap, Greeks, vol smile, term structure, VIX, news sentiment, embedded MC | **FinBERT sentiment** |
| **`/portfolio`** Portfolio | Markowitz frontier + walk-forward backtest + VaR decomposition | — |
| **`/mc`** Monte Carlo | Exotic option pricer (Asian / Barrier / Lookback / American) | **MC path simulation on MI300X** |
| **`/custom`** Custom | Drag-and-drop dashboard — pick any widget, set any ticker | Includes Regime + Sentiment widgets |
| **`/ai`** AI Analyst | Full-page chat with **Gemini 2.5 Flash + Google Search**, ticker-aware, cited sources | — |

---

## ⚡ AMD MI300X Compute Integration

Four real GPU workloads, all hot-routed through `gpu-service/main.py` (FastAPI on the MI300X droplet via ROCm 7.1):

| Workload | Model / Method | Stack | Latency |
|----------|----------------|-------|---------|
| **FinBERT Sentiment** | ProsusAI/finbert | PyTorch + HuggingFace Transformers on ROCm | ~50–200ms per batch |
| **Monte Carlo Pricing** | Asian / Barrier / Lookback / American | PyTorch tensor ops, 1M paths | Milliseconds |
| **Regime Engine** | HMM + LSTM + Attention (6 states) | PyTorch on ROCm, trained per ticker | ~2 min cold / <100 ms cached |
| **SEC RAG** | bge-small-en-v1.5 + ChromaDB | Cosine search over EDGAR filings | <100 ms |

The Next.js app proxies every GPU request through `MC_GPU_URL` / `REGIME_API_URL` environment variables. Widgets and pages **degrade gracefully** when the droplet is offline — sentiment falls back to the Loughran-McDonald lexicon, MC falls back to browser-CPU, regime widgets show a clean offline state.

---

## 🤖 AI Analyst (`/ai`)

Dedicated full-page chat interface powered by **Gemini 2.5 Flash + Google Search grounding**.

- Ticker-aware via `?sym=NVDA` URL param — automatically scopes every question to the active ticker
- Streams responses with inline citation superscripts `[1]` `[2]` linking to live sources
- Up to 5 grounded web sources per response (server-side capped)
- Markdown rendering: `## headers`, `**bold**`, bullet points
- Six quick-start chips: Full analysis · Earnings setup · Quant snapshot · Bull vs bear · Valuation check · Risk factors
- ⌘J or `7` keyboard shortcut to navigate from anywhere

---

## 🧠 Six-State Regime Classifier (`/regime`)

Six-regime ensemble (Rules + HMM + LSTM, weights 0.45 / 0.35 / 0.20) built on 21 macro + volatility features. Trained per-ticker on MI300X.

| Regime | Color | Meaning | Action |
|--------|-------|---------|--------|
| **Calm Trend** | 🟢 | Steady bull, low vol | Stay long, full equity |
| **Volatile Trend** | 🟠 | Strong direction, bumpy path | Scale with trend direction |
| **Low-Vol Range** | 🔵 | Quiet range-bound tape | Stay long but lighter |
| **High-Vol Churn** | ⚪ | Whipsaw, no signal | De-risk, cut leverage |
| **Correction** | 🟡 | Drawdown building | Light defensive short |
| **Crisis** | 🔴 | Severe drawdown, vol spike | Net short / hedged |

Hero panel shows ensemble confidence (entropy-mixed, capped ~91.7%), 1-bar / 5-bar forecast, rolling Sharpe, OOS calibration, and transition detector.

Available as a **dashboard widget** under `/custom` — current state pill, 6-segment probability strip, mini timeline.

---

## 📦 Stack

- **Frontend:** Next.js 14 (App Router) · TradingView Lightweight Charts · Plotly.js (CDN)
- **AI:** Gemini 2.5 Flash via `@google/generative-ai` with `googleSearch` grounding
- **GPU service:** FastAPI + PyTorch on ROCm 7.1 — Monte Carlo, FinBERT, Regime (HMM+LSTM), RAG (ChromaDB + bge-small)
- **Equity APIs:** Alpaca · FMP · yahoo-finance2
- **Macro APIs:** FRED · OpenSky · World Bank · EIA · IMF COFER
- **SEC fallback:** EDGAR direct (`data.sec.gov/submissions`)
- **Deploy:** Vercel (Next.js) + AMD Developer Cloud droplet (gpu-service) + Render free tier (regime-service CPU fallback)

---

## 🚀 Deploy in 2 Minutes

### Step 1 · Clone & push to your GitHub

```bash
git clone https://github.com/cluke3830-cloud/TA-Terminal.git
cd TA-Terminal
git remote set-url origin https://github.com/YOUR_USERNAME/TA-Terminal.git
git push -u origin main
```

### Step 2 · Deploy on Vercel

1. Go to **[vercel.com/new](https://vercel.com/new)**
2. Import your repo
3. Add the environment variables below
4. Click **Deploy** ✅

| Name | Used by | Free key at |
|------|---------|-------------|
| `ALPACA_API_KEY` | `/`, `/options` | https://alpaca.markets → Paper Trading |
| `ALPACA_SECRET_KEY` | `/`, `/options` | (same) |
| `FMP_API_KEY` | all pages | https://financialmodelingprep.com → Dashboard |
| `FRED_API_KEY` | `/macro`, `/regime` | https://fred.stlouisfed.org/docs/api/api_key.html |
| `EIA_API_KEY` | `/macro` | https://www.eia.gov/opendata/register.php |
| `GEMINI_API_KEY` | `/ai` | https://aistudio.google.com/app/apikey (free: 15 RPM, 1500 RPD) |
| `MC_GPU_URL` | MC pricer · FinBERT sentiment | URL of your `gpu-service` host |
| `REGIME_API_URL` | `/regime`, regime widget | URL of your `gpu-service` or `regime-service` host |

OpenSky, World Bank, and yahoo-finance2 need no key. Every GPU/AI feature degrades gracefully when its env var is unset.

---

## 🖥️ Run Locally

```bash
git clone https://github.com/cluke3830-cloud/TA-Terminal.git
cd TA-Terminal
npm install
cp .env.example .env.local   # then fill in your keys
npm run dev
```

Open **http://localhost:3000**.

> **macOS / zsh tip:** Don't paste commands with inline `#` comments — zsh treats `#` as literal by default.

---

## ⚡ Set Up the AMD MI300X GPU Service

The same FastAPI process exposes all four GPU endpoints — Monte Carlo, FinBERT, Regime, and RAG.

```bash
# On your MI300X droplet (AMD Developer Cloud)
git clone https://github.com/cluke3830-cloud/TA-Terminal.git
cd TA-Terminal/gpu-service

# Install ROCm-flavored PyTorch
pip install torch --index-url https://download.pytorch.org/whl/rocm6.0
pip install -r requirements.txt

# Optional: pre-load SEC filings into ChromaDB for RAG
python ingest_edgar.py

# Start the service
uvicorn main:app --host 0.0.0.0 --port 8000
```

Then point your Vercel env vars at it:
```
MC_GPU_URL=http://<droplet-ip>:8000
REGIME_API_URL=http://<droplet-ip>:8000
```

| Endpoint | Workload |
|----------|----------|
| `POST /mc/run` | Monte Carlo option pricing |
| `POST /finbert/score` | FinBERT batched headline sentiment |
| `POST /regime/run` | Six-state regime classification |
| `POST /rag/search` | Top-k cosine search over SEC EDGAR filings |
| `GET /health` | Device + model + chunk-count snapshot |

---

## 📊 Page-by-Page Features

### `/` Terminal
- Heikin Ashi candlestick + EMA 8/21/55 + volume bars (auto-refresh 60s)
- Fundamentals: 9 ratios, Income / Balance / Cash Flow, earnings history, analyst targets
- News feed with FinBERT sentiment badges + 7d/30d rolling readouts
- **Smart Money:** Insider Form 4 (FMP + EDGAR fallback) · 13F flow score · FINRA short interest with 90-day price overlay

### `/macro` Macro Intelligence
- Fear & Greed composite gauge (6 weighted signals)
- World map: geopolitical risk heatmap, oil reserves, OpenSky live flights
- Central Bank Monitor (Fed/ECB/BOJ/BOE/PBOC/RBA/SNB/BOC) + next-meeting dates
- US Treasury yield curve with inversion detection
- 8×8 FX strength matrix + ICE-formula DXY
- Commodity & Energy Pulse with 30-day sparklines
- Global Flows: World Bank reserves choropleth + IMF COFER
- **Sector Sentiment Heatmap (FinBERT)** — 11 GICS sectors color-coded by mean sentiment

### `/options` Options Workbench
- 3D Implied Volatility Surface (Black-Scholes solver over Alpaca chain)
- 3D IV − RV Gap Surface (expensive vs cheap zones)
- Greeks Table (Δ Γ ν Θ ρ by strike × expiry)
- Vol Smile / Skew with **25Δ Risk Reversal** + **25Δ Butterfly** readouts
- ATM IV term structure with contango/backwardation flag
- VIX term structure (VIX / VIX3M / VIX6M)
- **News Sentiment (FinBERT)** rolling chart
- Embedded Monte Carlo pricer

### `/portfolio` Portfolio Construction
1. **Efficient Frontier** — hand-rolled Markowitz QP, full parabolic frontier, tangency portfolio, Best CAL
2. **Walk-Forward Backtest** — daily NAV simulation, T+1 fills, turnover-weighted cost drag
3. **Risk Decomposition** — Hist/Param VaR + CVaR, Max DD, Beta, per-asset Marginal/Component VaR (sums exactly to Param VaR)

### `/mc` Monte Carlo
- Exotic option types: European · American · Asian · Barrier · Lookback
- Path counts: 1K → 10M
- CPU vs GPU comparison with `⚡ MI300X is N× faster` banner
- Deep-link: `/mc?sym=AAPL&type=asian&K=180&T=30D&paths=1000000`

### `/custom` Custom Dashboard
- Drag-and-drop grid layout
- Add any widget by name via command palette
- Per-widget ticker scoping
- Includes: **Regime Intelligence** (6-state classifier) and **News Sentiment** (FinBERT) widgets

### `/ai` AI Analyst
- Full-page chat with Gemini 2.5 Flash + Google Search grounding
- Six quick-start chips for common retail-investor questions
- Cited responses with source links (max 5)
- Markdown rendering for headers, bold, bullets
- ⌘J shortcut from any page

---

## 🏗️ Architecture

```
app/
├── page.js                      # Terminal — chart, fundamentals, Smart Money
├── ai/page.js                   # AI Analyst (Gemini + Google Search)
├── custom/page.js               # Drag-and-drop widget dashboard
├── macro/page.js                # 8-section macro analysis
├── regime/page.js               # 6-state regime classifier
├── options/page.js              # IV surface, vol smile, sentiment
├── portfolio/page.js            # Frontier + Backtest + Risk
├── mc/page.js                   # Monte Carlo pricer
├── components/
│   ├── Nav.js · CommandPalette.js · ChartWithIndicators.js
│   ├── InsiderCard.js · HoldingsCard.js · ShortInterestCard.js
│   └── custom/widgets/
│       ├── NewsSentimentWidget.js     # FinBERT spark + headlines
│       └── RegimeWidget.js            # 6-state classifier card
└── data_pages/                  # Server-side route handlers
    ├── ai_chat/route.js               # Gemini 2.5 Flash streaming + grounding
    ├── stock/ · options/ · greeks/    # Alpaca + Black-Scholes
    ├── earnings/ · financials/ · forecast/ · search/
    ├── news/                          # Yahoo + FMP merged + FinBERT-scored
    ├── insider/ · holdings/ · short-interest/
    ├── sentiment/gpu · mc/gpu          # MI300X proxies
    ├── regime/run                      # MI300X regime proxy
    ├── portfolio/{frontier,backtest,risk}
    └── macro/{yields,centralbanks,calendar,commodities,fx,flows,flights,geopolitical,feargreed,vix}

gpu-service/                     # AMD MI300X FastAPI host
├── main.py                      # /mc/run · /finbert/score · /regime/run · /rag/search · /health
├── mc.py · finbert.py · regime.py · rag.py
└── requirements.txt

regime-service/                  # CPU-only Render fallback
├── main.py · regime.py · requirements.txt
└── render.yaml                  # Render auto-deploy

regime_dashboard.py              # 4000-line HMM+LSTM+Attention engine (root)
```

---

## ⚠️ Notes

- **Rotate API keys** if pushed publicly
- Alpaca free tier: ~15 min delayed (IEX feed)
- FMP free tier: 250 calls/day · server cache (5–60 min TTL) reduces usage
- FRED: 120 req/min · cold yield fetch ~44 calls
- Gemini free tier: 15 RPM, 1500 RPD on `gemini-2.5-flash`
- FinBERT first-call cold start: ~30 s (HuggingFace download); subsequent calls batch on GPU
- Regime first-call cold start: 2–3 min (HMM+LSTM training); subsequent calls cached <100 ms
- 13F filings: 45-day window post-quarter-end · auto-drops partial quarters when holder count <60% of prior
- FINRA short interest: biweekly · STALE badge after 14 days
- Backtest: T+1 close fills + turnover-weighted cost drag · survivorship bias unhandled
- Risk Decomposition: constant-weight covariance for Marginal/Component VaR · Sharpe + Max DD share NAV with Backtest
- **Research tool — not investment advice**

---

## 🏆 Built for AMD Hackathon Championship Edition · 2026

Quantum Terminal demonstrates real GPU compute integration on AMD Instinct MI300X — not a wrapper, not a proxy. FinBERT inference, exotic option Monte Carlo, and a six-state HMM+LSTM regime engine all run natively on ROCm. The result is a $24K-tier Bloomberg-class platform, free to use, with the AI muscle of Gemini 2.5 Flash and the GPU horsepower of MI300X behind every intelligent feature.