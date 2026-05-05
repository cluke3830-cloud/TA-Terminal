# How to Update & Redeploy

## Every Future Session

**Step 1 — Get a fresh working copy** (only needed after a reboot or new machine)

```bash
git clone https://github.com/cluke3830-cloud/TA-Terminal.git ~/Projects/TA-Terminal
cd ~/Projects/TA-Terminal
```

If the folder already exists from a previous session, just pull the latest instead:

```bash
cd ~/Projects/TA-Terminal
git pull origin main
```

---

**Step 2 — Install dependencies** (only needed after a fresh clone)

```bash
npm install
```

---

**Step 3 — Run locally to test your changes**

```bash
npm run dev
```

Open http://localhost:3000 — make and verify your changes.

---

**Step 4 — Commit and push to GitHub**

```bash
git add <file1> <file2>          # stage specific files (safer than git add .)
git commit -m "describe your change"
git push origin main
```

Vercel detects the push and **auto-deploys within ~30 seconds** — no manual steps needed in Vercel.

Watch the build live at: https://vercel.com → ta-terminal-fee3 → Deployments

---

## Environment Variables

If you add a new API key or change an existing one:

1. Go to **vercel.com → ta-terminal-fee3 → Settings → Environment Variables**
2. Add / update the key for **Production**
3. Trigger a redeploy: Deployments → latest deployment → **Redeploy**

Current keys in use:

| Key | Where to get it |
|-----|----------------|
| `ALPACA_API_KEY` | alpaca.markets → Paper Trading → API Keys |
| `ALPACA_SECRET_KEY` | (same as above) |
| `FMP_API_KEY` | financialmodelingprep.com → Dashboard |
| `FRED_API_KEY` | fred.stlouisfed.org/docs/api/api_key.html |
| `EIA_API_KEY` | eia.gov/opendata/register.php |
| `REGIME_API_URL` | Your Render service URL (e.g. `https://ta-terminal-regime.onrender.com`) |

---

## Regime Service (Render)

The `/regime` page runs on a separate FastAPI service hosted on Render.
It stays alive via a free cron ping — no action needed unless you change `regime_dashboard.py` or `regime-service/`.

If you update the regime engine, redeploy Render manually:
1. Go to **render.com → ta-terminal-regime → Manual Deploy → Deploy latest commit**

---

## ⚠️ Never Commit

These files contain real API keys — they are gitignored but double-check before any `git add .`:

```
.env.local
env.local
env(Shared).txt
```
