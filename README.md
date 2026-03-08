# ⚛ Quantum Stock Terminal

Live stock analysis dashboard: Heikin Ashi charts, 3D IV surfaces, earnings, financials, analyst targets.

## Stack
- **Frontend:** Next.js 14 + TradingView Lightweight Charts + Plotly.js
- **APIs:** Alpaca (stock bars + options/IV) · FMP (financials + earnings + forecasts)
- **Deploy:** Vercel (free tier, one-click)

---

## 🚀 Deploy in 2 Minutes

### Step 1: Push to GitHub

```bash
cd quantum-stock-terminal
git init
git add .
git commit -m "Quantum Stock Terminal v2"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/quantum-stock-terminal.git
git push -u origin main
```

### Step 2: Deploy on Vercel

1. Go to **[vercel.com/new](https://vercel.com/new)**
2. Click **"Import"** next to your repo
3. In **"Environment Variables"**, add these 3:

| Name | Value |
|------|-------|
| `ALPACA_API_KEY` | your Alpaca key |
| `ALPACA_SECRET_KEY` | your Alpaca secret |
| `FMP_API_KEY` | your FMP key |

4. Click **Deploy** ✅

Your site is now live at `https://quantum-stock-terminal.vercel.app`

---

## 🖥️ Run Locally

```bash
npm install
# Make sure .env.local has your keys (already included if you downloaded this)
npm run dev
# Open http://localhost:3000
```

---

## Features
- ⚡ Heikin Ashi candlestick chart with EMA 8/21/55 + volume
- 📊 Earnings history + next earnings date + quarterly revenue bars
- 📈 9 key financial ratios + income/balance/cash flow statements
- 🌊 3D Implied Volatility Surface (Black-Scholes solver)
- ⚡ 3D IV−RV Gap Surface (options mispricing detector)
- 🎯 Analyst price targets + consensus ratings + stock news
- 🔍 Live symbol search
- 🔄 Auto-refresh every 60 seconds (chart + IV surfaces)

## ⚠️ Important
- **Rotate your API keys** if you ever shared them publicly
- Free-tier Alpaca data is delayed ~15 min (IEX feed)
- FMP free tier = 250 API calls/day
