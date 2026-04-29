#!/usr/bin/env python3
"""
Market Regime Classification Engine  v6
=========================================
4-regime classifier with HMM + LSTM+Attention ensemble, multi-scale features,
cross-asset correlations, FRED macro layer, VIX sentiment, duration modelling,
transition detection, optimised scoring weights, and interactive dashboard.

Regimes
  0 — Calm Trend      low vol, strong directional momentum
  1 — Volatile Trend   high vol, strong directional momentum
  2 — Chop             low momentum, mean-reverting
  3 — Risk-Off         shock-driven, drawdown stress

Architecture
  21-feature scoring (multi-scale + cross-asset + macro + sentiment)
  GaussianHMM (4 states, diag cov) with online warm-start updates
  LSTM+Attention (2-layer LSTM + multi-head self-attention, 30-bar seqs)
  Transition detection network (MLP, predicts regime changes 1-5 bars ahead)
  Optimised scoring weights (differential evolution + purged k-fold CV)
  3-way ensemble: 30 % rules + 35 % HMM + 35 % LSTM
  Empirical survival-based duration forecasting
  3-line performance: Ensemble vs Rule-Only vs Benchmark

Data   : yfinance (daily OHLCV) + FRED (macro) + VIX sentiment
Dashboard : Plotly Dash  ->  http://localhost:8050
"""

import os
import sys
import time
import threading
import warnings
from collections import Counter
from datetime import datetime
from itertools import permutations

import numpy as np
import pandas as pd
import yfinance as yf
from dotenv import load_dotenv
from sklearn.decomposition import PCA
from sklearn.isotonic import IsotonicRegression
import plotly.graph_objects as go
import dash
from dash import dcc, html
from dash.dependencies import Input, Output, State
import networkx as nx

# scipy availability (weight optimisation)
try:
    from scipy.optimize import differential_evolution as _de
    HAS_SCIPY = True
except ImportError:
    HAS_SCIPY = False
    print("[warn] scipy not installed — weight optimisation disabled")

# FRED availability
try:
    from fredapi import Fred
    HAS_FRED = True
except ImportError:
    HAS_FRED = False
    print("[warn] fredapi not installed — macro features disabled")
warnings.filterwarnings("ignore")
load_dotenv()

# ── HMM availability ─────────────────────────────────────────────────
try:
    from hmmlearn.hmm import GaussianHMM
    HAS_HMM = True
except ImportError:
    HAS_HMM = False
    print("[warn] hmmlearn not installed — falling back to rule-only mode")

# ── LSTM availability ────────────────────────────────────────────────
try:
    import torch
    import torch.nn as nn
    from torch.utils.data import TensorDataset, DataLoader
    HAS_LSTM = True
except ImportError:
    HAS_LSTM = False
    print("[warn] PyTorch not installed — LSTM disabled")

# =====================================================================
# CONSTANTS
# =====================================================================

DEFAULT_TICKER = "SPY"
DATE_FROM = "2005-01-01"
DATE_TO = datetime.now().strftime("%Y-%m-%d")

# Feature lookbacks
VOL_WINDOW       = 21
VOL_WINDOW_LONG  = 63
ADX_PERIOD       = 14
ADX_PERIOD_LONG  = 63
DD_WINDOW        = 252
AUTOCORR_WINDOW  = 21
SHOCK_WINDOW     = 63
VOLANOM_WINDOW   = 63
MA_SHORT         = 21
MA_LONG          = 63
CORR_WINDOW      = 63
MOM_WINDOW       = 42          # rolling cumulative return (captures slow grinds)
NORM_WINDOW      = 252
ANNUALIZE        = 252

# v6: multi-scale feature windows
VOL_WINDOW_SHORT  = 5           # ultra-short volatility
VOL_WINDOW_YEARLY = 252         # yearly volatility
MOM_SHORT         = 5           # ultra-short momentum
MOM_LONG          = 252         # yearly momentum
AUTOCORR_LONG     = 63          # long autocorrelation

# v9.1: EWMA decay factors (RiskMetrics-style exponential weighting).
# Replaces hard rolling windows for volatility/shock features so that
# past shocks decay smoothly instead of dropping out abruptly at window
# boundary.  Half-life = ln(0.5) / ln(lambda).  Chosen to roughly match
# the original rolling-window horizons:
#    lambda=0.85  -> half-life  4.3 bars   (replaces 5-bar window)
#    lambda=0.94  -> half-life 11.2 bars   (replaces 21-bar window)
#    lambda=0.98  -> half-life 34.3 bars   (replaces 63-bar window)
#    lambda=0.995 -> half-life  138 bars   (replaces 252-bar window)
EWMA_LAM_SHORT    = 0.85
EWMA_LAM_MED      = 0.94        # RiskMetrics canonical daily lambda
EWMA_LAM_LONG     = 0.98
EWMA_LAM_YEARLY   = 0.995

# Regime definitions (v7: 6 regimes — Chop + Risk-Off split via BIC/CV sweep)
N_REGIMES = 6
REGIME_NAMES = {
    0: "Calm Trend",        # low vol, strong uptrend, positive momentum
    1: "Volatile Trend",    # high vol + strong directional move
    2: "Low-Vol Range",     # ultra-low vol, flat, low shock (grind)
    3: "High-Vol Churn",    # elevated vol, sideways, high shock (old "Chop")
    4: "Correction",        # moderate DD, neg momentum, elevated vol (NEW)
    5: "Crisis",            # severe DD + shock + credit/VIX spike (old Risk-Off)
}
REGIME_COLORS = {
    0: "#00ff88", 1: "#ff6600", 2: "#66aaff",
    3: "#aaaaaa", 4: "#ffaa33", 5: "#ff0033",
}
REGIME_COLORS_RGBA = {
    0: "rgba(0,255,136,{})",
    1: "rgba(255,102,0,{})",
    2: "rgba(102,170,255,{})",
    3: "rgba(170,170,170,{})",
    4: "rgba(255,170,51,{})",
    5: "rgba(255,0,51,{})",
}
# Plain-language descriptions shown on the hero panel.  These are drafts —
# user can rewrite them without touching any logic.
REGIME_DESCRIPTIONS = {
    0: "Steady advance. Volatility is low and the trend is intact — "
       "typical of a healthy bull market.",
    1: "Sharp directional move with elevated volatility. Trend is strong "
       "but the path is bumpy — momentum regime.",
    2: "Quiet, range-bound tape. Vol is unusually compressed — slow grind "
       "with little directional conviction.",
    3: "Choppy, two-way action. Volatility is up but price is going "
       "nowhere — whipsaws likely, signal-to-noise is poor.",
    4: "Moderate drawdown with negative momentum and rising volatility. "
       "Risk-off building, not yet a crisis.",
    5: "Severe drawdown, vol spike, credit/safe-haven flight. "
       "Capital-preservation regime.",
}
REGIME_ACTIONS_TEXT = {
    0: "Stay long. Take full equity exposure.",
    1: "Scale exposure with trend direction (full long if uptrend, "
       "reduced long if downtrend — never short).",
    2: "Stay long but lighter. Quiet markets reward patience, not size.",
    3: "De-risk to a small long. Cut leverage; this regime burns alpha.",
    4: "Light defensive short. Reduce gross exposure; protect capital.",
    5: "Net short / hedged. Crisis playbook — preserve drawdown floor.",
}

# v9.3: NBER-dated US recessions + major bear markets, used as ground-truth
# anchors to validate regime labels.  During these windows a well-calibrated
# model should spend most of its time in Correction / Crisis / High-Vol Churn.
# The 2022 window is not NBER-classified (no GDP recession) but had a
# sustained SPY drawdown of 25% — included because it's the exact window
# the user flagged as misclassified.
RECESSION_RANGES = [
    ("2001-03-01", "2001-11-30"),   # dot-com
    ("2007-12-01", "2009-06-30"),   # GFC
    ("2020-02-01", "2020-04-30"),   # COVID
    ("2022-01-03", "2022-10-14"),   # 2022 bear market (non-NBER)
]
# Regimes counted as "risk-off" for recession recall.
RISKOFF_REGIMES = {3, 4, 5}   # High-Vol Churn, Correction, Crisis

# Scoring / ensemble  (3-way: rules + HMM + LSTM)
# v9 : temp lowered 10.0 -> 5.0 for 6-regime build.
# v10: temp lowered 5.0 -> 2.0.  Reason: with 21 normalised features in [0,1]
# and 6 regimes, score gaps between argmax and runner-up are typically
# 0.3-0.5.  At temp=5, that gap inflates to a 4-7x probability ratio,
# pushing p_argmax to 0.85-0.92 even when underlying evidence is moderate
# — the dominant cause of >95% confidence saturation on >20% of bars.
# At temp=2, the same 0.4 gap maps to a 2.2x ratio (p_argmax ~0.45-0.55),
# letting calibration truly reflect uncertainty.  Argmax order is preserved
# so the regime label / strategy signal change only via the temporal
# stabiliser threshold; sharpe should be largely unaffected.
SOFTMAX_TEMP     = 2.8
# v9.2: rebalanced weights.  Rules carry explicit regime templates with
# independent semantics.  LSTM trains on rule+HMM soft targets with same
# 21 features -> mostly memorises them rather than adding orthogonal info.
# Old 0.30/0.35/0.35 treated three correlated voters as independent, driving
# 100% confidence when they agreed.  New 0.45/0.35/0.20 reflects the actual
# information each source contributes.
ENS_W_RULES      = 0.45   # rule-based weight
ENS_W_HMM        = 0.35   # HMM weight
ENS_W_LSTM       = 0.20   # LSTM weight
# v9.2: entropy smoothing on final ensemble probability.  Mix a small
# uniform prior into the blend so max-prob caps at ~1 - ENS_ENTROPY_MIX +
# ENS_ENTROPY_MIX/N.  With MIX=0.05 and N=6, a "100% confident" raw blend
# reports 95.8% — honest about residual uncertainty without changing argmax.
# v10: 0.05 -> 0.10 .  Now that isotonic is disabled (CALIB_ENABLED=False),
# the entropy mix is the SOLE mechanism caps reported confidence.  At
# MIX=0.10 / N=6, a "100% confident" blend reports max 91.7%.  This is
# the right honest ceiling for a 6-class classifier with correlated voters.
ENS_ENTROPY_MIX  = 0.05
# v9.3: hard cap on post-isotonic confidence.  Isotonic regression produces
# a plateau at 1.0 when the top-probability bin happened to be 100% correct
# in-sample — mathematically valid but financially implausible.
# v10: 0.97 -> 0.92.  Even with isotonic disabled, the cap stays as a
# defence-in-depth.  At entropy mix 0.10 + 6 regimes, a degenerate raw
# blend already maxes at 0.917, so 0.92 is the natural ceiling and the
# cap rarely binds.  It still protects against any future calibration
# step that might push back above this level.
CONF_MAX_CAP     = 0.92
# v9 : HMM reduced 6 -> 5 states with full covariance. K=6 + diag produced
#       degenerate states which poisoned the ensemble.
# v10: full -> diag.  At d=21 features, full cov = 231 params/state vs 21
#       for diag.  Walk-forward early refits had ~2.5 obs/param ratio under
#       full cov — overfitting territory.  K kept at 5; if diag-K=5 shows
#       transmat-row collapse on the next run, re-sweep K via
#       hmm_state_sweep.py and try K=4.
HMM_N_STATES     = 5
HMM_N_ITER       = 100    #      states map many-to-one into 6 regime labels

# LSTM hyper-parameters
LSTM_SEQ_LEN     = 30     # input sequence length (bars)
LSTM_HIDDEN1     = 64     # first LSTM layer hidden size
LSTM_HIDDEN2     = 32     # second LSTM layer hidden size
LSTM_EPOCHS      = 20     # max epochs per walk-forward refit
LSTM_BATCH       = 64     # batch size
LSTM_LR          = 2e-3   # learning rate
LSTM_PATIENCE    = 5      # early stopping patience (epochs)

# v8 : soft-label training — LSTM targets blend HMM posteriors with rules.
# v10: target rebuilt to break label leakage (Phase 2 of overfit fix).
#
# TARGET MODES:
#   "forward" (default) — derive a ground-truth regime label from realised
#       FUTURE returns/vol/drawdown over the next LSTM_FORWARD_WIN bars.
#       The LSTM thus learns "given the last 30 bars of features, what does
#       the NEXT 10 bars look like in regime terms?"  This is a different
#       question than rules/HMM answer (which classify the CURRENT regime
#       from current/recent features), so the LSTM contributes genuine
#       early-warning information instead of mimicking the teachers.
#       Forward labels use absolute thresholds so the targets are stable
#       across regimes (a 25% vol day means the same thing in 2017 and 2023).
#   "soft"    — legacy v8/v9 behaviour: blend HMM posterior with one-hot
#       rule label.  Kept for A/B comparison only; if you set this, expect
#       overfit symptoms to return.
LSTM_TARGET_MODE = "forward"
SOFT_ALPHA_HMM   = 0.3            # only used when LSTM_TARGET_MODE == "soft"
LSTM_FORWARD_WIN = 10             # forward window for regime-label derivation

# Forward-regime thresholds (annualised, absolute units — calibrated for SPY).
# Tune these for other tickers if their characteristic vol differs.
FWD_VOL_LOW    = 0.10   # below = low-vol regime candidate
FWD_VOL_MED    = 0.18   # above = elevated vol
FWD_VOL_HIGH   = 0.30   # above = crisis-grade vol
FWD_DD_CORR    = 0.07   # 10-bar drawdown above = correction candidate
FWD_DD_CRISIS  = 0.15   # 10-bar drawdown above = crisis
FWD_RET_TREND  = 0.015  # cumulative magnitude above = directional move

# v8 : calibration — held-out fraction used to fit the isotonic regressor.
# v10: CALIB_ENABLED added.  Isotonic was calibrated against NEXT-BAR REGIME
#      PERSISTENCE (1 if regime[t+1]==regime[t]).  But the temporal stabiliser
#      (MIN_PERSIST + hysteresis + majority vote) forces persistence to ~90%
#      deterministically regardless of confidence.  Isotonic therefore learnt
#      a near-flat mapping that INFLATES low raw confidence back up to ~0.95,
#      which CONF_MAX_CAP then clipped at 0.97.  Reported 97% was a calibration
#      artefact, not a model belief.  Disabled until calibration target is
#      replaced with something accuracy-based (forward returns matching regime
#      expectation, NBER-window agreement, or HMM-only label agreement).
CALIB_ENABLED    = False
CALIB_FIT_FRAC   = 0.6

# v6: Attention hyperparameters
ATTN_N_HEADS     = 4      # number of self-attention heads
ATTN_DROPOUT     = 0.1    # attention dropout rate

# v6 : Transition detector (predicts regime changes 1-5 bars ahead).
# v10: TRANS_ENABLED added.  Last run reported F1=0.24, Precision=15%,
#      Recall=69% — i.e. 85% of "transition alerts" were false positives.
#      Each false positive redistributes probability mass away from the
#      current regime to alternatives (line ~2147 area), spuriously
#      inflating non-current regimes and worsening misclassification.
#      Disabled in the ensemble blend until retrained with a 1-bar-ahead
#      target and class-weighted loss (transitions are rare positives).
#      The detector is still TRAINED (so we can read trans_metrics in the
#      dashboard for diagnostics) but not consumed in the blend.
TRANS_ENABLED       = False
TRANS_DETECT_THRESH = 0.70  # probability threshold for transition alert
TRANS_LOOKAHEAD     = 5     # predict transitions within N bars
# input features: N_REGIMES Δprob + N_REGIMES current prob + 3 scalars
TRANS_INPUT_DIM     = 2 * N_REGIMES + 3

# v6: Weight optimisation (differential evolution + purged k-fold CV)
OPTIM_ENABLED     = False   # v7: disabled by default (slow with 120 params)
OPTIM_N_FOLDS     = 5       # purged k-fold CV folds
OPTIM_PURGE_GAP   = 252     # gap between train/test (bars)
OPTIM_MAX_ITER    = 15      # v7: halved again for speed when enabled
OPTIM_POP_SIZE    = 6       # v7: minimal DE population for speed
# v9.4: objective function for DE weight search.  Sharpe penalises
# volatility symmetrically -> strategy earned same Sharpe as B&H but
# -63% less total return.  Switching to Calmar (return / |MDD|) aligns
# the optimiser with the real goal: drawdown reduction.  Options:
#   "sharpe" — legacy (pre-v9.4)
#   "calmar" — annualised return / |MDD|, floored MDD=0.02
#   "blend"  — 0.5*sharpe + 0.5*calmar/5 (balanced)
OPTIM_OBJECTIVE   = "calmar"
OPTIM_MDD_FLOOR   = 0.02    # minimum |MDD| used in Calmar (prevents div blow-up)

# v6: Online HMM (warm-started incremental refits)
HMM_ONLINE_REFIT  = 63      # v7: quarterly refits (was monthly) — 3x faster
HMM_ONLINE_ITER   = 30      # fewer iterations for warm-start

# Transition matrix
TRANS_LOOKBACK   = 126
LAPLACE_ALPHA    = 1.0

# Temporal stabilisers
# v9 : tightened to reduce "stuck regime" lag during fast SPY moves.
# v10: tightened further.  Forensic check on Jan 2024 / Jan 2026 found that
#      v9 thresholds caused ~5-bar effective lag (3 bars majority-vote +
#      3-bar MIN_PERSIST + 7% hysteresis).  Once a regime locked in,
#      probabilities could decisively flip on day 1 yet the LABEL would
#      not follow until ~day 5, mis-labelling sharp transitions as the
#      previous calm/stress regime.  v10 cuts each component:
#        MAJORITY_WIN 3 -> 2 (still filters single-bar flickers)
#        MIN_PERSIST  3 -> 1 (allow next-bar switch when probs back it)
#        HYSTERESIS  0.07 -> 0.04 (smaller but still > argmax-tie noise)
HYSTERESIS_THRESH = 0.04
MIN_PERSIST       = 1
MAJORITY_WIN      = 2

# Risk conditioning
# v9: DD threshold 0.05 -> 0.035. SPY rarely sees >5% DD without an already-
# escalated event, so the Crisis gate was triggering only after the worst was
# over.  3.5% still requires shock_z > 2 to confirm.
RISKOFF_SHOCK_Z   = 2.0
RISKOFF_DD_THRESH = 0.035
# v9.4: Crisis PROMOTION thresholds (OR logic).  If any single extreme
# fires, upgrade to Crisis regardless of argmax.  Values match the tails
# of GFC / COVID / 2022: shock_z > 3.5 is a ~3.5 sigma absolute return,
# DD > 15% is deep-bear territory that Correction should hand off.
CRISIS_PROMOTE_SHOCK = 3.5
CRISIS_PROMOTE_DD    = 0.15
OVEREXT_BARS      = 60
OVEREXT_PENALTY   = 0.20
CHOP_SUPP_BARS    = 30

# Strategy allocation per regime  (probability-weighted sizing)
# Confidence multiplier: pos *= (0.5 + confidence), so:
#   50% conf → 1.0x,  80% conf → 1.3x,  30% conf → 0.8x
REGIME_ALLOC = {
    0:  1.00,    # Calm Trend       — full long
    1:  None,    # Volatile Trend   — DYNAMIC (see VOLTRD constants)
    2:  0.70,    # Low-Vol Range    — mostly long (slow grind, low risk)
    3:  0.20,    # High-Vol Churn   — de-risk (old Chop behaviour)
    4: -0.20,    # Correction       — light defense (moderate DD)
    5: -0.50,    # Crisis           — short (severe DD, flight to safety)
}
# Volatile Trend uses trend direction to scale exposure:
#   tdir_n >= 0.45 (uptrend)   → full long     (ride the momentum)
#   tdir_n <  0.45 (downtrend) → reduced long   (de-risk, don't short)
# Shorting VolTrend hurts Sharpe ~0.20 because it captures recovery rallies.
VOLTRD_UP    =  0.80     # allocation when volatile uptrend
VOLTRD_DOWN  =  0.50     # allocation when volatile downtrend (de-risk)
VOLTRD_THRESH = 0.45     # tdir_n threshold

# v9: Drawdown-control overlays on the raw regime signal.
#   Motivation: the raw signal goes full-long in Calm Trend, so crashes that
#   start mid-Calm bleed several % before the stabiliser can switch regimes.
#   Two standard, causal risk overlays are applied after the probability-
#   weighted signal and before strategy return:
#     1) Vol targeting  — scale position to target annualised vol
#     2) DD throttle    — de-risk when strategy is already underwater
#   Both overlays use only lagged data, so they do not introduce look-ahead.
VOL_TARGET_ANN      = 0.14    # target 14% annualised vol (SPY buy&hold ~18%)
VOL_WINDOW          = 20      # rolling-window days for realised vol
VOL_SCALE_CAP       = 1.00    # never lever above 1.0 (cash buffer at low vol)
DD_THROTTLE_START   = 0.03    # start throttling when strategy DD exceeds 3%
DD_THROTTLE_FLOOR   = 0.30    # never cut below 30% of target sizing
DD_THROTTLE_SLOPE   = 4.0     # scale = 1 - SLOPE * (DD - DD_THROTTLE_START)

# Walk-forward HMM
WF_MIN_TRAIN    = 500    # v7: K=6 HMM needs more bars for stable EM
                         #     (~2 yrs of daily data) — was 200 at K=4
WF_REFIT_EVERY  = 63     # refit every quarter (~3 months)
LSTM_REFIT_EVERY = 252   # LSTM refit every ~1 year (training is expensive)

# Dashboard
BG              = "#0a0a0a"
CARD_BG         = "#11141a"   # dark card surface; sits on BG, not white
REFRESH_SEC     = 60
DASH_PORT       = 8050
CACHE_TTL       = 3600     # 1-hour cache — HMM walk-forward is expensive
CROSS_CACHE_TTL = 3600     # 1-hour cache for TLT / GLD

# 14 normalised feature columns (order matters — matches _raw_scores)
# dd_n and corrgld_n removed after ablation testing (both hurt performance)
# yield_n, credit_n, claims_n added from FRED macro layer
# mom_n added to detect slow grinds that ADX misses
FEAT_COLS = [
    "vol_n", "trend_n", "autocorr_n", "shock_n",
    "volanom_n", "tdir_n",
    "vol63_n", "adx63_n", "athdd_n", "corrtlt_n",
    "yield_n", "credit_n", "claims_n",
    "mom_n",
    # v6: multi-scale
    "vol5_n", "vol252_n", "mom5_n", "mom252_n", "autocorr63_n",
    # v6: sentiment
    "vix_n", "vixterm_n",
]

# v9.3: DISTINCT feature set for the LSTM.  Previously the LSTM trained on
# the same 21 normalised features feeding the rules/HMM, so it largely
# memorised rule outputs and the "ensemble" was three correlated voters.
# This view uses RAW levels, log-vol, risk-adjusted returns, and ratios —
# features the LSTM can exploit sequentially that rules/HMM don't use
# directly.  Forces genuine ensemble diversity.
LSTM_FEAT_COLS = [
    "lstm_ret1",         # log_ret / realized_vol (daily risk-adjusted)
    "lstm_ret5",         # momentum_5 / (realized_vol * sqrt(5))
    "lstm_ret21",        # momentum / (realized_vol * sqrt(21))
    "lstm_ret252",       # momentum_252 / (realized_vol * sqrt(252))
    "lstm_vol_log",      # log(realized_vol)
    "lstm_vol_ratio_st", # log(realized_vol_5 / realized_vol_63)
    "lstm_vol_ratio_lt", # log(realized_vol_63 / realized_vol_252)
    "lstm_dd",           # ath_drawdown (raw, 0-1)
    "lstm_trend_dir",    # trend_dir (raw MA ratio, centred)
    "lstm_autocorr63",   # autocorr_63 (raw, [-1,1])
    "lstm_shock",        # shock_z clipped [-5, 5]
    "lstm_adx_signed",   # (adx/50) * sign(trend_dir)  — directional strength
    "lstm_vix_log",      # log(vix) / 3  (compressed)
    "lstm_vixterm_c",    # vix_term - 1.0  (centred at neutral)
]

# =====================================================================
# DIAGNOSTIC LOGGING
# =====================================================================
# Writes the same line to stdout (force-flushed so Windows terminals
# show it immediately) AND appends to a sidecar file next to the script
# so we can inspect it after the run regardless of terminal scrollback.
_DIAG_LOG_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "regime_diag.log")


def _diag_log(msg: str) -> None:
    print(msg, flush=True)
    try:
        with open(_DIAG_LOG_PATH, "a", encoding="utf-8") as fh:
            fh.write(f"{datetime.now().isoformat(timespec='seconds')} {msg}\n")
    except Exception:
        pass


# =====================================================================
# DATA FETCHING
# =====================================================================

_CACHE: dict = {}
_CROSS_CACHE: dict = {}
_FRED_CACHE: dict = {}
_SENTIMENT_CACHE: dict = {}

# Per-ticker lock prevents the Dash callback from launching multiple
# concurrent pipelines when the user refreshes the page mid-run.
# Without this, each browser refresh spawns another HMM+LSTM walk-forward
# that runs in parallel, compounding load until nothing finishes.
_PIPELINE_LOCKS: dict = {}
_LOCKS_GUARD = threading.Lock()


def _pipeline_lock(ticker: str) -> threading.Lock:
    with _LOCKS_GUARD:
        lk = _PIPELINE_LOCKS.get(ticker)
        if lk is None:
            lk = threading.Lock()
            _PIPELINE_LOCKS[ticker] = lk
        return lk


def fetch_market_data(ticker: str, date_from: str, date_to: str) -> pd.DataFrame:
    """Fetch daily OHLCV from Yahoo Finance via yfinance."""
    raw = yf.download(ticker, start=date_from, end=date_to,
                      auto_adjust=True, progress=False)
    if raw.empty:
        raise ValueError(f"No data from yfinance for {ticker}")

    # flatten MultiIndex columns (yfinance 0.2.x+)
    if isinstance(raw.columns, pd.MultiIndex):
        raw.columns = raw.columns.get_level_values(0)

    df = raw.reset_index()
    df.columns = [c.lower() for c in df.columns]
    df["date"] = pd.to_datetime(df["date"])
    if df["date"].dt.tz is not None:
        df["date"] = df["date"].dt.tz_localize(None)
    df = df[["date", "open", "high", "low", "close", "volume"]].copy()
    df = df.sort_values("date").reset_index(drop=True)
    print(f"[data] {ticker}  {len(df)} bars  "
          f"{df['date'].iloc[0].date()} -> {df['date'].iloc[-1].date()}")
    return df


def fetch_cross_assets() -> dict:
    """Fetch TLT and GLD daily data for cross-asset correlation features."""
    assets = {}
    now = time.time()
    for sym in ["TLT", "GLD"]:
        cached = _CROSS_CACHE.get(sym)
        if cached and (now - cached["ts"]) < CROSS_CACHE_TTL:
            assets[sym] = cached["df"]
            continue
        try:
            raw = fetch_market_data(sym, DATE_FROM, DATE_TO)
            d = raw[["date", "close"]].copy()
            d[f"ret_{sym.lower()}"] = np.log(
                d["close"] / d["close"].shift(1))
            d = d.rename(columns={"close": f"close_{sym.lower()}"})
            _CROSS_CACHE[sym] = {"df": d, "ts": now}
            assets[sym] = d
        except Exception as e:
            print(f"[warn] Could not fetch {sym}: {e}")
    return assets


def fetch_fred_data(date_from: str, date_to: str) -> pd.DataFrame | None:
    """Fetch macro indicators from FRED: yield curve, credit spread, claims."""
    now = time.time()
    cached = _FRED_CACHE.get("fred")
    if cached and (now - cached["ts"]) < CROSS_CACHE_TTL:
        return cached["df"]

    api_key = os.getenv("FRED_API_KEY")
    if not api_key:
        print("[warn] FRED_API_KEY not found in .env — macro features disabled")
        return None
    if not HAS_FRED:
        return None

    fred = Fred(api_key=api_key)
    series_map = {
        "yield_curve":   "T10Y2Y",   # 10-Year minus 2-Year Treasury spread
        "credit_spread": "BAA10Y",   # Moody's Baa minus 10-Year Treasury
        "init_claims":   "ICSA",     # Initial jobless claims (weekly)
    }

    frames = []
    for col, sid in series_map.items():
        try:
            s = fred.get_series(sid, observation_start=date_from,
                                observation_end=date_to)
            s = s.rename(col)
            frames.append(s)
            print(f"[fred] {sid} ({col})  {len(s)} observations")
        except Exception as e:
            print(f"[fred] Could not fetch {sid}: {e}")

    if not frames:
        return None

    df = pd.concat(frames, axis=1)
    df.index.name = "date"
    df = df.reset_index()
    df["date"] = pd.to_datetime(df["date"])
    if df["date"].dt.tz is not None:
        df["date"] = df["date"].dt.tz_localize(None)
    df = df.sort_values("date")
    _FRED_CACHE["fred"] = {"df": df, "ts": now}
    return df


def fetch_sentiment_data() -> dict:
    """Fetch VIX and VIX3M for sentiment / term-structure features (v6)."""
    now = time.time()
    cached = _SENTIMENT_CACHE.get("sentiment")
    if cached and (now - cached["ts"]) < CROSS_CACHE_TTL:
        return cached["data"]

    data = {}
    for sym, key in [("^VIX", "vix"), ("^VIX3M", "vix3m")]:
        try:
            raw = yf.download(sym, start=DATE_FROM, end=DATE_TO,
                              auto_adjust=True, progress=False)
            if raw.empty:
                continue
            if isinstance(raw.columns, pd.MultiIndex):
                raw.columns = raw.columns.get_level_values(0)
            d = raw.reset_index()
            d.columns = [c.lower() for c in d.columns]
            d["date"] = pd.to_datetime(d["date"])
            if d["date"].dt.tz is not None:
                d["date"] = d["date"].dt.tz_localize(None)
            d = d[["date", "close"]].rename(columns={"close": key})
            data[key] = d
            print(f"[sentiment] {sym} ({key})  {len(d)} bars")
        except Exception as e:
            print(f"[warn] Could not fetch {sym}: {e}")

    _SENTIMENT_CACHE["sentiment"] = {"data": data, "ts": now}
    return data


def get_data(ticker: str, force: bool = False) -> pd.DataFrame:
    """Full pipeline: fetch -> features -> normalise -> optimise -> backtest.

    Holds a per-ticker lock so that concurrent Dash callbacks (e.g. user
    refreshing the page mid-run) do not launch duplicate pipelines —
    second caller waits for the first to finish, then reads the cache.
    """
    ticker = ticker.upper().strip()
    lock = _pipeline_lock(ticker)
    with lock:
        now = time.time()
        cached = _CACHE.get(ticker)
        if cached and not force and (now - cached["ts"]) < CACHE_TTL:
            return cached["df"]

        return _run_full_pipeline(ticker)


def _run_full_pipeline(ticker: str) -> pd.DataFrame:
    now = time.time()
    df = fetch_market_data(ticker, DATE_FROM, DATE_TO)
    cross = fetch_cross_assets()
    fred = fetch_fred_data(DATE_FROM, DATE_TO)
    sentiment = fetch_sentiment_data()
    df = compute_features(df, cross, fred, sentiment)
    df = normalize_features(df)

    # v6: weight optimisation (before backtest so scores use optimal weights)
    if OPTIM_ENABLED and HAS_SCIPY:
        feat_matrix = df[FEAT_COLS].values
        daily_rets = df["close"].pct_change().values
        optimize_scoring_weights(feat_matrix, daily_rets)

    df = run_backtest(df)
    df = compute_performance(df)
    _CACHE[ticker] = {"df": df, "ts": now}
    return df


# =====================================================================
# FEATURE COMPUTATION  (16 raw features, 14 used after ablation)
# =====================================================================

def _wilder_smooth(arr: np.ndarray, period: int) -> np.ndarray:
    out = np.full(len(arr), np.nan)
    valid = np.where(~np.isnan(arr))[0]
    if len(valid) < period:
        return out
    start = valid[period - 1]
    out[start] = np.sum(arr[valid[:period]])
    alpha = 1.0 / period
    for i in range(start + 1, len(arr)):
        if not np.isnan(arr[i]) and not np.isnan(out[i - 1]):
            out[i] = out[i - 1] * (1 - alpha) + arr[i]
    return out


def compute_adx(high: np.ndarray, low: np.ndarray, close: np.ndarray,
                period: int = 14) -> np.ndarray:
    n = len(close)
    prev_h = np.empty(n); prev_h[0] = np.nan; prev_h[1:] = high[:-1]
    prev_l = np.empty(n); prev_l[0] = np.nan; prev_l[1:] = low[:-1]
    prev_c = np.empty(n); prev_c[0] = np.nan; prev_c[1:] = close[:-1]

    tr = np.maximum(high - low,
                    np.maximum(np.abs(high - prev_c), np.abs(low - prev_c)))
    tr[0] = np.nan
    up = high - prev_h
    dn = prev_l - low
    plus_dm  = np.where((up > dn) & (up > 0), up, 0.0)
    minus_dm = np.where((dn > up) & (dn > 0), dn, 0.0)
    plus_dm[0] = np.nan
    minus_dm[0] = np.nan

    s_tr  = _wilder_smooth(tr, period)
    s_pdm = _wilder_smooth(plus_dm, period)
    s_mdm = _wilder_smooth(minus_dm, period)

    with np.errstate(divide="ignore", invalid="ignore"):
        pdi = 100.0 * s_pdm / s_tr
        mdi = 100.0 * s_mdm / s_tr
        dx  = 100.0 * np.abs(pdi - mdi) / (pdi + mdi)
    dx = np.where(np.isfinite(dx), dx, np.nan)

    adx = np.full(n, np.nan)
    valid_dx = np.where(~np.isnan(dx))[0]
    if len(valid_dx) >= period:
        s = valid_dx[period - 1]
        adx[s] = np.nanmean(dx[valid_dx[:period]])
        for i in range(s + 1, n):
            if not np.isnan(dx[i]) and not np.isnan(adx[i - 1]):
                adx[i] = (adx[i - 1] * (period - 1) + dx[i]) / period
    return adx


def compute_features(df: pd.DataFrame, cross: dict,
                     fred: pd.DataFrame | None = None,
                     sentiment: dict | None = None) -> pd.DataFrame:
    df = df.copy()
    df["log_ret"] = np.log(df["close"] / df["close"].shift(1))

    # 1  Realised volatility  (v9.1: EWMA lambda=0.94, ~11-day half-life)
    #    Old shocks decay smoothly, eliminating the 252-bar "cliff" bias
    #    that made realised vol stay elevated long after the event ended.
    df["realized_vol"] = (df["log_ret"].ewm(alpha=1 - EWMA_LAM_MED,
                                            adjust=False).std()
                          * np.sqrt(ANNUALIZE))

    # 2  Trend strength  ADX  (14 bar)
    df["adx"] = compute_adx(df["high"].values, df["low"].values,
                             df["close"].values, ADX_PERIOD)

    # 3  Drawdown  (252 bar rolling max)
    dd_win = min(DD_WINDOW, max(63, len(df) // 4))
    rmax = df["close"].rolling(dd_win, min_periods=21).max()
    df["drawdown"] = (rmax - df["close"]) / rmax

    # 4  Return autocorrelation  (21 bar)
    df["autocorr"] = df["log_ret"].rolling(AUTOCORR_WINDOW).corr(
        df["log_ret"].shift(1))

    # 5  Shock intensity  (v9.1: EWMA baseline, ~34-day half-life)
    #    |return| vs its own EWMA mean/std.  Replacing the 63-bar rolling
    #    baseline means a return that's 3 sigma today stays 3-sigma-ish
    #    even if a cluster of shocks happened 60 bars ago (EWMA forgets).
    absret = df["log_ret"].abs()
    mu    = absret.ewm(alpha=1 - EWMA_LAM_LONG, adjust=False).mean()
    sigma = absret.ewm(alpha=1 - EWMA_LAM_LONG, adjust=False).std()
    df["shock_z"] = ((absret - mu) / sigma).replace(
        [np.inf, -np.inf], np.nan)

    # 6  Volume anomaly  (volume / 63-bar avg, capped 3x)
    vol_ma = df["volume"].rolling(VOLANOM_WINDOW, min_periods=10).mean()
    df["vol_anom"] = (df["volume"] / vol_ma).clip(upper=3.0)

    # 7  Trend direction  (short / long MA ratio, centred at 0)
    ma_s = df["close"].rolling(MA_SHORT, min_periods=5).mean()
    ma_l = df["close"].rolling(MA_LONG, min_periods=15).mean()
    df["trend_dir"] = (ma_s / ma_l) - 1.0

    # ── v3 features ──────────────────────────────────────────────

    # 8  Long-term volatility  (v9.1: EWMA lambda=0.98, ~34-day half-life)
    df["realized_vol_63"] = (df["log_ret"].ewm(alpha=1 - EWMA_LAM_LONG,
                                                adjust=False).std()
                             * np.sqrt(ANNUALIZE))

    # 9  Long-term ADX  (63 bar)
    df["adx_63"] = compute_adx(df["high"].values, df["low"].values,
                                df["close"].values, ADX_PERIOD_LONG)

    # 10  All-time-high drawdown
    ath = df["close"].cummax()
    df["ath_drawdown"] = (ath - df["close"]) / ath

    # 11  Cross-asset correlation with TLT
    if "TLT" in cross:
        df = df.merge(cross["TLT"][["date", "ret_tlt"]],
                      on="date", how="left")
        df["corr_tlt"] = (df["log_ret"]
                          .rolling(CORR_WINDOW, min_periods=21)
                          .corr(df["ret_tlt"]))
    else:
        df["ret_tlt"]  = np.nan
        df["corr_tlt"] = 0.0

    # 12  Cross-asset correlation with GLD
    if "GLD" in cross:
        df = df.merge(cross["GLD"][["date", "ret_gld"]],
                      on="date", how="left")
        df["corr_gld"] = (df["log_ret"]
                          .rolling(CORR_WINDOW, min_periods=21)
                          .corr(df["ret_gld"]))
    else:
        df["ret_gld"]  = np.nan
        df["corr_gld"] = 0.0

    # ── Momentum (cumulative return) ──────────────────────────
    # 16  Rolling 42-bar return — detects slow grinds that ADX misses
    #     ADX needs daily range expansion; momentum just needs price displacement
    df["momentum"] = df["close"].pct_change(MOM_WINDOW)

    # ── v6: Multi-scale features (v9.1: all EWMA now) ──────────
    # 17  Ultra-short volatility (lambda=0.85, ~4-day half-life)
    df["realized_vol_5"] = (df["log_ret"].ewm(alpha=1 - EWMA_LAM_SHORT,
                                               adjust=False).std()
                            * np.sqrt(ANNUALIZE))
    # 18  Structural volatility (lambda=0.995, ~138-day half-life)
    #     Slow-moving regime-level vol.  A crisis 200 bars ago still has
    #     weight ~0.995^200 = 37%, dropping to ~5% by bar 600 — smooth
    #     decay instead of cliff at bar 253.
    df["realized_vol_252"] = (df["log_ret"].ewm(alpha=1 - EWMA_LAM_YEARLY,
                                                 adjust=False).std()
                              * np.sqrt(ANNUALIZE))
    # 19  Ultra-short momentum (5 bar) — fast reversal detection
    df["momentum_5"] = df["close"].pct_change(MOM_SHORT)
    # 20  Yearly momentum (252 bar) — secular trend strength
    df["momentum_252"] = df["close"].pct_change(MOM_LONG)
    # 21  Long autocorrelation (63 bar) — persistent vs mean-reverting
    df["autocorr_63"] = df["log_ret"].rolling(AUTOCORR_LONG).corr(
        df["log_ret"].shift(1))

    # ── FRED macro features ─────────────────────────────────────
    # 13  Yield curve (T10Y2Y)  — 10-Year minus 2-Year spread
    # 14  Credit spread (BAA10Y) — Baa corporate minus 10-Year
    # 15  Initial claims (ICSA)  — weekly jobless claims
    if fred is not None:
        df = df.merge(fred, on="date", how="left")
        for col in ["yield_curve", "credit_spread", "init_claims"]:
            if col in df.columns:
                df[col] = df[col].ffill()  # forward-fill macro gaps
    if "yield_curve" not in df.columns:
        df["yield_curve"] = np.nan
    if "credit_spread" not in df.columns:
        df["credit_spread"] = np.nan
    if "init_claims" not in df.columns:
        df["init_claims"] = np.nan

    # ── v6: Sentiment features (VIX term structure) ─────────────
    if sentiment and "vix" in sentiment:
        df = df.merge(sentiment["vix"], on="date", how="left")
        df["vix"] = df["vix"].ffill()
    else:
        df["vix"] = np.nan
    if sentiment and "vix3m" in sentiment:
        df = df.merge(sentiment["vix3m"], on="date", how="left")
        df["vix3m"] = df["vix3m"].ffill()
        # Term structure: >1 = backwardation (fear), <1 = contango (calm)
        df["vix_term"] = (df["vix"] / df["vix3m"]).replace(
            [np.inf, -np.inf], np.nan)
    else:
        df["vix3m"] = np.nan
        df["vix_term"] = np.nan

    # ── v9.3: LSTM-native feature view ──────────────────────────
    # Distinct from the normalised FEAT_COLS eaten by rules/HMM.  All
    # scale-comparable (~[-5, 5]) so the LSTM can learn without the
    # domain priors baked into rolling min-max normalisation.
    vol_safe = df["realized_vol"].replace(0, np.nan)
    df["lstm_ret1"]   = (df["log_ret"] / vol_safe).clip(-8, 8)
    df["lstm_ret5"]   = (df["momentum_5"]
                         / (vol_safe * np.sqrt(5))).clip(-8, 8)
    df["lstm_ret21"]  = (df["momentum"]
                         / (vol_safe * np.sqrt(21))).clip(-8, 8)
    df["lstm_ret252"] = (df["momentum_252"]
                         / (vol_safe * np.sqrt(252))).clip(-8, 8)
    df["lstm_vol_log"]      = np.log(vol_safe.clip(lower=1e-4))
    df["lstm_vol_ratio_st"] = np.log(
        (df["realized_vol_5"].replace(0, np.nan)
         / df["realized_vol_63"].replace(0, np.nan)).clip(lower=0.1, upper=10))
    df["lstm_vol_ratio_lt"] = np.log(
        (df["realized_vol_63"].replace(0, np.nan)
         / df["realized_vol_252"].replace(0, np.nan)).clip(lower=0.1, upper=10))
    df["lstm_dd"]           = df["ath_drawdown"].clip(0, 1)
    df["lstm_trend_dir"]    = df["trend_dir"].clip(-0.5, 0.5)
    df["lstm_autocorr63"]   = df["autocorr_63"].fillna(0).clip(-1, 1)
    df["lstm_shock"]        = df["shock_z"].clip(-5, 5).fillna(0)
    trend_sign = np.sign(df["trend_dir"].fillna(0))
    df["lstm_adx_signed"]   = (df["adx"].fillna(15) / 50.0) * trend_sign
    vix_safe = df["vix"].replace(0, np.nan)
    df["lstm_vix_log"]      = (np.log(vix_safe.clip(lower=1e-2)) / 3.0).fillna(1.0)
    df["lstm_vixterm_c"]    = (df["vix_term"] - 1.0).fillna(0).clip(-0.5, 0.5)

    return df


def normalize_features(df: pd.DataFrame) -> pd.DataFrame:
    """Rolling min-max normalisation to [0, 1]."""
    df = df.copy()
    n_win = min(NORM_WINDOW, max(63, len(df) // 3))
    pairs = [
        ("realized_vol",    "vol_n"),
        ("adx",             "trend_n"),
        ("drawdown",        "dd_n"),
        ("autocorr",        "autocorr_n"),
        ("shock_z",         "shock_n"),
        ("vol_anom",        "volanom_n"),
        ("trend_dir",       "tdir_n"),
        ("realized_vol_63", "vol63_n"),
        ("adx_63",          "adx63_n"),
        ("ath_drawdown",    "athdd_n"),
        ("corr_tlt",        "corrtlt_n"),
        ("corr_gld",        "corrgld_n"),
        ("yield_curve",     "yield_n"),
        ("credit_spread",   "credit_n"),
        ("init_claims",     "claims_n"),
        ("momentum",        "mom_n"),
        # v6: multi-scale
        ("realized_vol_5",  "vol5_n"),
        ("realized_vol_252","vol252_n"),
        ("momentum_5",      "mom5_n"),
        ("momentum_252",    "mom252_n"),
        ("autocorr_63",     "autocorr63_n"),
        # v6: sentiment
        ("vix",             "vix_n"),
        ("vix_term",        "vixterm_n"),
    ]
    for raw, norm in pairs:
        rmin = df[raw].rolling(n_win, min_periods=21).min()
        rmax = df[raw].rolling(n_win, min_periods=21).max()
        span = (rmax - rmin).replace(0, np.nan)
        df[norm] = ((df[raw] - rmin) / span).clip(0, 1).fillna(0.5)
    return df


# =====================================================================
# SCORING  (21 features, pure function)
# =====================================================================

def _softmax(x: np.ndarray, temp: float = SOFTMAX_TEMP) -> np.ndarray:
    z = x * temp
    e = np.exp(z - z.max())
    return e / e.sum()


def _regime_basis(v, t, ac, s, va, td, v63, t63, athdd, ctl, yld, crd, clm,
                  mom, v5, v252, mom5, mom252, ac63, vix, vixterm):
    """Compute non-linear basis functions for each regime (N_REGIMES × 20).

    v9.2: directional ADX.  Raw ADX (t, t63) measures trend *strength*
    regardless of sign, so slow bear grinds (2022) scored high on Calm
    Trend's t-term even when td was negative.  We now use:
        t_up   = t * td         (strong trend AND upward)
        t_down = t * (1 - td)   (strong trend AND downward)
    in the templates where direction matters.  Volatile Trend still uses
    raw t (either direction is plausibly "directional move"), and the
    range regimes still use (1-t) (low trend strength either way).
    """
    dir_strength = abs(2 * td - 1)
    mom_up   = mom * td
    mom_abs  = abs(2 * mom - 1)
    mom5_up  = mom5 * td
    mom5_abs = abs(2 * mom5 - 1)
    mom252_abs = abs(2 * mom252 - 1)

    # v9.2: sign-aware trend strength
    t_up     = t   * td
    t_down   = t   * (1.0 - td)
    t63_up   = t63 * td
    t63_down = t63 * (1.0 - td)

    # v9.4: Crisis gates.  Previously Crisis used x**1.5 which SHRINKS
    # values in [0,1] (0.8**1.5 = 0.716), so Crisis scored LESS than
    # Correction for the same input -> Correction always won argmax ->
    # Crisis fired 0 bars in 5356.  Gates zero-out below the 50th pctl
    # of the normalized range and ramp linearly to 1 at the top, so
    # Crisis only scores when features are genuinely extreme.
    _g = lambda x: max(0.0, min(1.0, (x - 0.5) * 2.0))
    g_dd    = _g(athdd)
    g_s     = _g(s)
    g_v     = _g(v)
    g_v63   = _g(v63)
    g_v5    = _g(v5)
    g_crd   = _g(crd)
    g_vix   = _g(vix)
    g_vxt   = _g(vixterm)

    # v9.4: Correction hands off to Crisis above normalized DD=0.7.
    # Below 0.7: linear in athdd (unchanged).  Above 0.7: linearly
    # decays to 0 at athdd=1.  This vacates the extreme-DD region for
    # Crisis to win argmax.
    athdd_corr = athdd * max(0.0, min(1.0, 1.0 - (athdd - 0.7) / 0.3))

    return np.array([
        # 0  Calm Trend — low vol, strong UP-trend, positive momentum
        #    v9.2: t/t63 -> t_up/t63_up so down-trends stop scoring high
        [(1-v)**1.5, (1-v63)**1.5, t_up, t63_up, (1-athdd), (1-s),
         td, (1-va), ctl, yld, (1-crd), (1-clm), mom_up,
         (1-v5)**1.5, (1-v252), mom5_up, mom252, ac63, (1-vix), (1-vixterm)],

        # 1  Volatile Trend — high vol + strong directional move (either sign)
        [v, v63, t**1.5, t63**1.5, s, va, ac, dir_strength,
         (1-ctl), (1-yld), crd, clm, mom_abs,
         v5, v252, mom5_abs, mom252_abs, ac63, vix, vixterm],

        # 2  Low-Vol Range — ultra-low vol, flat trend, low shock, low mom
        [(1-v)**1.5, (1-v63)**1.5, (1-t)**1.5, (1-t63), (1-athdd), (1-s),
         (1-dir_strength), (1-va), ctl, yld, (1-crd), (1-clm), (1-mom_abs),
         (1-v5)**1.5, (1-v252), (1-mom5_abs), (1-mom252_abs), (1-ac63),
         (1-vix), (1-vixterm)],

        # 3  High-Vol Churn — elevated vol, sideways, high shock (was Chop)
        [v, v63, (1-t), (1-t63), s, va, (1-dir_strength), athdd,
         (1-ctl), yld, (1-crd), clm, (1-mom_abs),
         v5**1.5, v252, (1-mom5_abs), (1-mom252_abs), ac63,
         vix, vixterm],

        # 4  Correction — moderate DD, neg momentum, elevated vol+vix
        #    v9.2: dir_strength -> t_down so slow grinding bears qualify
        #    v9.4: athdd -> athdd_corr (tapers above normalized 0.7)
        [athdd_corr, s, v, v63, va, (1-td), ac, (1-ctl),
         t_down, (1-yld), crd, clm, (1-mom),
         v5, v252, (1-mom5), (1-mom252), (1-ac63), vix, vixterm],

        # 5  Crisis — extreme DD + shock + vol, flight to safety
        #    v9.4: gated features (0 below normalized 0.5, ramp to 1).
        #    Ensures Crisis only wins argmax when conditions are in the
        #    top half of their historical range.  Fixes v8-v9.3 bug where
        #    x**1.5 on [0,1] made Crisis score *less* than Correction.
        [g_dd, g_s, g_v, g_v63, va, (1-td), (1-ctl), ac,
         t_down, (1-yld), g_crd, clm, (1-mom),
         g_v5, v252, (1-mom5), (1-mom252), ac63, g_vix, g_vxt],
    ])


# Default hand-tuned weights: (N_REGIMES × 20 basis functions)
# Each row sums to ~1.0.  Optimiser (DE) refines these per ticker.
_DEFAULT_WEIGHTS = np.array([
    # 0 Calm Trend
    [0.13, 0.05, 0.12, 0.05, 0.05, 0.05, 0.09, 0.05,
     0.05, 0.03, 0.03, 0.03, 0.09,
     0.03, 0.02, 0.02, 0.03, 0.02, 0.03, 0.03],
    # 1 Volatile Trend
    [0.15, 0.05, 0.14, 0.05, 0.09, 0.07, 0.05, 0.05,
     0.04, 0.02, 0.03, 0.03, 0.08,
     0.03, 0.02, 0.02, 0.02, 0.01, 0.03, 0.02],
    # 2 Low-Vol Range  — ultra-calm grinds (based on old Chop profile)
    [0.20, 0.10, 0.10, 0.05, 0.06, 0.06, 0.07, 0.03,
     0.04, 0.02, 0.03, 0.02, 0.09,
     0.04, 0.02, 0.02, 0.02, 0.01, 0.01, 0.01],
    # 3 High-Vol Churn — sideways with noise (elevated vol peaks)
    [0.13, 0.08, 0.08, 0.05, 0.09, 0.10, 0.06, 0.05,
     0.03, 0.02, 0.03, 0.03, 0.08,
     0.06, 0.03, 0.02, 0.01, 0.01, 0.02, 0.02],
    # 4 Correction — moderate bearish (interpolates Vol Trend / Risk-Off)
    [0.08, 0.10, 0.08, 0.06, 0.06, 0.10, 0.06, 0.04,
     0.06, 0.03, 0.05, 0.03, 0.05,
     0.04, 0.02, 0.04, 0.02, 0.02, 0.03, 0.03],
    # 5 Crisis — extreme DD + shock (sharper old Risk-Off)
    [0.14, 0.18, 0.12, 0.07, 0.04, 0.08, 0.04, 0.02,
     0.02, 0.02, 0.05, 0.02, 0.04,
     0.04, 0.02, 0.02, 0.01, 0.01, 0.04, 0.02],
])

_ACTIVE_WEIGHTS = None   # replaced by optimiser when OPTIM_ENABLED


def _raw_scores(v, t, ac, s, va, td, v63, t63, athdd, ctl, yld, crd, clm,
                mom, v5, v252, mom5, mom252, ac63, vix, vixterm):
    """
    Score each regime from 21 normalised features.
    All inputs in [0, 1].  Returns array of shape (N_REGIMES,).
    """
    basis = _regime_basis(v, t, ac, s, va, td, v63, t63, athdd, ctl,
                          yld, crd, clm, mom, v5, v252, mom5, mom252,
                          ac63, vix, vixterm)
    W = _ACTIVE_WEIGHTS if _ACTIVE_WEIGHTS is not None else _DEFAULT_WEIGHTS
    return np.array([np.dot(W[r], basis[r]) for r in range(N_REGIMES)])


# =====================================================================
# TEMPORAL STABILISER  (reusable)
# =====================================================================

class Stabilizer:
    """Majority vote (on raw inputs) + hysteresis + minimum persistence.

    The majority vote uses *raw* (pre-stabilisation) labels so the
    feedback loop cannot create a "sticky trap" that prevents regime
    transitions even when probabilities strongly favour a new regime.
    """

    def __init__(self):
        self.current: int | None = None
        self.persist: int = 0
        self.history: list[int] = []      # stabilised output
        self._raw: list[int] = []          # raw input labels

    def step(self, label: int, probs: np.ndarray) -> int:
        # record raw label BEFORE any stabilisation
        self._raw.append(label)

        # majority vote on raw labels — smooths noise without feedback
        tail = self._raw[-MAJORITY_WIN:]
        if len(tail) >= MAJORITY_WIN:
            label = Counter(tail).most_common(1)[0][0]

        # hysteresis — require margin to switch
        if self.current is not None and label != self.current:
            if probs[label] - probs[self.current] <= HYSTERESIS_THRESH:
                label = self.current
        # minimum persistence
        if self.current is not None and label != self.current:
            if self.persist < MIN_PERSIST:
                label = self.current
        # bookkeeping
        if label != self.current:
            self.current = label
            self.persist = 1
        else:
            self.persist += 1
        self.history.append(label)
        return label


# =====================================================================
# RISK CONDITIONING  (applied to rule-based scores)
# =====================================================================

def _risk_condition(sc: np.ndarray, current: int | None, persist: int,
                    vol_n: float, vol_prev: float | None) -> np.ndarray:
    sc = sc.copy()
    if current is not None and persist > OVEREXT_BARS:
        sc[current] *= (1 - OVEREXT_PENALTY)
    # v7: suppress High-Vol Churn (3) when vol keeps rising — escalate
    # to Correction or Volatile Trend instead.
    if (current == 3 and persist > CHOP_SUPP_BARS
            and vol_prev is not None and vol_n > vol_prev):
        best = 1 if sc[1] >= sc[4] else 4
        sc[3] = min(sc[3], sc[best] - 0.01)
    return sc


def _riskoff_confirm(label: int, probs: np.ndarray,
                     shock_raw: float, dd_raw: float) -> int:
    # v9.4: PROMOTE to Crisis on tail events, even if argmax picked
    # something else.  OR logic: extreme shock *or* deep DD suffices.
    # Returns early so the demotion check below can't undo promotion.
    if label != 5 and (shock_raw > CRISIS_PROMOTE_SHOCK
                       or dd_raw > CRISIS_PROMOTE_DD):
        return 5
    # Crisis (5) requires shock + deep DD.  If unconfirmed, fall back to
    # best of {Correction, High-Vol Churn, others} via argmax w/o Crisis.
    if label == 5 and not (shock_raw > RISKOFF_SHOCK_Z
                           and dd_raw > RISKOFF_DD_THRESH):
        tmp = probs.copy(); tmp[5] = 0
        label = int(np.argmax(tmp))
    return label


# =====================================================================
# HMM  (fit, state mapping, causal forward probabilities)
# =====================================================================

def _hmm_forward_probs(model, X: np.ndarray) -> np.ndarray:
    """Causal (forward-only) state probabilities — no look-ahead bias."""
    n = X.shape[0]
    k = model.n_components
    log_emis  = model._compute_log_likelihood(X)  # (n, k)
    log_start = np.log(model.startprob_ + 1e-300)
    log_trans = np.log(model.transmat_ + 1e-300)

    probs = np.zeros((n, k))
    log_a = log_start + log_emis[0]
    log_a -= np.logaddexp.reduce(log_a)
    probs[0] = np.exp(log_a)

    for t in range(1, n):
        log_a_new = np.empty(k)
        for j in range(k):
            log_a_new[j] = np.logaddexp.reduce(log_a + log_trans[:, j])
        log_a_new += log_emis[t]
        log_a_new -= np.logaddexp.reduce(log_a_new)
        log_a = log_a_new
        probs[t] = np.exp(log_a)
    return probs


def _map_hmm_states(model, n_regimes: int = N_REGIMES) -> list[int]:
    """Map HMM states -> regime labels by centroid scoring.

    When n_states == n_regimes we use the permutation solver so every
    regime gets represented. When n_states > n_regimes (v7: K=6 -> 4)
    each state is assigned independently to its best-matching regime,
    with a tie-break that guarantees at least one state per regime."""
    means = model.means_
    n_states = means.shape[0]

    score_mat = np.zeros((n_states, n_regimes))
    for k in range(n_states):
        m = np.clip(np.nan_to_num(means[k], nan=0.5), 0, 1)
        score_mat[k] = np.nan_to_num(_raw_scores(*m), nan=0.25)

    if n_states == n_regimes:
        best_perm, best_total = None, -np.inf
        for perm in permutations(range(n_regimes)):
            total = sum(score_mat[k, perm[k]] for k in range(n_states))
            if total > best_total:
                best_total, best_perm = total, perm
        return list(best_perm) if best_perm else list(range(n_regimes))

    # many-to-one: each state picks its best regime
    mapping = [int(np.argmax(score_mat[k])) for k in range(n_states)]

    # guarantee every regime is represented: for any missing regime,
    # reassign the HMM state whose score for it is highest AND whose
    # current assignment is the most "crowded" (most duplicated).
    assigned = set(mapping)
    for r in range(n_regimes):
        if r in assigned:
            continue
        # candidates: states whose current regime has >=2 states AND
        # whose centroid-score for r is competitive
        from collections import Counter
        counts = Counter(mapping)
        cand = [(score_mat[k, r] - score_mat[k, mapping[k]], k)
                for k in range(n_states) if counts[mapping[k]] > 1]
        if not cand:
            continue
        cand.sort(reverse=True)        # smallest score loss first
        _, k_reassign = cand[0]
        mapping[k_reassign] = r
        assigned.add(r)
    return mapping


def fit_hmm(features: np.ndarray):
    """Fit GaussianHMM.  Returns (mapped_probs [N,4], model) or (None, None)."""
    if not HAS_HMM:
        return None, None

    valid_mask = ~np.isnan(features).any(axis=1)
    X = features[valid_mask]
    if len(X) < 200:
        print(f"[hmm] Not enough valid bars ({len(X)}) — need >= 200")
        return None, None

    try:
        # v10: full -> diag.  Full cov = 231 params/state @ d=21 (5x more
        # than diag's 21).  With ~5300 daily bars total and walk-forward
        # train slices as small as 500 bars, full cov was ~2.5 obs/param
        # per state in early refits — a textbook overfit zone.  Diag also
        # makes warm-start params transferable across refits without the
        # shape mismatch hack that prompted re-init of "mc" below.
        model = GaussianHMM(n_components=HMM_N_STATES,
                             covariance_type="diag",
                             n_iter=HMM_N_ITER,
                             random_state=42)
        model.fit(X)
        print(f"[hmm] Fitted  converged={model.monitor_.converged}  "
              f"iters={model.monitor_.iter}")
    except Exception as e:
        print(f"[hmm] Fit failed: {e}")
        return None, None

    # state mapping
    mapping = _map_hmm_states(model)
    print(f"[hmm] State mapping: "
          + ", ".join(f"H{k}->{REGIME_NAMES[mapping[k]]}"
                      for k in range(HMM_N_STATES)))

    # causal forward probabilities
    raw_probs = _hmm_forward_probs(model, X)

    # remap: sum probs of HMM states sharing a regime (many-to-one safe)
    mapped = np.zeros((raw_probs.shape[0], N_REGIMES))
    for hmm_state, regime in enumerate(mapping):
        mapped[:, regime] += raw_probs[:, hmm_state]

    # expand to full array (NaN rows get uniform 1/N)
    full = np.full((len(features), N_REGIMES), 1.0 / N_REGIMES)
    full[valid_mask] = mapped
    return full, model


# =====================================================================
# LSTM  (temporal sequence model for regime classification)
# =====================================================================

if HAS_LSTM:
    class RegimeLSTM(nn.Module):
        """2-layer LSTM + Multi-Head Self-Attention for regime classification.

        v6: added self-attention after the LSTM layers.  The LSTM extracts
        temporal features from the 30-bar window, then self-attention
        weights WHICH of those bars matter most (a shock 20 days ago can
        outweigh yesterday's quiet bar).  Residual connection + LayerNorm
        stabilise training.
        """

        def __init__(self, input_dim: int, hidden1: int = LSTM_HIDDEN1,
                     hidden2: int = LSTM_HIDDEN2, n_classes: int = N_REGIMES,
                     n_heads: int = ATTN_N_HEADS):
            super().__init__()
            self.lstm1 = nn.LSTM(input_dim, hidden1, batch_first=True)
            self.drop1 = nn.Dropout(0.2)
            self.lstm2 = nn.LSTM(hidden1, hidden2, batch_first=True)
            self.drop2 = nn.Dropout(0.2)
            # v6: multi-head self-attention over the LSTM sequence output
            self.attn = nn.MultiheadAttention(
                hidden2, n_heads, dropout=ATTN_DROPOUT, batch_first=True)
            self.norm = nn.LayerNorm(hidden2)
            self.fc = nn.Linear(hidden2, n_classes)

        def forward(self, x):
            out, _ = self.lstm1(x)
            out = self.drop1(out)
            out, _ = self.lstm2(out)
            out = self.drop2(out)
            # Self-attention: let each bar attend to every other bar
            attn_out, _ = self.attn(out, out, out)
            out = self.norm(out + attn_out)   # residual + layer norm
            out = self.fc(out[:, -1, :])      # classify from last timestep
            return out

    class TransitionDetector(nn.Module):
        """Small MLP that predicts regime transitions 1-5 bars ahead (v6).

        Input features (11):
          - Δprob[0..3]     (4) change in regime probs over last 3 bars
          - prob[0..3]      (4) current regime probabilities
          - confidence_gap  (1) max prob minus second-max
          - Δvol            (1) change in vol_n over last 5 bars
          - persistence     (1) days in current regime / 100 (capped at 1)

        Output: P(transition in next TRANS_LOOKAHEAD bars)
        """

        def __init__(self, input_dim: int = TRANS_INPUT_DIM,
                     hidden: int = 32):
            super().__init__()
            self.net = nn.Sequential(
                nn.Linear(input_dim, hidden),
                nn.ReLU(),
                nn.Dropout(0.2),
                nn.Linear(hidden, hidden // 2),
                nn.ReLU(),
                nn.Linear(hidden // 2, 1),
                nn.Sigmoid(),
            )

        def forward(self, x):
            return self.net(x)


def _build_sequences(features: np.ndarray, soft_labels: np.ndarray,
                     seq_len: int = LSTM_SEQ_LEN
                     ) -> tuple[np.ndarray, np.ndarray]:
    """Build (X, Y) sequences for LSTM training with soft targets.

    soft_labels: (n, N_REGIMES) target distribution per bar.
    For bar t, X[t] = features[t-seq_len+1 : t+1], Y[t] = soft_labels[t].
    Rows with any NaN in the window or target are skipped.
    """
    n = len(features)
    n_classes = soft_labels.shape[1]
    X_list, Y_list = [], []
    for t in range(seq_len - 1, n):
        window = features[t - seq_len + 1: t + 1]
        tgt = soft_labels[t]
        if np.isnan(window).any() or np.isnan(tgt).any():
            continue
        X_list.append(window)
        Y_list.append(tgt)
    if not X_list:
        return (np.empty((0, seq_len, features.shape[1])),
                np.empty((0, n_classes)))
    return np.array(X_list), np.array(Y_list)


def _compute_forward_regime(close: np.ndarray,
                            lookahead: int = LSTM_FORWARD_WIN) -> np.ndarray:
    """Derive a forward-window regime label from realised future returns,
    volatility, and drawdown.  Returns NaN for the last `lookahead` bars
    (no forward window available) and for any bar with NaN closes ahead.

    This is a TRAINING-time teacher signal for the LSTM, not an inference
    quantity.  At inference the LSTM consumes only past features and emits
    a forecast; the label is never re-derived live.

    Why thresholds and not rolling percentiles: rolling percentiles drift
    with the regime ("18% vol = high in 2017, low in 2022"), which is
    exactly the bias that broke the rule-based scoring.  Absolute thresholds
    keep label semantics constant across history.
    """
    n = len(close)
    fwd = np.full(n, np.nan)
    close = np.asarray(close, dtype=float)
    log_close = np.log(np.where(close > 0, close, np.nan))
    log_ret = np.diff(log_close, prepend=np.nan)

    for t in range(n - lookahead):
        win_close = close[t: t + lookahead + 1]
        if np.isnan(win_close).any() or win_close[0] <= 0:
            continue
        ret = win_close[-1] / win_close[0] - 1.0
        win_lr = log_ret[t + 1: t + 1 + lookahead]
        if np.all(np.isnan(win_lr)):
            continue
        vol = np.nanstd(win_lr) * np.sqrt(252)
        rmax = np.maximum.accumulate(win_close).max()
        dd = (rmax - win_close.min()) / max(rmax, 1e-9)

        if dd > FWD_DD_CRISIS or vol > FWD_VOL_HIGH:
            fwd[t] = 5      # Crisis
        elif dd > FWD_DD_CORR and ret < -0.02:
            fwd[t] = 4      # Correction
        elif vol > FWD_VOL_MED and abs(ret) > FWD_RET_TREND:
            fwd[t] = 1      # Volatile Trend
        elif vol > FWD_VOL_MED:
            fwd[t] = 3      # High-Vol Churn
        elif vol < FWD_VOL_LOW and abs(ret) < 0.005:
            fwd[t] = 2      # Low-Vol Range
        else:
            fwd[t] = 0      # Calm Trend
    return fwd


def _build_forward_targets(forward_regime: np.ndarray) -> np.ndarray:
    """One-hot encode the forward regime sequence into LSTM targets."""
    n = len(forward_regime)
    targets = np.full((n, N_REGIMES), np.nan)
    for i in range(n):
        r = forward_regime[i]
        if np.isnan(r):
            continue
        oh = np.zeros(N_REGIMES)
        oh[int(r)] = 1.0
        targets[i] = oh
    return targets


def _build_soft_labels(rule_regimes_slice: np.ndarray,
                       hmm_probs_slice: np.ndarray,
                       has_hmm: bool,
                       alpha: float = SOFT_ALPHA_HMM) -> np.ndarray:
    """Blend HMM posteriors with one-hot rule labels for LSTM training.

    Where HMM is active and not at the uniform fallback, target is
    alpha * HMM_posterior + (1 - alpha) * onehot(rule).  Elsewhere the
    target is the one-hot rule label (so soft CE degenerates to standard
    hard-label CE there).  Rows with NaN rule label become NaN and are
    skipped by _build_sequences.
    """
    n = len(rule_regimes_slice)
    soft = np.full((n, N_REGIMES), np.nan)
    uniform = 1.0 / N_REGIMES
    for i in range(n):
        r = rule_regimes_slice[i]
        if np.isnan(r):
            continue
        rule_oh = np.zeros(N_REGIMES)
        rule_oh[int(r)] = 1.0
        hmm_vec = hmm_probs_slice[i]
        if (has_hmm
                and not np.allclose(hmm_vec, uniform, atol=0.01)
                and np.all(np.isfinite(hmm_vec))):
            soft[i] = alpha * hmm_vec + (1.0 - alpha) * rule_oh
        else:
            soft[i] = rule_oh
    return soft


def _soft_cross_entropy(logits: "torch.Tensor",
                        targets: "torch.Tensor") -> "torch.Tensor":
    """CE against a soft target distribution: -sum(y * log_softmax(logits))."""
    log_p = torch.log_softmax(logits, dim=1)
    return -(targets * log_p).sum(dim=1).mean()


def _train_lstm(X: np.ndarray, Y_soft: np.ndarray,
                input_dim: int) -> "RegimeLSTM | None":
    """Train a RegimeLSTM with early stopping.  Targets are soft
    distributions over N_REGIMES (HMM-blended when available)."""
    if not HAS_LSTM or len(X) < LSTM_BATCH * 2:
        return None

    device = torch.device("cpu")
    model = RegimeLSTM(input_dim).to(device)
    optimizer = torch.optim.Adam(model.parameters(), lr=LSTM_LR)

    # 90/10 train/val split for early stopping
    n = len(X)
    n_val = max(LSTM_BATCH, int(n * 0.10))
    n_train = n - n_val

    X_t = torch.FloatTensor(X[:n_train]).to(device)
    Y_t = torch.FloatTensor(Y_soft[:n_train]).to(device)
    X_v = torch.FloatTensor(X[n_train:]).to(device)
    Y_v = torch.FloatTensor(Y_soft[n_train:]).to(device)

    train_ds = TensorDataset(X_t, Y_t)
    train_dl = DataLoader(train_ds, batch_size=LSTM_BATCH, shuffle=True)

    best_val_loss = float("inf")
    patience_counter = 0
    best_state = None

    for epoch in range(LSTM_EPOCHS):
        model.train()
        for xb, yb in train_dl:
            optimizer.zero_grad()
            loss = _soft_cross_entropy(model(xb), yb)
            loss.backward()
            optimizer.step()

        model.eval()
        with torch.no_grad():
            val_loss = _soft_cross_entropy(model(X_v), Y_v).item()

        if val_loss < best_val_loss - 1e-4:
            best_val_loss = val_loss
            patience_counter = 0
            best_state = {k: v.clone() for k, v in model.state_dict().items()}
        else:
            patience_counter += 1
            if patience_counter >= LSTM_PATIENCE:
                break

    if best_state is not None:
        model.load_state_dict(best_state)
    model.eval()
    return model


def _lstm_predict(model, features: np.ndarray,
                  seq_len: int = LSTM_SEQ_LEN,
                  start_idx: int | None = None) -> np.ndarray:
    """Run LSTM inference on a feature matrix, returning (n, N_REGIMES) probs.

    Bars before seq_len get uniform 1/N.  Fully causal — each bar
    only uses features up to and including that bar.

    If *start_idx* is given, only predict bars [start_idx, n) — earlier
    bars keep uniform 1/N.  This avoids redundant work in walk-forward.
    """
    n = len(features)
    probs = np.full((n, N_REGIMES), 1.0 / N_REGIMES)
    if not HAS_LSTM or model is None:
        return probs

    device = next(model.parameters()).device
    model.eval()

    first = max(seq_len - 1, start_idx or 0)
    if first >= n:
        return probs

    # ── Collect valid windows into a batch ─────────────────────
    indices = []
    windows = []
    for t in range(first, n):
        window = features[t - seq_len + 1: t + 1]
        if np.isnan(window).any():
            continue
        indices.append(t)
        windows.append(window)

    if not windows:
        return probs

    # ── Batched forward pass ───────────────────────────────────
    batch = torch.FloatTensor(np.array(windows)).to(device)   # (B, seq, F)
    INFER_BATCH = 2048
    with torch.no_grad():
        all_p = []
        for b0 in range(0, len(batch), INFER_BATCH):
            logits = model(batch[b0: b0 + INFER_BATCH])
            all_p.append(torch.softmax(logits, dim=1).cpu().numpy())
        all_p = np.concatenate(all_p, axis=0)

    for k, t in enumerate(indices):
        probs[t] = all_p[k]

    return probs


# =====================================================================
# TRANSITION DETECTOR  (v6 — predicts regime changes ahead of time)
# =====================================================================

def _build_transition_data(rule_probs: np.ndarray,
                           rule_regimes: np.ndarray,
                           vol_n: np.ndarray,
                           n: int,
                           target_regimes: np.ndarray | None = None,
                           ) -> tuple[np.ndarray, np.ndarray]:
    """Build training data for the transition detector.

    v8: the *target* regime sequence can be supplied separately from
    the *feature* regime sequence.  Supplying HMM-argmax as targets
    breaks the old rules→rules circular loop — the detector learns
    to predict latent (HMM) state changes from rule-based features.
    If target_regimes is None, falls back to rule_regimes (old behaviour).
    """
    if target_regimes is None:
        target_regimes = rule_regimes

    features, labels = [], []
    for i in range(5, n - TRANS_LOOKAHEAD):
        if np.isnan(rule_regimes[i]) or np.isnan(target_regimes[i]):
            continue

        prob_change = rule_probs[i] - rule_probs[max(0, i - 3)]
        current_probs = rule_probs[i]
        sorted_p = np.sort(current_probs)[::-1]
        conf_gap = sorted_p[0] - sorted_p[1]

        v_now = vol_n[i] if not np.isnan(vol_n[i]) else 0.5
        v_prev = vol_n[max(0, i - 5)]
        vol_change = (v_now - v_prev) if not np.isnan(v_prev) else 0.0

        # persistence measured on the TARGET sequence (what we predict)
        persist = 0
        cur_tgt = int(target_regimes[i])
        for j in range(i, max(i - 101, -1), -1):
            tj = target_regimes[j]
            if not np.isnan(tj) and int(tj) == cur_tgt:
                persist += 1
            else:
                break

        feat = np.concatenate([
            prob_change,                 # N_REGIMES
            current_probs,               # N_REGIMES
            [conf_gap],                  # 1
            [vol_change],                # 1
            [min(persist / 100., 1.0)],  # 1
        ])  # total = 2 * N_REGIMES + 3

        # label: target regime changes within next TRANS_LOOKAHEAD bars
        future = target_regimes[i + 1: i + 1 + TRANS_LOOKAHEAD]
        transition = any(not np.isnan(f) and int(f) != cur_tgt for f in future)
        features.append(feat)
        labels.append(float(transition))

    if not features:
        return np.empty((0, TRANS_INPUT_DIM)), np.empty(0)
    return np.array(features), np.array(labels)


def _train_transition_detector(features: np.ndarray,
                               labels: np.ndarray
                               ) -> tuple["TransitionDetector | None", dict]:
    """Train transition-detector MLP with chronological 80/20 OOS split.

    Returns (model, metrics_dict).  The test set is the final 20 % of
    samples — i.e. strictly later in time than anything seen in training,
    so precision/recall reflect true out-of-sample behaviour.  We report
    precision@{0.5, 0.7} on that held-out tail along with recall, F1,
    positive-class prevalence, and the count of positive predictions.
    """
    if not HAS_LSTM or len(features) < 200:
        return None, {}

    # chronological split — test is strictly future relative to train
    n_total = len(features)
    n_train_all = int(n_total * 0.80)
    X_train_all = features[:n_train_all]
    y_train_all = labels[:n_train_all]
    X_test = features[n_train_all:]
    y_test = labels[n_train_all:]

    pos_idx = np.where(y_train_all == 1)[0]
    neg_idx = np.where(y_train_all == 0)[0]
    if len(pos_idx) == 0 or len(neg_idx) == 0:
        return None, {}

    # under-sample majority class inside the training slice only
    n_samples = min(len(pos_idx), len(neg_idx))
    rng = np.random.RandomState(42)
    idx = np.sort(np.concatenate([
        rng.choice(pos_idx, n_samples, replace=False),
        rng.choice(neg_idx, n_samples, replace=False),
    ]))

    X = torch.FloatTensor(X_train_all[idx])
    y = torch.FloatTensor(y_train_all[idx]).unsqueeze(1)

    model = TransitionDetector(input_dim=features.shape[1])
    opt = torch.optim.Adam(model.parameters(), lr=1e-3)
    criterion = nn.BCELoss()

    ds = TensorDataset(X, y)
    dl = DataLoader(ds, batch_size=64, shuffle=True)

    model.train()
    for _ in range(15):
        for xb, yb in dl:
            opt.zero_grad()
            criterion(model(xb), yb).backward()
            opt.step()

    model.eval()

    # ── OOS evaluation ────────────────────────────────────────
    metrics: dict = {
        "n_train_bal": 2 * n_samples,
        "n_test": int(len(y_test)),
        "n_test_pos": int(y_test.sum()),
        "test_prevalence": float(y_test.mean()) if len(y_test) else 0.0,
    }

    if len(X_test) > 0:
        with torch.no_grad():
            probs_test = model(torch.FloatTensor(X_test)).squeeze(1).numpy()
        for thr in (0.5, 0.7):
            preds = (probs_test >= thr).astype(int)
            y_int = y_test.astype(int)
            tp = int(((preds == 1) & (y_int == 1)).sum())
            fp = int(((preds == 1) & (y_int == 0)).sum())
            fn = int(((preds == 0) & (y_int == 1)).sum())
            prec = tp / (tp + fp) if (tp + fp) else 0.0
            rec  = tp / (tp + fn) if (tp + fn) else 0.0
            f1   = 2 * prec * rec / (prec + rec) if (prec + rec) else 0.0
            metrics[f"thr_{thr}"] = {
                "precision": prec, "recall": rec, "f1": f1,
                "n_pos_pred": int(preds.sum()), "tp": tp, "fp": fp, "fn": fn,
            }

    print(f"[trans] Detector: train={metrics['n_train_bal']} balanced, "
          f"test={metrics['n_test']} ({metrics['test_prevalence']:.1%} "
          f"pos prevalence)")
    if "thr_0.5" in metrics:
        m5 = metrics["thr_0.5"]; m7 = metrics["thr_0.7"]
        print(f"[trans]   @0.5: prec={m5['precision']:.1%} "
              f"rec={m5['recall']:.1%} F1={m5['f1']:.3f}  "
              f"|  @0.7: prec={m7['precision']:.1%} "
              f"rec={m7['recall']:.1%} F1={m7['f1']:.3f}")
    return model, metrics


# =====================================================================
# WEIGHT OPTIMISATION  (v6 — differential evolution + purged k-fold CV)
# =====================================================================

def _purged_kfold(n: int, k: int = 5, purge: int = 252):
    """Generate purged k-fold indices for time-series cross-validation."""
    fold_size = n // k
    folds = []
    for i in range(k):
        test_start = i * fold_size
        test_end = min((i + 1) * fold_size, n)
        test_idx = list(range(test_start, test_end))
        # purge gap around test set to prevent feature leakage
        train_idx = (list(range(0, max(0, test_start - purge)))
                     + list(range(min(n, test_end + purge), n)))
        if train_idx and test_idx:
            folds.append((np.array(train_idx), np.array(test_idx)))
    return folds


def optimize_scoring_weights(feat_matrix: np.ndarray,
                             daily_rets: np.ndarray) -> np.ndarray | None:
    """Find optimal scoring weights via DE + purged k-fold CV.

    Optimises the (N_REGIMES × 20) weight matrix.  Softmax parameterisation
    keeps weights positive with row-sum = 1.  Objective: mean CV Sharpe.
    """
    global _ACTIVE_WEIGHTS

    if not HAS_SCIPY:
        return None

    valid_mask = ~np.isnan(feat_matrix).any(axis=1) & ~np.isnan(daily_rets)
    valid_idx = np.where(valid_mask)[0]
    n_valid = len(valid_idx)

    if n_valid < 500:
        print("[optim] Not enough data for weight optimisation")
        return None

    # precompute basis functions for all valid bars — vectorised
    n_basis = 20
    basis_all = np.zeros((n_valid, N_REGIMES, n_basis))
    for i, idx in enumerate(valid_idx):
        basis_all[i] = _regime_basis(*feat_matrix[idx])

    valid_rets = daily_rets[valid_idx]
    folds = _purged_kfold(n_valid, OPTIM_N_FOLDS, OPTIM_PURGE_GAP)
    if not folds:
        return None

    # VolTrend (1) uses dynamic sizing — approximate by VOLTRD_UP in optim
    allocs = np.array([
        REGIME_ALLOC[0], VOLTRD_UP,
        REGIME_ALLOC[2], REGIME_ALLOC[3],
        REGIME_ALLOC[4], REGIME_ALLOC[5],
    ])

    def _fold_sharpe(rets: np.ndarray) -> float:
        std = rets.std()
        return float(rets.mean() / std * np.sqrt(252)) if std > 0 else 0.0

    def _fold_calmar(rets: np.ndarray) -> float:
        if rets.std() == 0:
            return 0.0
        ann_ret = float(rets.mean() * 252)
        cum = np.cumprod(1.0 + rets)
        peak = np.maximum.accumulate(cum)
        mdd_abs = max(abs(float(((cum - peak) / peak).min())),
                      OPTIM_MDD_FLOOR)
        return ann_ret / mdd_abs

    def objective(w_flat):
        W = w_flat.reshape(N_REGIMES, n_basis)
        W = np.exp(W)
        W = W / W.sum(axis=1, keepdims=True)

        scores_list = []
        for _, test_idx in folds:
            tb = basis_all[test_idx]                       # (T, N, 20)
            scores = np.einsum('nrb,rb->nr', tb, W)        # (T, N)
            z = scores * SOFTMAX_TEMP
            z -= z.max(axis=1, keepdims=True)
            e = np.exp(z)
            probs = e / e.sum(axis=1, keepdims=True)
            sig = np.clip((probs * allocs).sum(axis=1), -1., 1.)
            sig = np.roll(sig, 1); sig[0] = 0.
            rets = sig * valid_rets[test_idx]
            # v9.4: dispatch on OPTIM_OBJECTIVE
            if OPTIM_OBJECTIVE == "sharpe":
                scores_list.append(_fold_sharpe(rets))
            elif OPTIM_OBJECTIVE == "blend":
                scores_list.append(0.5 * _fold_sharpe(rets)
                                   + 0.5 * _fold_calmar(rets) / 5.0)
            else:  # "calmar" default
                scores_list.append(_fold_calmar(rets))
        return -float(np.mean(scores_list)) if scores_list else 0.

    n_params = N_REGIMES * n_basis
    bounds = [(-5., 5.)] * n_params
    x0 = np.log(_DEFAULT_WEIGHTS + 1e-10).flatten()

    print(f"[optim] Starting: {n_params} params, {len(folds)} folds, "
          f"{n_valid} valid bars, objective={OPTIM_OBJECTIVE} ...",
          flush=True)

    _optim_gen = [0]
    def _cb(xk, convergence):
        _optim_gen[0] += 1
        if _optim_gen[0] % 10 == 0:
            print(f"  [optim] gen {_optim_gen[0]}/{OPTIM_MAX_ITER} "
                  f"conv={convergence:.4f}", flush=True)

    result = _de(objective, bounds, maxiter=OPTIM_MAX_ITER,
                 popsize=OPTIM_POP_SIZE, seed=42, x0=x0,
                 tol=1e-6, disp=False, callback=_cb)

    W_opt = result.x.reshape(N_REGIMES, n_basis)
    W_opt = np.exp(W_opt)
    W_opt = W_opt / W_opt.sum(axis=1, keepdims=True)
    _ACTIVE_WEIGHTS = W_opt

    default_s = -objective(x0)
    opt_s = -result.fun
    print(f"[optim] Done: default Sharpe {default_s:.3f} -> "
          f"optimised {opt_s:.3f} ({opt_s - default_s:+.3f})", flush=True)
    return W_opt


# =====================================================================
# DURATION MODELLING  (empirical survival)
# =====================================================================

def _ece_brier(confs: np.ndarray, correct: np.ndarray,
               n_bins: int = 10) -> tuple[float, float, list]:
    """Expected calibration error + Brier + per-bin breakdown.

    ECE:   weighted average gap between mean predicted probability
           and empirical accuracy, bucketed into n_bins equal-width
           bins on [0, 1].  Lower is better.
    Brier: mean squared error between predicted prob and outcome.
    """
    if len(confs) == 0:
        return float("nan"), float("nan"), []
    bins = np.linspace(0.0, 1.0, n_bins + 1)
    ece = 0.0
    total = len(confs)
    bin_rows = []
    for b in range(n_bins):
        lo, hi = bins[b], bins[b + 1]
        mask = ((confs >= lo) & (confs < hi)) if b < n_bins - 1 \
            else ((confs >= lo) & (confs <= hi))
        nb = int(mask.sum())
        if nb == 0:
            bin_rows.append((lo, hi, 0, np.nan, np.nan))
            continue
        mc = float(confs[mask].mean())
        ma = float(correct[mask].mean())
        bin_rows.append((lo, hi, nb, mc, ma))
        ece += (nb / total) * abs(mc - ma)
    brier = float(((confs - correct) ** 2).mean())
    return float(ece), brier, bin_rows


def _apply_calibration(df: pd.DataFrame, ens_probs: np.ndarray,
                       ens_regimes: np.ndarray, start_idx: int) -> None:
    """Fit isotonic regression on OOS 1-bar persistence and apply it.

    Interpretation: when the model reports X% confidence, the regime
    should persist for the next bar X% of the time.  We fit isotonic
    on the first CALIB_FIT_FRAC of OOS bars and evaluate on the tail;
    both raw and calibrated ECE/Brier are stored in df.attrs.

    The calibrated max-prob overwrites df['confidence']; the other
    probs are rescaled proportionally so each row still sums to 1.
    """
    n = len(ens_regimes)
    pairs_t, pairs_conf, pairs_correct = [], [], []
    for t in range(start_idx, n - 1):
        if np.isnan(ens_regimes[t]) or np.isnan(ens_regimes[t + 1]):
            continue
        r = int(ens_regimes[t])
        pairs_t.append(t)
        pairs_conf.append(float(ens_probs[t, r]))
        pairs_correct.append(1.0 if int(ens_regimes[t + 1]) == r else 0.0)

    pairs_t       = np.array(pairs_t, dtype=int)
    pairs_conf    = np.array(pairs_conf)
    pairs_correct = np.array(pairs_correct)

    metrics: dict = {"n_pairs": int(len(pairs_conf))}
    df.attrs["confidence_raw_col"] = True

    # keep raw confidence alongside calibrated one
    df["confidence_raw"] = df["confidence"].copy()

    if len(pairs_conf) < 200:
        metrics["note"] = "too few OOS pairs — no calibration applied"
        df.attrs["calibration"] = metrics
        print(f"[calib] Skipped ({metrics['n_pairs']} pairs, need >= 200)")
        return

    # chronological split — fit on first fraction, eval on the tail
    split = int(len(pairs_conf) * CALIB_FIT_FRAC)
    conf_fit,  corr_fit  = pairs_conf[:split],  pairs_correct[:split]
    conf_test, corr_test = pairs_conf[split:],  pairs_correct[split:]

    raw_ece_fit,  raw_brier_fit,  _ = _ece_brier(conf_fit,  corr_fit)
    raw_ece_test, raw_brier_test, bins_raw = _ece_brier(conf_test, corr_test)

    try:
        iso = IsotonicRegression(out_of_bounds="clip", y_min=0.0, y_max=1.0)
        iso.fit(conf_fit, corr_fit)
    except Exception as e:
        metrics["note"] = f"isotonic fit failed: {e}"
        df.attrs["calibration"] = metrics
        print(f"[calib] Isotonic fit failed: {e}")
        return

    cal_test = iso.predict(conf_test)
    cal_ece_test, cal_brier_test, bins_cal = _ece_brier(cal_test, corr_test)

    # ── rewrite df["confidence"] with calibrated max-prob ────
    #    v10: only rewrite bars that are TRUE OOS w.r.t. the isotonic fit
    #    window.  Applying the learned mapping retroactively to the fit
    #    bars is in-sample distortion (the regressor was trained ON those
    #    bars).  Pre-test bars keep raw confidence, capped at CONF_MAX_CAP
    #    purely as a sanity ceiling.  This makes ece_cal_test the only
    #    honest calibration metric — fit-window confidence is unchanged.
    test_start_t = int(pairs_t[split]) if len(pairs_t) > split else n
    cal_conf_col = df["confidence_raw"].copy().values
    new_probs = ens_probs.copy()
    iso_applied = 0
    for t in range(n):
        if np.isnan(ens_regimes[t]):
            continue
        r = int(ens_regimes[t])
        raw = float(ens_probs[t, r])
        if not np.isfinite(raw):
            continue
        if t >= test_start_t:
            # truly OOS w.r.t. isotonic fit -> apply learned mapping
            new_max = float(iso.predict([raw])[0])
            iso_applied += 1
        else:
            # fit window or pre-OOS training bars -> keep raw (cap only)
            new_max = raw
        # v9.3: cap at CONF_MAX_CAP so we never report
        # impossible-in-finance 100% confidence.
        new_max = min(max(new_max, 1e-6), CONF_MAX_CAP)
        other_raw = 1.0 - raw
        if other_raw > 1e-9:
            scale = (1.0 - new_max) / other_raw
            row = ens_probs[t].copy() * scale
            row[r] = new_max
            s = row.sum()
            if s > 0:
                row /= s
            new_probs[t] = row
        else:
            new_probs[t, :] = 0.0
            new_probs[t, r] = 1.0
        cal_conf_col[t] = new_probs[t, r]

    df["confidence"] = cal_conf_col
    for k in range(N_REGIMES):
        df[f"prob_{k}"] = new_probs[:, k]

    metrics.update({
        "ece_raw_fit":    raw_ece_fit,
        "ece_raw_test":   raw_ece_test,
        "ece_cal_test":   cal_ece_test,
        "brier_raw_fit": raw_brier_fit,
        "brier_raw_test": raw_brier_test,
        "brier_cal_test": cal_brier_test,
        "fit_size":       int(len(conf_fit)),
        "test_size":      int(len(conf_test)),
        "bins_raw":       bins_raw,
        "bins_cal":       bins_cal,
        "iso_applied_from_t": int(test_start_t),
        "iso_applied_n":   int(iso_applied),
    })
    df.attrs["calibration"] = metrics

    print(f"[calib] OOS pairs: {len(pairs_conf)}  "
          f"(fit={len(conf_fit)}, test={len(conf_test)})")
    print(f"[calib]   Raw   ECE: fit={raw_ece_fit:.3f}  test={raw_ece_test:.3f}  "
          f"Brier test={raw_brier_test:.3f}")
    print(f"[calib]   Isotonic  ECE test={cal_ece_test:.3f}  "
          f"Brier test={cal_brier_test:.3f}  "
          f"(improvement {raw_ece_test - cal_ece_test:+.3f} ECE)")
    print(f"[calib]   Applied isotonic to {iso_applied} bars  "
          f"(from t>={test_start_t}); fit-window bars kept raw + cap")


def _collect_runs(regime_seq) -> dict[int, list[int]]:
    """Collect completed run lengths per regime (excludes the last run)."""
    runs: dict[int, list[int]] = {r: [] for r in range(N_REGIMES)}
    cur, count = None, 0
    segments: list[tuple[int, int]] = []
    for r in regime_seq:
        r = int(r)
        if r == cur:
            count += 1
        else:
            if cur is not None and count > 0:
                segments.append((cur, count))
            cur = r
            count = 1
    # last (ongoing) segment — don't include
    for regime, length in segments:
        runs[regime].append(length)
    return runs


def estimate_remaining(runs_for_regime: list[int],
                       days_in: int) -> float | None:
    """Expected remaining days given empirical run lengths."""
    if len(runs_for_regime) < 3:
        return None
    arr = np.array(runs_for_regime)
    longer = arr[arr > days_in]
    if len(longer) == 0:
        return 0.0
    return float(np.mean(longer) - days_in)


# =====================================================================
# TRANSITION MATRIX
# =====================================================================

def _trans_matrix(history: list[int]) -> np.ndarray:
    h = history[-TRANS_LOOKBACK:]
    T = np.full((N_REGIMES, N_REGIMES), LAPLACE_ALPHA)
    for a, b in zip(h, h[1:]):
        T[a][b] += 1
    return T / T.sum(axis=1, keepdims=True)


# =====================================================================
# BACKTEST  (walk-forward: rule -> WF-HMM -> WF-LSTM -> ensemble)
# =====================================================================

def run_backtest(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    n = len(df)
    _diag_log(f"[diag] run_backtest start  n={n}  "
              f"target_mode={LSTM_TARGET_MODE}  "
              f"calib_enabled={CALIB_ENABLED}  "
              f"trans_enabled={TRANS_ENABLED}")

    # per-bar arrays
    rule_regimes = np.full(n, np.nan)
    rule_probs   = np.full((n, N_REGIMES), 1.0 / N_REGIMES)
    ens_regimes  = np.full(n, np.nan)
    ens_probs    = np.full((n, N_REGIMES), 1.0 / N_REGIMES)
    ens_confs    = np.full(n, np.nan)
    score_arr    = np.full((n, N_REGIMES), 1.0 / N_REGIMES)

    # v10: forward-regime teacher signal for the LSTM (Phase 2 decoupling).
    # Computed once over the full close series; sliced per training segment.
    # Uses absolute thresholds so labels are stable across regimes.
    if LSTM_TARGET_MODE == "forward":
        df["fwd_regime"] = _compute_forward_regime(
            df["close"].values, LSTM_FORWARD_WIN)
        fwd_counts = (df["fwd_regime"]
                      .dropna()
                      .astype(int)
                      .value_counts()
                      .sort_index())
        fwd_total = int(fwd_counts.sum()) if len(fwd_counts) else 0
        _diag_log(
            f"[lstm-tgt] Forward-regime distribution "
            f"(window={LSTM_FORWARD_WIN}, n={fwd_total}): "
            + ", ".join(
                f"{REGIME_NAMES[int(k)]}={int(v)} "
                f"({100.0 * int(v) / max(fwd_total, 1):.1f}%)"
                for k, v in fwd_counts.items()))

    # ── Phase 1: rule-based classification (fully causal) ───────
    rule_stab = Stabilizer()
    for i in range(n):
        row = df.iloc[i]
        if any(pd.isna(row.get(c, np.nan)) for c in FEAT_COLS):
            continue

        feats = [row[c] for c in FEAT_COLS]
        sc = _raw_scores(*feats)

        vol_prev = (df["vol_n"].iloc[i - 1]
                    if i > 0 and not pd.isna(df["vol_n"].iloc[i - 1])
                    else None)
        sc = _risk_condition(sc, rule_stab.current, rule_stab.persist,
                             row["vol_n"], vol_prev)

        probs = _softmax(sc)
        label = int(np.argmax(probs))

        shock_raw = row["shock_z"] if not pd.isna(row["shock_z"]) else 0.0
        dd_raw    = row["drawdown"] if not pd.isna(row["drawdown"]) else 0.0
        label = _riskoff_confirm(label, probs, shock_raw, dd_raw)
        label = rule_stab.step(label, probs)

        rule_regimes[i] = label
        rule_probs[i]   = probs
        score_arr[i]    = sc

    # ── Phase 2: walk-forward online HMM (warm-start, monthly) ──
    #   v6: warm-started refits every HMM_ONLINE_REFIT bars (~monthly)
    #   First fit: full initialisation.  Subsequent: warm-start from
    #   previous model parameters with fewer EM iterations.
    feat_matrix = df[FEAT_COLS].values
    valid_mask = ~np.isnan(feat_matrix).any(axis=1)
    valid_indices = np.where(valid_mask)[0]
    n_valid = len(valid_indices)
    hmm_probs_full = np.full((n, N_REGIMES), 1.0 / N_REGIMES)
    has_hmm = False

    if HAS_HMM and n_valid >= WF_MIN_TRAIN:
        has_hmm = True
        seg_start = WF_MIN_TRAIN
        n_fits = 0
        prev_hmm = None          # warm-start anchor

        while seg_start < n_valid:
            seg_end = min(seg_start + HMM_ONLINE_REFIT, n_valid)
            X_train = feat_matrix[valid_indices[:seg_start]]

            # warm-start only if previous model's params are clean
            # (some states can still collapse -> NaN startprob_ even with K=5)
            warm_ok = (prev_hmm is not None
                       and np.all(np.isfinite(prev_hmm.startprob_))
                       and np.all(np.isfinite(prev_hmm.transmat_))
                       and abs(prev_hmm.startprob_.sum() - 1.0) < 1e-6)
            try:
                if not warm_ok:
                    # first fit or collapsed prev — full initialisation
                    # v10: diag covariance (was "full") — see fit_hmm() note.
                    hmm_model = GaussianHMM(
                        n_components=HMM_N_STATES,
                        covariance_type="diag",
                        n_iter=HMM_N_ITER,
                        random_state=42)
                else:
                    # warm-start — seed transition dynamics from previous
                    # model, let means/covars re-init from data.
                    # v10: diag covariance keeps params shape stable across
                    # refits (the original full-cov "mc" hack is unnecessary
                    # but kept harmlessly — re-init is still correct).
                    hmm_model = GaussianHMM(
                        n_components=HMM_N_STATES,
                        covariance_type="diag",
                        n_iter=HMM_ONLINE_ITER,
                        random_state=42,
                        init_params="mc")   # re-init means & covars
                    hmm_model.startprob_ = prev_hmm.startprob_.copy()
                    hmm_model.transmat_ = prev_hmm.transmat_.copy()

                hmm_model.fit(X_train)
                # only cache as warm-start anchor if params are clean
                if (np.all(np.isfinite(hmm_model.startprob_))
                        and np.all(np.isfinite(hmm_model.transmat_))):
                    prev_hmm = hmm_model
                else:
                    prev_hmm = None
                mapping = _map_hmm_states(hmm_model)

                X_all = feat_matrix[valid_indices[:seg_end]]
                raw_probs = _hmm_forward_probs(hmm_model, X_all)

                # many-to-one: sum probs of states sharing a regime label
                mapped = np.zeros((raw_probs.shape[0], N_REGIMES))
                for hs, reg in enumerate(mapping):
                    mapped[:, reg] += raw_probs[:, hs]

                for j in range(seg_start, seg_end):
                    hmm_probs_full[valid_indices[j]] = mapped[j]

                n_fits += 1
            except Exception as e:
                print(f"[hmm-wf] Segment {n_fits} failed: {e}")

            seg_start = seg_end

        print(f"[hmm-wf] Online walk-forward: {n_fits} refits "
              f"(warm-start every {HMM_ONLINE_REFIT}d), "
              f"{n_valid - WF_MIN_TRAIN} OOS bars")

    # ── Phase 3: walk-forward LSTM+Attention ────────────────────
    #   v8: soft targets — blend HMM posteriors with rule one-hots.
    #   v9.3: LSTM feeds on LSTM_FEAT_COLS (raw/log/ratio features),
    #   distinct from the normalised FEAT_COLS used by rules+HMM.  This
    #   decouples the LSTM from its training targets — it now contributes
    #   genuinely orthogonal information to the ensemble.
    lstm_probs_full = np.full((n, N_REGIMES), 1.0 / N_REGIMES)
    has_lstm = False
    # v9.3: LSTM uses its own feature view; fall back to any NaN rows via
    # the same valid_mask used for HMM (sequences with NaN are skipped by
    # _build_sequences anyway, so imperfect overlap is safe).
    lstm_feat_matrix = df[LSTM_FEAT_COLS].values
    input_dim = len(LSTM_FEAT_COLS)

    if HAS_LSTM and n_valid >= WF_MIN_TRAIN + LSTM_SEQ_LEN:
        has_lstm = True
        seg_start = WF_MIN_TRAIN
        n_lstm_fits = 0
        import math
        n_lstm_segs = math.ceil((n_valid - WF_MIN_TRAIN) / LSTM_REFIT_EVERY)
        target_desc = (f"forward-{LSTM_FORWARD_WIN}d"
                       if LSTM_TARGET_MODE == "forward"
                       else f"soft-alpha={SOFT_ALPHA_HMM:.2f}")
        print(f"[lstm-wf] Starting: {n_lstm_segs} segments, "
              f"{n_valid} valid bars, attention={ATTN_N_HEADS} heads, "
              f"target={target_desc}, input_dim={input_dim}", flush=True)

        while seg_start < n_valid:
            seg_end = min(seg_start + LSTM_REFIT_EVERY, n_valid)

            # v10: drop the last LSTM_FORWARD_WIN training bars when using
            # forward targets — their teacher labels look at bars >= seg_start
            # (i.e., the OOS region we are about to predict), which would
            # leak the future into training.  In "soft" legacy mode this
            # adjustment is unnecessary so we keep the full slice.
            if LSTM_TARGET_MODE == "forward":
                train_cutoff = max(0, seg_start - LSTM_FORWARD_WIN)
                train_feats = lstm_feat_matrix[valid_indices[:train_cutoff]]
                train_fwd   = df["fwd_regime"].values[valid_indices[:train_cutoff]]
                soft_targets = _build_forward_targets(train_fwd)
            else:
                train_feats  = lstm_feat_matrix[valid_indices[:seg_start]]
                train_rules  = rule_regimes[valid_indices[:seg_start]]
                train_hmm    = hmm_probs_full[valid_indices[:seg_start]]
                soft_targets = _build_soft_labels(train_rules, train_hmm, has_hmm)
            X_seq, Y_seq = _build_sequences(train_feats, soft_targets)

            if len(X_seq) < LSTM_BATCH * 2:
                seg_start = seg_end
                continue

            try:
                lstm_model = _train_lstm(X_seq, Y_seq, input_dim)
                if lstm_model is None:
                    seg_start = seg_end
                    continue

                oos_feats = lstm_feat_matrix[valid_indices[:seg_end]]
                oos_probs = _lstm_predict(lstm_model, oos_feats,
                                          start_idx=seg_start)

                for j in range(seg_start, seg_end):
                    lstm_probs_full[valid_indices[j]] = oos_probs[j]

                n_lstm_fits += 1
                print(f"  [lstm-wf] Segment {n_lstm_fits}/{n_lstm_segs} "
                      f"done  ({len(X_seq)} seqs trained)", flush=True)
            except Exception as e:
                print(f"[lstm-wf] Segment {n_lstm_fits} failed: {e}")

            seg_start = seg_end

        print(f"[lstm-wf] Walk-forward: {n_lstm_fits} refits, "
              f"{n_valid - WF_MIN_TRAIN} OOS bars")

    # ── Phase 4: transition detector ───────────────────────────
    #   v8: targets = HMM-weighted argmax (removes rules→rules loop).
    #   Features remain rule-based (deterministic from inputs); targets
    #   now reflect latent-state changes.  Train/OOS split is strictly
    #   chronological so precision/recall reflect true unseen bars.
    trans_detector = None
    has_trans = False
    trans_metrics: dict = {}
    if HAS_LSTM and n_valid >= WF_MIN_TRAIN + 100:
        vol_n = df["vol_n"].values if "vol_n" in df.columns else np.full(n, 0.5)

        # HMM-weighted target regimes: argmax(alpha*HMM + (1-alpha)*rule)
        # where HMM is active — falls back to rule_regimes otherwise.
        tgt_regimes = rule_regimes.copy()
        if has_hmm:
            uniform = 1.0 / N_REGIMES
            for i in range(n):
                if np.isnan(rule_regimes[i]):
                    continue
                hvec = hmm_probs_full[i]
                if (not np.allclose(hvec, uniform, atol=0.01)
                        and np.all(np.isfinite(hvec))):
                    rule_oh = np.zeros(N_REGIMES)
                    rule_oh[int(rule_regimes[i])] = 1.0
                    blend = SOFT_ALPHA_HMM * hvec + (1 - SOFT_ALPHA_HMM) * rule_oh
                    tgt_regimes[i] = int(np.argmax(blend))

        trans_feats, trans_labels = _build_transition_data(
            rule_probs, rule_regimes, vol_n, n,
            target_regimes=tgt_regimes)
        if len(trans_feats) > 200:
            trans_detector, trans_metrics = _train_transition_detector(
                trans_feats, trans_labels)
            has_trans = trans_detector is not None

    # ── Phase 5: 3-way ensemble blend + transition modulation ──
    #   v9.2: Rules 45% + HMM 35% + LSTM 20% (where available)
    #   Rebalanced because LSTM trains on rule+HMM targets with the same
    #   21 features and largely duplicates them; the higher rule weight
    #   reflects that rules contain the only independent regime semantics.
    #   v6: transition detector boosts non-current probs when a
    #   regime change is imminent, reducing detection lag by 1-3 bars.
    ens_stab = Stabilizer()
    for i in range(n):
        if np.isnan(rule_regimes[i]):
            continue

        # v10: uniform is 1/N_REGIMES (was hardcoded 0.25 from v7's 4-regime
        # build).  With N_REGIMES=6, uniform=0.167 — the old check almost
        # never matched the true "inactive" state, so HMM/LSTM were silently
        # treated as active even when their posteriors had already collapsed
        # to uniform.  atol widened to 0.005 since 1/6 has more precision.
        uniform_p = 1.0 / N_REGIMES
        hmm_active = has_hmm and not np.allclose(
            hmm_probs_full[i], uniform_p, atol=0.005)
        lstm_active = has_lstm and not np.allclose(
            lstm_probs_full[i], uniform_p, atol=0.005)

        w_r, w_h, w_l = ENS_W_RULES, 0.0, 0.0
        if hmm_active:
            w_h = ENS_W_HMM
        if lstm_active:
            w_l = ENS_W_LSTM
        if w_h == 0.0 and w_l == 0.0:
            w_r = 1.0
        else:
            total = w_r + w_h + w_l
            w_r /= total; w_h /= total; w_l /= total

        blend = (w_r * rule_probs[i]
                 + w_h * hmm_probs_full[i]
                 + w_l * lstm_probs_full[i])
        s = blend.sum()
        if s > 0:
            blend /= s

        # v6 : transition detection — boost non-current probs
        # v10: gated by TRANS_ENABLED.  Last metrics: F1=0.24 / P=0.15 /
        #      R=0.69 — 85% false-positive rate on alerts.  Each false
        #      alert spuriously redistributed mass away from the correct
        #      regime, contributing to the Jan 2024 / Jan 2026 mislabels.
        if TRANS_ENABLED and has_trans and i >= 5 and ens_stab.current is not None:
            prob_change = ens_probs[max(0, i - 1)] - ens_probs[max(0, i - 4)]
            sorted_p = np.sort(blend)[::-1]
            conf_gap = sorted_p[0] - sorted_p[1]
            v_now = df["vol_n"].iloc[i] if not pd.isna(df["vol_n"].iloc[i]) else 0.5
            v_prev = df["vol_n"].iloc[max(0, i - 5)]
            vol_chg = (v_now - v_prev) if not np.isnan(v_prev) else 0.0
            persist_n = min(ens_stab.persist / 100., 1.0)

            td_input = torch.FloatTensor(np.concatenate([
                prob_change, blend, [conf_gap], [vol_chg], [persist_n]
            ])).unsqueeze(0)
            with torch.no_grad():
                trans_prob = trans_detector(td_input).item()

            if trans_prob > TRANS_DETECT_THRESH:
                cur = ens_stab.current
                # Proportional boost: redistribute some of current regime's
                # mass to alternatives weighted by their existing probs.
                # This prevents Chop from absorbing everything.
                shift = 0.3 * (trans_prob - TRANS_DETECT_THRESH)
                mass = blend[cur] * shift
                alt_sum = sum(blend[r] for r in range(N_REGIMES) if r != cur)
                if alt_sum > 1e-8:
                    for r in range(N_REGIMES):
                        if r != cur:
                            blend[r] += mass * (blend[r] / alt_sum)
                    blend[cur] -= mass
                blend = np.clip(blend, 0, None)
                blend /= blend.sum()

        # v9.2: entropy smoothing — mix a small uniform prior into the blend.
        # Preserves argmax (so label, calibration, strategy signal unchanged)
        # but caps max-prob at 1 - MIX + MIX/N to reflect residual uncertainty
        # and prevent illusory "100% confidence" from correlated-model agreement.
        if ENS_ENTROPY_MIX > 0:
            blend = ((1.0 - ENS_ENTROPY_MIX) * blend
                     + ENS_ENTROPY_MIX / N_REGIMES)

        label = int(np.argmax(blend))

        row = df.iloc[i]
        shock_raw = row["shock_z"] if not pd.isna(row["shock_z"]) else 0.0
        dd_raw    = row["drawdown"] if not pd.isna(row["drawdown"]) else 0.0
        label = _riskoff_confirm(label, blend, shock_raw, dd_raw)
        label = ens_stab.step(label, blend)

        ens_regimes[i] = label
        ens_probs[i]   = blend
        ens_confs[i]   = blend[label]

    # store results
    df["regime"]      = ens_regimes
    df["confidence"]  = ens_confs
    df["rule_regime"] = rule_regimes
    for k in range(N_REGIMES):
        df[f"prob_{k}"]      = ens_probs[:, k]
        df[f"rule_prob_{k}"] = rule_probs[:, k]
        df[f"score_{k}"]     = score_arr[:, k]

    valid_ens = [int(x) for x in ens_regimes if not np.isnan(x)]
    df.attrs["T_last"] = (_trans_matrix(valid_ens)
                          if len(valid_ens) > 10
                          else np.full((N_REGIMES, N_REGIMES), 1.0 / N_REGIMES))
    df.attrs["has_hmm"] = has_hmm
    df.attrs["has_lstm"] = has_lstm
    df.attrs["has_trans"] = has_trans
    df.attrs["trans_metrics"] = trans_metrics

    # ── Phase 6: calibration (v8) ─────────────────────────────
    #   v10: Gated by CALIB_ENABLED — the persistence-based isotonic was
    #   inflating raw confidence to the cap.  When disabled, df["confidence"]
    #   stays equal to the raw blend max (already entropy-mixed), and
    #   df["confidence_raw"] is set to the same value for downstream
    #   compatibility.
    if CALIB_ENABLED:
        _apply_calibration(df, ens_probs, ens_regimes, start_idx=WF_MIN_TRAIN)
    else:
        df["confidence_raw"] = df["confidence"].copy()
        df.attrs["calibration"] = {
            "enabled": False,
            "note": "isotonic disabled in v10 (persistence-target bias)",
        }

    # v10 diagnostic: distribution of raw confidence so we can tune
    # ENS_ENTROPY_MIX / SOFTMAX_TEMP / CONF_MAX_CAP against actual
    # percentiles instead of single-bar snapshots.
    conf_arr = df["confidence_raw"].dropna().values
    if conf_arr.size:
        pcts = np.percentile(conf_arr, [10, 25, 50, 75, 90])
        _diag_log(
            f"[diag-conf] confidence_raw percentiles "
            f"(n={conf_arr.size}): "
            f"p10={pcts[0]:.3f}  p25={pcts[1]:.3f}  "
            f"p50={pcts[2]:.3f}  p75={pcts[3]:.3f}  "
            f"p90={pcts[4]:.3f}  "
            f"mean={conf_arr.mean():.3f}  max={conf_arr.max():.3f}")

    return df


# =====================================================================
# STRATEGY  &  METRICS
# =====================================================================

def _compute_raw_signal(prob_cols_prefix: str, dv: pd.DataFrame) -> pd.Series:
    """Compute probability-weighted signal with dynamic Volatile Trend."""
    tdir = dv["tdir_n"].fillna(0.5)
    vt_alloc = np.where(tdir < VOLTRD_THRESH, VOLTRD_DOWN, VOLTRD_UP)

    sig = (dv[f"{prob_cols_prefix}_0"] * REGIME_ALLOC[0]
           + dv[f"{prob_cols_prefix}_1"] * vt_alloc
           + dv[f"{prob_cols_prefix}_2"] * REGIME_ALLOC[2]
           + dv[f"{prob_cols_prefix}_3"] * REGIME_ALLOC[3]
           + dv[f"{prob_cols_prefix}_4"] * REGIME_ALLOC[4]
           + dv[f"{prob_cols_prefix}_5"] * REGIME_ALLOC[5])
    return sig


def _vol_scale(daily_ret: pd.Series) -> pd.Series:
    """Volatility-targeting multiplier.

    Scales position magnitude down when realised vol exceeds target.  Uses
    rolling stdev of daily returns (NOT strategy returns) — so it responds
    to market conditions independently of strategy PnL.  Output is in [0, 1]
    after clipping: above target -> <1, below target -> capped at 1.0.
    """
    target_daily = VOL_TARGET_ANN / np.sqrt(252)
    realised = (daily_ret.rolling(VOL_WINDOW).std()
                .bfill().fillna(target_daily))
    scale = (target_daily / realised.clip(lower=1e-6)).clip(upper=VOL_SCALE_CAP)
    return scale.shift(1).fillna(VOL_SCALE_CAP)


def _dd_throttle(strat_ret: pd.Series) -> pd.Series:
    """Drawdown-based de-risking multiplier (causal).

    Computes strategy equity curve and its running drawdown, then scales
    position inversely to drawdown severity.  At DD_THROTTLE_START the
    multiplier is 1.0; it falls linearly (slope DD_THROTTLE_SLOPE) with
    further drawdown and floors at DD_THROTTLE_FLOOR.  Shifted 1 bar so
    today's throttle uses yesterday's DD (no look-ahead).
    """
    eq = (1 + strat_ret.fillna(0)).cumprod()
    dd = (eq / eq.cummax() - 1.0).abs()   # positive DD magnitude
    throttle = (1.0 - DD_THROTTLE_SLOPE *
                (dd - DD_THROTTLE_START).clip(lower=0)).clip(
                    lower=DD_THROTTLE_FLOOR, upper=1.0)
    return throttle.shift(1).fillna(1.0)


def _apply_risk_overlays(sig: pd.Series, daily_ret: pd.Series) -> pd.Series:
    """Apply vol-targeting and drawdown throttling to a raw regime signal.

    Two-pass: (1) vol-scale the raw signal, compute preliminary strat_ret;
    (2) derive DD throttle from (1)'s strat_ret, re-scale, return final sig.
    Both overlays are lag-shifted to avoid look-ahead.
    """
    vol_scale = _vol_scale(daily_ret)
    sig_vs = (sig * vol_scale).clip(-1.0, 1.0)
    prelim_ret = daily_ret * sig_vs.shift(1).fillna(0)
    dd_throt = _dd_throttle(prelim_ret)
    return (sig_vs * dd_throt).clip(-1.0, 1.0)


def compute_performance(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["daily_ret"] = df["close"].pct_change()
    # signals are computed on the valid slice in build_all
    return df


def _metrics(rets: pd.Series) -> dict:
    rets = rets.dropna()
    if len(rets) == 0:
        return {"sharpe": 0.0, "mdd": 0.0, "total": 0.0}
    tot = (1 + rets).prod() - 1
    sharpe = (rets.mean() / rets.std() * np.sqrt(252)
              if rets.std() > 0 else 0.0)
    cum = (1 + rets).cumprod()
    mdd = ((cum - cum.cummax()) / cum.cummax()).min()
    return {"sharpe": sharpe, "mdd": mdd, "total": tot}


# =====================================================================
# v9.3 STATISTICAL VALIDATION SUITE
# =====================================================================

def _sharpe_ann(r: np.ndarray) -> float:
    r = np.asarray(r, dtype=float)
    r = r[~np.isnan(r)]
    if len(r) < 2 or r.std(ddof=1) == 0:
        return 0.0
    return float(r.mean() / r.std(ddof=1) * np.sqrt(252))


def _mdd(r: np.ndarray) -> float:
    r = np.asarray(r, dtype=float)
    r = r[~np.isnan(r)]
    if len(r) == 0:
        return 0.0
    cum = np.cumprod(1 + r)
    peak = np.maximum.accumulate(cum)
    return float(((cum - peak) / peak).min())


def _block_bootstrap_sharpe(r: np.ndarray, block: int, n_boot: int,
                            seed: int) -> tuple[float, float, float]:
    """Non-overlapping block bootstrap — preserves serial correlation.
    Returns (2.5%, 50%, 97.5%) percentiles of resampled annualised Sharpe.
    """
    r = np.asarray(r, dtype=float)
    r = r[~np.isnan(r)]
    n = len(r)
    n_blocks = n // block
    if n_blocks < 4:
        return (0.0, 0.0, 0.0)
    blocks = r[:n_blocks * block].reshape(n_blocks, block)
    rng = np.random.default_rng(seed)
    out = np.empty(n_boot)
    for b in range(n_boot):
        idx = rng.integers(0, n_blocks, size=n_blocks)
        sample = blocks[idx].ravel()
        out[b] = _sharpe_ann(sample)
    return (float(np.percentile(out, 2.5)),
            float(np.percentile(out, 50)),
            float(np.percentile(out, 97.5)))


def _dm_test(r_strat: np.ndarray, r_bench: np.ndarray,
             h: int = 1) -> tuple[float, float]:
    """Diebold-Mariano on loss differential (squared-return proxy).
    Tests whether mean excess return of strategy over B&H is zero, using
    Newey-West HAC variance and Harvey small-sample correction.
    Returns (dm_stat, two-sided p-value).  Falls back to NaN if scipy missing.
    """
    try:
        from scipy import stats as sps
    except Exception:
        return (float("nan"), float("nan"))
    d = np.asarray(r_strat, dtype=float) - np.asarray(r_bench, dtype=float)
    d = d[~np.isnan(d)]
    T = len(d)
    if T < 30:
        return (float("nan"), float("nan"))
    dbar = d.mean()
    gamma0 = d.var(ddof=1)
    acc = gamma0
    for k in range(1, h):
        w = 1 - k / h
        cov_k = np.cov(d[k:], d[:-k])[0, 1]
        acc += 2 * w * cov_k
    if acc <= 0:
        return (float("nan"), float("nan"))
    dm = dbar / np.sqrt(acc / T)
    # Harvey small-sample correction
    dm *= np.sqrt((T + 1 - 2 * h + h * (h - 1) / T) / T)
    pval = 2 * (1 - sps.norm.cdf(abs(dm)))
    return (float(dm), float(pval))


def validate_model(df: pd.DataFrame, ticker: str, *,
                   n_boot: int = 1000, n_placebo: int = 300) -> None:
    """v9.3: Deep statistical validation — overfitting, predictive power,
    bias, robustness.  Runs at end of print_summary.  Output:
      [1] Confidence distribution         (overconfidence flag)
      [2] Block bootstrap Sharpe CI       (is Sharpe > 0 significant?)
      [3] Diebold-Mariano vs B&H          (parametric alpha test)
      [4] Shuffled-label placebo          (is the signal real?)
      [5] IS vs OOS Sharpe                (overfitting flag)
      [6] Information Coefficient         (predictive power)
      [7] Annual Sharpe breakdown         (consistency across regimes)
      [8] Signal robustness (noise inj.)  (parameter tightness proxy)
      [9] Look-ahead bias audit           (static checklist)
    """
    v = df.dropna(subset=["regime", "close"]).copy()
    if len(v) < 250:
        print("  [validate] skipped: <250 classified bars")
        return
    v["regime"] = v["regime"].astype(int)
    v["daily_ret"] = v["close"].pct_change().fillna(0)

    # real strategy signal (same as print_summary uses)
    raw_ens = _compute_raw_signal("prob", v).clip(-1.0, 1.0)
    sig_s = (_apply_risk_overlays(raw_ens, v["daily_ret"])
             .shift(1).fillna(0))
    sig_np   = sig_s.values
    bench_np = v["daily_ret"].values
    strat_np = bench_np * sig_np

    print("=" * 72)
    print(f"  STATISTICAL VALIDATION  --  {ticker}  (v9.4)")
    print("=" * 72)

    # [1] confidence distribution -----------------------------------
    if "confidence" in v.columns:
        c = v["confidence"].dropna()
        print("\n[1] Confidence distribution (post-calibration):")
        print(f"    min={c.min():.3f}  p25={c.quantile(0.25):.3f}  "
              f"median={c.median():.3f}  p75={c.quantile(0.75):.3f}  "
              f"max={c.max():.3f}  mean={c.mean():.3f}")
        p95 = float((c > 0.95).mean())
        p99 = float((c > 0.99).mean())
        print(f"    Bars > 95% conf: {p95:.1%}    > 99% conf: {p99:.1%}")
        if p99 > 0.30:
            print(f"    FLAG: >30% of bars at 99%+ — "
                  f"isotonic plateau saturation")
        elif c.mean() > 0.90:
            print(f"    FLAG: mean confidence >90% is high for 6-regime model")

    # [2] block bootstrap Sharpe CI ---------------------------------
    s_lo, s_md, s_hi = _block_bootstrap_sharpe(strat_np, 21, n_boot, 42)
    b_lo, b_md, b_hi = _block_bootstrap_sharpe(bench_np, 21, n_boot, 43)
    print(f"\n[2] Block bootstrap Sharpe CI (21-day blocks, "
          f"{n_boot} resamples):")
    print(f"    Strategy  [2.5 / 50 / 97.5]%: "
          f"[{s_lo:+.2f} / {s_md:+.2f} / {s_hi:+.2f}]")
    print(f"    B&H       [2.5 / 50 / 97.5]%: "
          f"[{b_lo:+.2f} / {b_md:+.2f} / {b_hi:+.2f}]")
    if s_lo > 0:
        print(f"    VERDICT: Strategy Sharpe > 0 at 95% confidence  (OK)")
    else:
        print(f"    VERDICT: Strategy Sharpe NOT significant at 95%  (WEAK)")

    # [3] Diebold-Mariano -------------------------------------------
    dm, pval = _dm_test(strat_np, bench_np)
    print(f"\n[3] Diebold-Mariano test (strategy returns vs B&H):")
    if np.isnan(dm):
        print(f"    scipy unavailable or insufficient samples")
    else:
        print(f"    DM statistic = {dm:+.3f}    p-value = {pval:.4g}")
        if pval < 0.05:
            direction = "beats" if dm > 0 else "loses to"
            print(f"    VERDICT: Strategy {direction} B&H significantly  "
                  f"(p < 0.05)")
        else:
            print(f"    VERDICT: No significant difference from B&H  "
                  f"(p >= 0.05)")

    # [4] shuffled-label placebo ------------------------------------
    rng = np.random.default_rng(123)
    placebo = np.empty(n_placebo)
    for i in range(n_placebo):
        perm = rng.permutation(sig_np)
        placebo[i] = _sharpe_ann(bench_np * perm)
    real_sh = _sharpe_ann(strat_np)
    p_val_plac = float((placebo >= real_sh).mean())
    print(f"\n[4] Shuffled-label placebo ({n_placebo} permutations):")
    print(f"    Real Sharpe:              {real_sh:+.3f}")
    print(f"    Placebo mean / std:       {placebo.mean():+.3f}  /  "
          f"{placebo.std():.3f}")
    print(f"    P(placebo >= real):       {p_val_plac:.3f}")
    if p_val_plac < 0.05:
        print(f"    VERDICT: Signal is GENUINE (p < 0.05)")
    elif p_val_plac < 0.20:
        print(f"    VERDICT: Signal is WEAK but present")
    else:
        print(f"    VERDICT: NO real signal — likely leak or noise")

    # [5] IS vs OOS Sharpe ------------------------------------------
    n = len(strat_np)
    sp = int(n * 0.6)
    is_sh  = _sharpe_ann(strat_np[:sp])
    oos_sh = _sharpe_ann(strat_np[sp:])
    print(f"\n[5] IS vs OOS (60/40 chronological split, "
          f"IS n={sp}, OOS n={n-sp}):")
    print(f"    In-sample  Sharpe: {is_sh:+.3f}")
    print(f"    Out-sample Sharpe: {oos_sh:+.3f}")
    if is_sh > 0.3:
        ratio = oos_sh / is_sh if is_sh != 0 else 0
        if ratio < 0.3:
            print(f"    FLAG: OOS/IS = {ratio:.2f} — LIKELY OVERFIT")
        elif ratio < 0.6:
            print(f"    MILD DEGRADATION: OOS/IS = {ratio:.2f}")
        else:
            print(f"    ROBUST: OOS/IS = {ratio:.2f}")
    else:
        print(f"    Inconclusive (IS Sharpe too small)")

    # [6] Information Coefficient -----------------------------------
    try:
        from scipy import stats as sps2
        valid = ~(np.isnan(sig_np[:-1]) | np.isnan(bench_np[1:]))
        if valid.sum() > 100:
            rho, p_ic = sps2.spearmanr(sig_np[:-1][valid],
                                       bench_np[1:][valid])
            print(f"\n[6] Information Coefficient (signal_t -> ret_t+1, "
                  f"n={int(valid.sum())}):")
            print(f"    Spearman rho = {rho:+.4f}    p = {p_ic:.4g}")
            if p_ic < 0.05 and abs(rho) > 0.03:
                print(f"    VERDICT: Signal has predictive power")
            else:
                print(f"    VERDICT: Weak / insignificant predictive power")
    except Exception as e:
        print(f"\n[6] IC test skipped: {e}")

    # [7] annual Sharpe breakdown -----------------------------------
    years = pd.to_datetime(v["date"]).dt.year.values
    print(f"\n[7] Annual Sharpe consistency:")
    print(f"    {'Year':>6}  {'Strategy':>10}  {'B&H':>10}  "
          f"{'Bars':>6}  {'StratMDD':>10}")
    for y in np.unique(years):
        mask = years == y
        if int(mask.sum()) < 20:
            continue
        ss = _sharpe_ann(strat_np[mask])
        bs = _sharpe_ann(bench_np[mask])
        sm = _mdd(strat_np[mask])
        print(f"    {int(y):>6}  {ss:>+10.2f}  {bs:>+10.2f}  "
              f"{int(mask.sum()):>6}  {sm:>+10.2%}")

    # [8] signal robustness -----------------------------------------
    print(f"\n[8] Signal robustness (Gaussian noise injection):")
    print(f"    {'NoiseSD':>8}  {'Sharpe':>8}  {'MDD':>8}")
    rng3 = np.random.default_rng(7)
    for sd in [0.0, 0.1, 0.2, 0.3, 0.5]:
        perturbed = np.clip(sig_np + rng3.normal(0, sd, size=len(sig_np)),
                            -1, 1)
        r = bench_np * perturbed
        print(f"    {sd:>8.2f}  {_sharpe_ann(r):>+8.2f}  {_mdd(r):>+8.2%}")

    # [9] look-ahead bias audit -------------------------------------
    print(f"\n[9] Look-ahead bias audit (structural):")
    print(f"    EWMA features            : past-only by construction  [OK]")
    print(f"    Rolling(min_periods<=win): past-only when computed    [OK]")
    print(f"    FRED/VIX ffill           : past-only, no .bfill used  [OK]")
    print(f"    HMM walk-forward fit     : X_train=[:seg_start]       [OK]")
    print(f"    LSTM walk-forward fit    : train_feats=[:seg_start]   [OK]")
    print(f"    Calibration chrono split : fit 0-60%, test 60-100%    [OK]")
    print(f"    Signal shifted by 1 bar  : sig.shift(1) before ret    [OK]")
    print(f"    Optimise weights (once)  : uses full data -- mild IS  [FLAG]")
    print(f"      -> mitigate by disabling optimize_scoring_weights or")
    print(f"         running it only on first 60% of history")

    print("=" * 72 + "\n")


# =====================================================================
# SUMMARY TABLE
# =====================================================================

def print_summary(df: pd.DataFrame, ticker: str):
    # v9.3: sentinel — confirms print_summary is actually being invoked.
    print(f"\n[print_summary] starting for {ticker}, "
          f"df_rows={len(df)}", flush=True)
    v = df.dropna(subset=["regime"]).copy()
    if v.empty:
        print("  No classified bars.", flush=True)
        return
    v["regime"] = v["regime"].astype(int)

    parts = []
    if df.attrs.get("has_hmm"):
        parts.append("HMM")
    if df.attrs.get("has_lstm"):
        parts.append("LSTM+Attn")
    if df.attrs.get("has_trans"):
        parts.append("TransDet")
    tag = (" + " + "+".join(parts)) if parts else " (rules only)"
    print("\n" + "=" * 72)
    print(f"  REGIME SUMMARY  --  {ticker}{tag}")
    print("=" * 72)
    print(f"  {'Regime':<18} {'Bars':>7} {'Freq':>7} "
          f"{'AvgRun':>8} {'AvgConf':>9}")
    print("  " + "-" * 56)

    for r in range(N_REGIMES):
        mask = v["regime"] == r
        cnt  = mask.sum()
        freq = cnt / len(v) * 100
        runs, cur = [], 0
        for x in v["regime"]:
            if x == r:
                cur += 1
            else:
                if cur:
                    runs.append(cur)
                cur = 0
        if cur:
            runs.append(cur)
        avg_dur = np.mean(runs) if runs else 0
        avg_c   = v.loc[mask, "confidence"].mean() if cnt else 0
        print(f"  {REGIME_NAMES[r]:<18} {cnt:>7} {freq:>6.1f}% "
              f"{avg_dur:>7.1f} {avg_c:>8.1%}")

    print("=" * 72)
    v["daily_ret"] = v["close"].pct_change().fillna(0)
    raw_ens = _compute_raw_signal("prob", v).clip(-1.0, 1.0)
    v["sig_ens"] = (_apply_risk_overlays(raw_ens, v["daily_ret"])
                    .shift(1).fillna(0))
    v["strat_ret"] = v["daily_ret"] * v["sig_ens"]
    sm = _metrics(v["strat_ret"])
    bm = _metrics(v["daily_ret"])
    alloc_parts = []
    for r in range(N_REGIMES):
        a = REGIME_ALLOC[r]
        if a is None:
            alloc_parts.append(
                f"{REGIME_NAMES[r]}={VOLTRD_UP:+.0%}/{VOLTRD_DOWN:+.0%}")
        else:
            alloc_parts.append(f"{REGIME_NAMES[r]}={a:+.0%}")
    alloc_str = "  ".join(alloc_parts)
    print(f"  Allocations: {alloc_str}")
    print(f"  Ensemble  -- Sharpe {sm['sharpe']:>6.2f}  "
          f"MaxDD {sm['mdd']:>7.2%}  Return {sm['total']:>8.2%}")
    print(f"  B&H       -- Sharpe {bm['sharpe']:>6.2f}  "
          f"MaxDD {bm['mdd']:>7.2%}  Return {bm['total']:>8.2%}")

    # ── v8 diagnostics: calibration + transition detector ─────
    calib = df.attrs.get("calibration", {})
    if "ece_raw_test" in calib:
        print("-" * 72)
        print(f"  Calibration (1-bar persistence, OOS tail):")
        print(f"    Raw      ECE={calib['ece_raw_test']:.3f}  "
              f"Brier={calib['brier_raw_test']:.3f}")
        print(f"    Isotonic ECE={calib['ece_cal_test']:.3f}  "
              f"Brier={calib['brier_cal_test']:.3f}  "
              f"(Δ {calib['ece_raw_test'] - calib['ece_cal_test']:+.3f})")

    tm = df.attrs.get("trans_metrics", {})
    if "thr_0.5" in tm:
        m5, m7 = tm["thr_0.5"], tm["thr_0.7"]
        print("-" * 72)
        print(f"  Transition detector (OOS tail, {tm['n_test']} bars, "
              f"{tm['test_prevalence']:.1%} positives):")
        print(f"    @0.5  prec={m5['precision']:.1%}  "
              f"rec={m5['recall']:.1%}  F1={m5['f1']:.3f}")
        print(f"    @0.7  prec={m7['precision']:.1%}  "
              f"rec={m7['recall']:.1%}  F1={m7['f1']:.3f}")

    # ── v9.3: NBER/bear-market recall diagnostic ───────────────
    try:
        dates_ts = pd.to_datetime(v["date"])
        rec_mask = pd.Series(False, index=v.index)
        for r0, r1 in RECESSION_RANGES:
            rec_mask |= (dates_ts >= pd.Timestamp(r0)) & \
                        (dates_ts <= pd.Timestamp(r1))
        n_rec = int(rec_mask.sum())
        if n_rec > 0:
            rec_bars = v.loc[rec_mask]
            riskoff_hits = int(rec_bars["regime"]
                               .isin(RISKOFF_REGIMES).sum())
            recall = riskoff_hits / n_rec
            print("-" * 72)
            print(f"  Recession recall (NBER + 2022 bear, {n_rec} bars):")
            print(f"    Risk-off regimes (Churn/Correction/Crisis) "
                  f"covered {recall:.1%}  ({riskoff_hits}/{n_rec})")
            for r0, r1 in RECESSION_RANGES:
                rng = (dates_ts >= pd.Timestamp(r0)) & \
                      (dates_ts <= pd.Timestamp(r1))
                rn = int(rng.sum())
                if rn == 0:
                    continue
                hits = int(v.loc[rng, "regime"]
                           .isin(RISKOFF_REGIMES).sum())
                print(f"      {r0} -> {r1}: "
                      f"{hits/rn:.1%}  ({hits}/{rn})")
    except Exception as e:
        print(f"  [recall-diag] skipped: {e}")
    print("=" * 72 + "\n")

    # v9.3: deep statistical validation
    try:
        validate_model(df, ticker)
    except Exception as e:
        print(f"  [validate] failed: {e}")


# =====================================================================
# FIGURE HELPERS
# =====================================================================

def _dark(fig, title="", h=400):
    fig.update_layout(
        title=dict(text=title, font=dict(color="#e0e0e0", size=14)),
        paper_bgcolor=BG, plot_bgcolor="#080808",
        font=dict(color="#999", family="monospace", size=11),
        margin=dict(l=55, r=25, t=45, b=40),
        height=h,
        legend=dict(bgcolor="rgba(0,0,0,0)", font=dict(size=10)),
        xaxis=dict(gridcolor="#1c1c1c", zerolinecolor="#222"),
        yaxis=dict(gridcolor="#1c1c1c", zerolinecolor="#222"),
    )
    return fig


def _bezier(p0, p1, curve=0.25, n=40, t0=0.12, t1=0.88):
    mx = (p0[0] + p1[0]) / 2
    my = (p0[1] + p1[1]) / 2
    dx, dy = p1[0] - p0[0], p1[1] - p0[1]
    ln = np.hypot(dx, dy) or 1
    cx = mx + (-dy / ln) * curve
    cy = my + (dx / ln) * curve
    t = np.linspace(t0, t1, n)
    x = (1 - t)**2 * p0[0] + 2*(1 - t)*t * cx + t**2 * p1[0]
    y = (1 - t)**2 * p0[1] + 2*(1 - t)*t * cy + t**2 * p1[1]
    return x, y


def _valid(df):
    mask = df[FEAT_COLS].notna().all(axis=1) & df["regime"].notna()
    dv = df[mask].copy()
    dv["regime"] = dv["regime"].astype(int)
    if "rule_regime" in dv.columns:
        dv["rule_regime"] = dv["rule_regime"].astype(int)
    if "confidence" in dv.columns:
        dv["confidence"] = dv["confidence"].fillna(0.5).clip(0.0, 1.0)
    return dv


# =====================================================================
# PANEL 1 — PHASE SPACE  (PCA on 21 features)
# =====================================================================

def fig_phase_space(dv):
    pca = PCA(n_components=2)
    coords = pca.fit_transform(dv[FEAT_COLS].values)
    dv = dv.copy()
    dv["pc1"], dv["pc2"] = coords[:, 0], coords[:, 1]

    fig = go.Figure()
    for r in range(N_REGIMES):
        m = dv["regime"] == r
        if not m.any():
            continue
        fig.add_trace(go.Scatter(
            x=dv.loc[m, "pc1"], y=dv.loc[m, "pc2"],
            mode="markers", name=REGIME_NAMES[r],
            marker=dict(size=(dv.loc[m, "confidence"].fillna(0.5) * 8 + 2).clip(2, 12),
                        color=REGIME_COLORS[r], opacity=0.4),
            hovertemplate="%{text}<extra></extra>",
            text=dv.loc[m, "date"].dt.strftime("%Y-%m-%d"),
        ))

    tail = dv.tail(20)
    fig.add_trace(go.Scatter(
        x=tail["pc1"], y=tail["pc2"],
        mode="lines+markers", name="Last 20 bars",
        line=dict(color="white", width=1.5),
        marker=dict(size=5, color="white"),
    ))

    for r in range(N_REGIMES):
        m = dv["regime"] == r
        if m.any():
            fig.add_trace(go.Scatter(
                x=[dv.loc[m, "pc1"].mean()],
                y=[dv.loc[m, "pc2"].mean()],
                mode="markers+text", showlegend=False,
                marker=dict(size=20, color=REGIME_COLORS[r],
                            symbol="diamond",
                            line=dict(width=2, color="white")),
                text=[REGIME_NAMES[r]], textposition="top center",
                textfont=dict(color=REGIME_COLORS[r], size=9),
            ))

    var = pca.explained_variance_ratio_
    _dark(fig,
          f"Phase Space (PCA on 21 features, "
          f"{var[0]:.0%}+{var[1]:.0%} var explained)", h=400)
    fig.update_xaxes(title_text="PC 1")
    fig.update_yaxes(title_text="PC 2")
    return fig


# =====================================================================
# PANEL 2 — TRANSITION GRAPH
# =====================================================================

def fig_transition_graph(T, probs, cur):
    # Lay nodes on a regular polygon so the graph scales with N_REGIMES.
    pos = {}
    for r in range(N_REGIMES):
        ang = 2 * np.pi * r / N_REGIMES - np.pi / 2   # start at top
        pos[r] = (1.5 * np.cos(ang), 1.5 * np.sin(ang))

    fig = go.Figure()

    for i in range(N_REGIMES):
        for j in range(N_REGIMES):
            if i == j:
                continue
            w = T[i][j]
            if w < 0.03:
                continue
            sign = 1 if i < j else -1
            bx, by = _bezier(pos[i], pos[j], curve=0.30 * sign)
            alpha = min(w * 2.0, 0.7)
            fig.add_trace(go.Scatter(
                x=bx, y=by, mode="lines", showlegend=False,
                line=dict(width=max(0.8, w * 10),
                          color=f"rgba(255,255,255,{alpha:.2f})"),
                hoverinfo="text",
                text=f"{REGIME_NAMES[i]}->{REGIME_NAMES[j]}: {w:.1%}",
            ))
            fig.add_annotation(
                ax=float(bx[-3]), ay=float(by[-3]),
                x=float(bx[-1]), y=float(by[-1]),
                xref="x", yref="y", axref="x", ayref="y",
                showarrow=True, arrowhead=2, arrowsize=1.4,
                arrowwidth=max(1, w * 5),
                arrowcolor=f"rgba(255,255,255,{alpha:.2f})",
            )

    for r in range(N_REGIMES):
        sz = max(28, probs[r] * 140)
        col = REGIME_COLORS[r]
        if r == cur:
            fig.add_trace(go.Scatter(
                x=[pos[r][0]], y=[pos[r][1]], mode="markers",
                marker=dict(size=sz + 30, color=col, opacity=0.18),
                showlegend=False, hoverinfo="skip",
            ))
        fig.add_trace(go.Scatter(
            x=[pos[r][0]], y=[pos[r][1]],
            mode="markers+text", showlegend=False,
            marker=dict(size=sz, color=col,
                        line=dict(width=3 if r == cur else 1,
                                  color="white" if r == cur else "#333")),
            text=(f"<b>{REGIME_NAMES[r]}</b><br>"
                  f"P={probs[r]:.0%}<br>self={T[r][r]:.0%}"),
            textposition="bottom center",
            textfont=dict(color=col, size=10),
            hoverinfo="text",
        ))

    _dark(fig, "Transition Graph", h=400)
    fig.update_xaxes(visible=False, range=[-2.2, 2.2])
    fig.update_yaxes(visible=False, range=[-2.2, 2.2], scaleanchor="x")
    return fig


# =====================================================================
# PANEL 3 — TRANSITION HEATMAP
# =====================================================================

def fig_heatmap(T):
    labels = [REGIME_NAMES[i] for i in range(N_REGIMES)]
    txt = [[f"{T[i][j]:.2f}" for j in range(N_REGIMES)] for i in range(N_REGIMES)]
    fig = go.Figure(go.Heatmap(
        z=T, x=labels, y=labels,
        colorscale=[[0, "#000000"], [0.5, "#993300"], [1, "#ff6600"]],
        zmin=0, zmax=1, showscale=True,
        text=txt, texttemplate="%{text}",
        textfont=dict(size=14, color="white"),
        hovertemplate="From %{y} -> %{x}: %{z:.3f}<extra></extra>",
    ))
    _dark(fig, "Transition Matrix  P( j | i )", h=400)
    fig.update_yaxes(autorange="reversed")
    return fig


# =====================================================================
# PANEL 4 — REGIME TIMELINE
# =====================================================================

def fig_timeline(dv, ticker):
    last = dv.iloc[-1]
    cur_r = int(last["regime"])
    title = (f"{ticker}  --  {REGIME_NAMES[cur_r]}  "
             f"({last['confidence']:.0%} confidence)")

    fig = go.Figure()
    fig.add_trace(go.Scatter(
        x=dv["date"], y=dv["close"], mode="lines",
        line=dict(color="white", width=1.3), name=ticker,
    ))

    # regime bands
    runs = []
    prev_r, start = None, None
    for idx in range(len(dv)):
        r = int(dv["regime"].iloc[idx])
        if r != prev_r:
            if prev_r is not None:
                runs.append((prev_r, start, dv["date"].iloc[idx - 1]))
            start = dv["date"].iloc[idx]
            prev_r = r
    if prev_r is not None:
        runs.append((prev_r, start, dv["date"].iloc[-1]))

    # batch all shapes in one update (add_vrect/add_vline loops are very
    # slow in Plotly 6.x because each call rebuilds the figure)
    shapes = []
    for r, x0, x1 in runs:
        shapes.append(dict(
            type="rect", xref="x", yref="paper",
            x0=x0, x1=x1, y0=0, y1=1,
            fillcolor=REGIME_COLORS[r], opacity=0.18,
            line_width=0, layer="below",
        ))
    for i in range(1, len(runs)):
        shapes.append(dict(
            type="line", xref="x", yref="paper",
            x0=runs[i][1], x1=runs[i][1], y0=0, y1=1,
            line=dict(dash="dot", color="#555", width=0.6),
        ))
    # v9.3: NBER recession / bear-market anchors (ground truth overlay).
    # Drawn as hatched red outlines above regime bands so misclassifications
    # during known crises are visible by eye.
    data_min, data_max = dv["date"].min(), dv["date"].max()
    for rec_start, rec_end in RECESSION_RANGES:
        r0 = pd.Timestamp(rec_start)
        r1 = pd.Timestamp(rec_end)
        # clip to chart window
        if r1 < data_min or r0 > data_max:
            continue
        r0 = max(r0, data_min)
        r1 = min(r1, data_max)
        shapes.append(dict(
            type="rect", xref="x", yref="paper",
            x0=r0, x1=r1, y0=0, y1=1,
            fillcolor="rgba(255,0,0,0.06)",
            line=dict(color="#ff3355", width=1.2, dash="dash"),
            layer="above",
        ))
    fig.update_layout(shapes=shapes)

    _dark(fig, title, h=370)
    fig.update_xaxes(title_text="Date", rangeslider=dict(visible=False))
    fig.update_yaxes(title_text="Price")
    return fig


# =====================================================================
# PANEL 5 — REGIME PROBABILITIES  (stacked area)
# =====================================================================

def fig_probabilities(dv):
    fig = go.Figure()
    # v9: explicit 6-regime iteration with defensive fill for missing cols
    #   (older cache rows may lack prob_4/prob_5 -> fall back to 0).
    #   Hidden zero-height traces still register in the legend.
    print(f"[probs-fig] v9.4: plotting {N_REGIMES} regimes  "
          f"cols={[c for c in dv.columns if c.startswith('prob_')]}")
    for r in reversed(range(N_REGIMES)):
        col = f"prob_{r}"
        y = (dv[col] if col in dv.columns
             else pd.Series(np.zeros(len(dv)), index=dv.index))
        fig.add_trace(go.Scatter(
            x=dv["date"], y=y,
            mode="lines", name=REGIME_NAMES[r],
            line=dict(width=0, color=REGIME_COLORS[r]),
            stackgroup="one", groupnorm="",
            fillcolor=REGIME_COLORS_RGBA[r].format(0.55),
            showlegend=True,
            hovertemplate=(f"{REGIME_NAMES[r]}: "
                           + "%{y:.1%}<extra></extra>"),
        ))
    _dark(fig, "Ensemble Probabilities Over Time", h=280)
    fig.update_yaxes(title_text="P(regime)", range=[0, 1])
    fig.update_xaxes(title_text="Date")
    return fig


# =====================================================================
# PANEL 6 — PERFORMANCE  (3 lines)
# =====================================================================

def fig_performance(dv, sm, bm, rm):
    fig = go.Figure()
    fig.add_trace(go.Scatter(
        x=dv["date"], y=dv["ens_eq"], mode="lines",
        line=dict(color="#00ff88", width=2), name="Ensemble",
    ))
    fig.add_trace(go.Scatter(
        x=dv["date"], y=dv["rule_eq"], mode="lines",
        line=dict(color="#ffaa00", width=1.5, dash="dash"),
        name="Rule-Only",
    ))
    fig.add_trace(go.Scatter(
        x=dv["date"], y=dv["bench_eq"], mode="lines",
        line=dict(color="#6666ff", width=1.3, dash="dot"),
        name="Buy & Hold",
    ))

    ann = (f"<b>Ensemble </b>  Sharpe {sm['sharpe']:.2f}   "
           f"MDD {sm['mdd']:.1%}   Return {sm['total']:.1%}<br>"
           f"<b>Rule-Only</b>  Sharpe {rm['sharpe']:.2f}   "
           f"MDD {rm['mdd']:.1%}   Return {rm['total']:.1%}<br>"
           f"<b>Buy&Hold </b>  Sharpe {bm['sharpe']:.2f}   "
           f"MDD {bm['mdd']:.1%}   Return {bm['total']:.1%}")
    fig.add_annotation(
        x=0.01, y=0.97, xref="paper", yref="paper",
        text=ann, showarrow=False, align="left",
        font=dict(color="#ddd", size=11, family="monospace"),
        bgcolor="rgba(10,10,10,0.85)", bordercolor="#333", borderwidth=1,
    )

    _dark(fig, "Cumulative Performance  "
          "(Ensemble vs Rule-Only vs Buy & Hold)", h=340)
    fig.update_xaxes(title_text="Date")
    fig.update_yaxes(title_text="Growth of $1")
    return fig


# =====================================================================
# BUILD ALL FIGURES
# =====================================================================

def build_all(df, ticker):
    dv = _valid(df)
    if dv.empty:
        empty = go.Figure()
        _dark(empty, "No data", 300)
        return {k: empty for k in
                ["phase", "graph", "heat", "time", "probs", "perf"]}, {}

    # ── equity curves on classified period (all start at $1) ────
    #    Probability-weighted sizing:  signal = sum(P(regime) * alloc)
    #    The probabilities already encode confidence: when the model is
    #    90% sure of Risk-Off, P(RiskOff)=0.90 dominates the weighted sum.
    #    Clipped to [-1.0, 1.0] to prevent leverage.
    dv = dv.copy()
    dv["daily_ret"] = dv["close"].pct_change().fillna(0)

    # ensemble: probability-weighted with dynamic VolTrend + v9 risk overlays
    raw_ens = _compute_raw_signal("prob", dv).clip(-1.0, 1.0)
    dv["sig_ens"] = (_apply_risk_overlays(raw_ens, dv["daily_ret"])
                     .shift(1).fillna(0))
    dv["ens_ret"] = dv["daily_ret"] * dv["sig_ens"]
    dv["ens_eq"]  = (1 + dv["ens_ret"]).cumprod()

    # rule-only (no risk overlays — kept as raw-regime baseline for comparison)
    dv["sig_rule"] = _compute_raw_signal("rule_prob", dv).clip(-1.0, 1.0).shift(1).fillna(0)
    dv["rule_ret"] = dv["daily_ret"] * dv["sig_rule"]
    dv["rule_eq"]  = (1 + dv["rule_ret"]).cumprod()

    # benchmark
    dv["bench_eq"] = (1 + dv["daily_ret"]).cumprod()

    T     = df.attrs.get("T_last", np.full((N_REGIMES, N_REGIMES), 1.0 / N_REGIMES))
    last  = dv.iloc[-1]
    cur   = int(last["regime"])
    probs = np.array([last[f"prob_{k}"] for k in range(N_REGIMES)])
    sm    = _metrics(dv["ens_ret"])
    bm    = _metrics(dv["daily_ret"])
    rm    = _metrics(dv["rule_ret"])

    # regime forecast  T^n
    cur_vec = np.zeros(N_REGIMES)
    cur_vec[cur] = 1.0
    fcast = {}
    for h in [1, 5, 10, 20]:
        fcast[h] = cur_vec @ np.linalg.matrix_power(T, h)

    # regime run stats
    ens_seq = dv["regime"].tolist()
    all_runs = _collect_runs(ens_seq)

    # days in current regime
    days_in = 0
    for x in reversed(ens_seq):
        if int(x) == cur:
            days_in += 1
        else:
            break

    # expected remaining duration
    exp_remain = estimate_remaining(all_runs.get(cur, []), days_in)

    info = {
        "cur": cur,
        "conf": last["confidence"],
        "days_in": days_in,
        "exp_remain": exp_remain,
        "fcast": fcast,
        "probs": probs,
        "T": T,
        "sm": sm,
        "bm": bm,
        "rm": rm,
        "has_hmm": df.attrs.get("has_hmm", False),
        "has_lstm": df.attrs.get("has_lstm", False),
        "has_trans": df.attrs.get("has_trans", False),
        "calibration": df.attrs.get("calibration", {}),
        "trans_metrics": df.attrs.get("trans_metrics", {}),
        "last_date": last["date"].strftime("%Y-%m-%d"),
        "tdir_n": float(last["tdir_n"]) if "tdir_n" in last
                  else float("nan"),
    }

    figs = {
        "phase": fig_phase_space(dv),
        "graph": fig_transition_graph(T, probs, cur),
        "heat":  fig_heatmap(T),
        "time":  fig_timeline(dv, ticker),
        "probs": fig_probabilities(dv),
        "perf":  fig_performance(dv, sm, bm, rm),
    }
    return figs, info


# =====================================================================
# DASHBOARD
# =====================================================================

app = dash.Dash(__name__, title="Market Regime Engine v9.4",
                update_title="Loading...")


def _kpi_card(title, value, color="#ccc", border="#333"):
    return html.Div(style={
        "backgroundColor": CARD_BG,
        "border": f"1px solid {border}",
        "borderTop": f"3px solid {border}",
        "borderRadius": "6px",
        "padding": "14px 18px",
        "flex": "1",
        "minWidth": "140px",
    }, children=[
        html.Div(title, style={"fontSize": "11px", "color": "#888",
                                "marginBottom": "4px",
                                "textTransform": "uppercase",
                                "letterSpacing": "1px"}),
        html.Div(value, style={"fontSize": "20px", "color": color,
                                "fontWeight": "bold"}),
    ])


# ------------------------------------------------------------------
# Hero panel — replaces the flat 9-card KPI row.
# Aim: give a one-glance read of "what regime, how sure, what to do".
# ------------------------------------------------------------------

def _confidence_meta(conf):
    """Map raw confidence -> (bar colour, short label).
    Three bands chosen to match the post-Phase-2.5 distribution:
      <50%   low      red
      50-70% moderate amber
      >=70%  high     green
    """
    if not np.isfinite(conf):
        return ("#666", "n/a")
    if conf < 0.50:
        return ("#ff6633", "low")
    if conf < 0.70:
        return ("#ffaa33", "moderate")
    return ("#00ff88", "high")


def _allocation_text(r, tdir_n):
    """Human-readable allocation for the current regime.
    Volatile Trend (regime 1) is the only dynamic case — its sizing
    depends on the trend direction feature (tdir_n)."""
    a = REGIME_ALLOC.get(r)
    if a is not None:
        return f"Target exposure: {a:+.0%}"
    # Volatile Trend — dynamic
    if not np.isfinite(tdir_n):
        return (f"Target exposure: dynamic "
                f"({VOLTRD_DOWN:+.0%} ↔ {VOLTRD_UP:+.0%})")
    if tdir_n >= VOLTRD_THRESH:
        return (f"Target exposure: {VOLTRD_UP:+.0%}  "
                f"(uptrend, tdir={tdir_n:.2f})")
    return (f"Target exposure: {VOLTRD_DOWN:+.0%}  "
            f"(downtrend, tdir={tdir_n:.2f})")


def _hero_panel(info, ticker):
    """Top-of-dashboard hero card.  Expects the dict produced by build_all."""
    r       = info["cur"]
    name    = REGIME_NAMES[r]
    rcol    = REGIME_COLORS[r]
    conf    = float(info.get("conf", float("nan")))
    if not np.isfinite(conf):
        conf = 0.0
    cbar_col, cbar_label = _confidence_meta(conf)
    desc    = REGIME_DESCRIPTIONS.get(r, "")
    action  = REGIME_ACTIONS_TEXT.get(r, "")
    alloc_t = _allocation_text(r, info.get("tdir_n", float("nan")))

    days_in    = info.get("days_in", 0)
    exp_remain = info.get("exp_remain")
    dur_text   = (f"~{exp_remain:.0f}d remaining"
                  if exp_remain is not None else "n/a")

    # forecasts
    f1 = info["fcast"][1]
    next_r = int(np.argmax(f1))
    next_p = float(f1[next_r])
    f5 = info["fcast"][5]
    f5_r = int(np.argmax(f5))
    f5_p = float(f5[f5_r])

    # secondary diagnostics
    sm    = info.get("sm", {}) or {}
    sharpe = sm.get("sharpe", float("nan"))

    calib = info.get("calibration", {}) or {}
    if "ece_cal_test" in calib:
        cal_text = (f"ECE {calib['ece_cal_test']:.3f} "
                    f"(raw {calib['ece_raw_test']:.3f})")
        cal_col = ("#00ff88"
                   if calib["ece_cal_test"] <= calib["ece_raw_test"]
                   else "#ffaa33")
    else:
        cal_text = "n/a"
        cal_col  = "#666"

    tm = info.get("trans_metrics", {}) or {}
    if "thr_0.5" in tm:
        m5 = tm["thr_0.5"]
        td_text = (f"F1 {m5['f1']:.2f}  "
                   f"(P {m5['precision']:.0%} / R {m5['recall']:.0%})")
        td_col = ("#00ff88" if m5["f1"] >= 0.55
                  else ("#ffaa33" if m5["f1"] >= 0.40 else "#ff6633"))
    else:
        td_text = "n/a"
        td_col  = "#666"

    parts = ["Rules"]
    if info.get("has_hmm"):   parts.append("HMM")
    if info.get("has_lstm"):  parts.append("LSTM+Attn")
    if info.get("has_trans"): parts.append("TransDet")
    model_tag = " + ".join(parts)

    sub_bg     = "#0d1014"
    border_col = "#1f242c"
    border_lt  = "#232934"

    # confidence bar
    conf_pct = max(0.0, min(1.0, conf)) * 100.0
    conf_bar = html.Div(style={
        "marginTop": "6px",
        "backgroundColor": "#1a1d23",
        "border": f"1px solid {border_lt}",
        "borderRadius": "4px",
        "height": "10px",
        "overflow": "hidden",
        "width": "100%",
    }, children=[
        html.Div(style={
            "width": f"{conf_pct:.1f}%",
            "height": "100%",
            "backgroundColor": cbar_col,
            "transition": "width 0.4s ease",
        }),
    ])

    # left half — regime headline + description + action
    left = html.Div(style={
        "flex": "1.4",
        "padding": "18px 22px",
        "borderLeft": f"4px solid {rcol}",
        "minWidth": "320px",
    }, children=[
        html.Div(f"{ticker}  •  {info.get('last_date','')}",
                 style={"fontSize": "11px", "color": "#7a8089",
                        "letterSpacing": "1px",
                        "textTransform": "uppercase",
                        "marginBottom": "6px"}),
        html.Div(name, style={
            "fontSize": "32px", "fontWeight": "bold",
            "color": rcol, "lineHeight": "1.1"}),
        html.Div(desc, style={
            "fontSize": "13px", "color": "#aab1ba",
            "fontStyle": "italic",
            "marginTop": "8px", "lineHeight": "1.4"}),

        html.Div(style={"marginTop": "16px"}, children=[
            html.Div([
                html.Span("Confidence ", style={"color": "#7a8089",
                                                "fontSize": "11px",
                                                "letterSpacing": "1px",
                                                "textTransform": "uppercase"}),
                html.Span(f"{conf*100:.0f}%",
                          style={"color": cbar_col, "fontWeight": "bold",
                                 "fontSize": "13px"}),
                html.Span(f"  ({cbar_label})",
                          style={"color": "#7a8089", "fontSize": "11px"}),
            ]),
            conf_bar,
        ]),

        html.Div(style={
            "marginTop": "16px",
            "padding": "10px 12px",
            "backgroundColor": sub_bg,
            "border": f"1px solid {border_col}",
            "borderRadius": "4px",
        }, children=[
            html.Div("Recommended action",
                     style={"fontSize": "10px", "color": "#7a8089",
                            "letterSpacing": "1px",
                            "textTransform": "uppercase",
                            "marginBottom": "4px"}),
            html.Div(action, style={"fontSize": "13px", "color": "#e8ecf1",
                                    "marginBottom": "4px"}),
            html.Div(alloc_t, style={"fontSize": "12px", "color": "#9aa3ad"}),
        ]),

        html.Div(style={
            "marginTop": "12px", "fontSize": "11px",
            "color": "#7a8089", "display": "flex", "gap": "16px",
            "flexWrap": "wrap",
        }, children=[
            html.Div([html.Span("Days in regime: ",
                                style={"color": "#7a8089"}),
                      html.Span(str(days_in),
                                style={"color": "#e8ecf1",
                                       "fontWeight": "bold"})]),
            html.Div([html.Span("Expected: ",
                                style={"color": "#7a8089"}),
                      html.Span(dur_text,
                                style={"color": "#e8ecf1",
                                       "fontWeight": "bold"})]),
            html.Div([html.Span("Models: ",
                                style={"color": "#7a8089"}),
                      html.Span(model_tag,
                                style={"color": "#e8ecf1"})]),
        ]),
    ])

    # right half — secondary stat grid
    def _stat(label, value, value_col="#e8ecf1"):
        return html.Div(style={
            "padding": "10px 12px",
            "backgroundColor": sub_bg,
            "border": f"1px solid {border_col}",
            "borderRadius": "4px",
        }, children=[
            html.Div(label, style={"fontSize": "10px",
                                    "color": "#7a8089",
                                    "letterSpacing": "1px",
                                    "textTransform": "uppercase",
                                    "marginBottom": "4px"}),
            html.Div(value, style={"fontSize": "14px",
                                    "color": value_col,
                                    "fontWeight": "bold"}),
        ])

    sharpe_text = f"{sharpe:.2f}" if np.isfinite(sharpe) else "n/a"
    sharpe_col  = ("#00ff88" if np.isfinite(sharpe) and sharpe >= 0.8
                   else ("#ffaa33" if np.isfinite(sharpe) and sharpe >= 0.4
                         else "#ff6633"))

    right = html.Div(style={
        "flex": "1",
        "padding": "18px 18px",
        "borderLeft": f"1px solid {border_col}",
        "display": "grid",
        "gridTemplateColumns": "1fr 1fr",
        "gap": "10px",
        "alignContent": "start",
        "minWidth": "300px",
    }, children=[
        _stat("Next-Bar Forecast",
              f"{REGIME_NAMES[next_r]}  ({next_p:.0%})",
              REGIME_COLORS[next_r]),
        _stat("5-Bar Forecast",
              f"{REGIME_NAMES[f5_r]}  ({f5_p:.0%})",
              REGIME_COLORS[f5_r]),
        _stat("Ensemble Sharpe", sharpe_text, sharpe_col),
        _stat("Calibration (OOS)", cal_text, cal_col),
        html.Div(style={"gridColumn": "1 / span 2"}, children=[
            _stat("Transition Detector", td_text, td_col),
        ]),
    ])

    return html.Div(style={
        "width": "100%",
        "backgroundColor": CARD_BG,
        "border": f"1px solid {border_col}",
        "borderRadius": "8px",
        "display": "flex",
        "flexWrap": "wrap",
        "boxShadow": "0 1px 0 rgba(255,255,255,0.02) inset",
        "overflow": "hidden",
    }, children=[left, right])


def make_layout():
    return html.Div(style={
        "backgroundColor": BG, "minHeight": "100vh",
        "padding": "16px 22px", "fontFamily": "monospace", "color": "#ccc",
    }, children=[

        # header row
        html.Div(style={"display": "flex", "alignItems": "center",
                         "gap": "16px", "marginBottom": "14px",
                         "flexWrap": "wrap"},
                  children=[
            html.H1("Market Regime Engine  v9.4",
                     style={"color": "#fff", "margin": "0",
                            "fontSize": "24px", "whiteSpace": "nowrap"}),
            dcc.Input(id="ticker-input", type="text",
                      value=DEFAULT_TICKER, debounce=True,
                      placeholder="Ticker...",
                      style={"backgroundColor": "#181818",
                             "color": "#fff", "border": "1px solid #444",
                             "borderRadius": "4px", "padding": "8px 14px",
                             "fontSize": "15px", "width": "120px",
                             "textTransform": "uppercase"}),
            html.Button("Load", id="load-btn", n_clicks=0,
                        style={"backgroundColor": "#00ff88",
                               "color": "#000", "border": "none",
                               "borderRadius": "4px",
                               "padding": "8px 22px", "cursor": "pointer",
                               "fontWeight": "bold", "fontSize": "14px"}),
            html.Button("\u21bb Refresh", id="refresh-btn", n_clicks=0,
                        style={"backgroundColor": "#333",
                               "color": "#ccc", "border": "1px solid #555",
                               "borderRadius": "4px",
                               "padding": "8px 18px", "cursor": "pointer",
                               "fontSize": "13px"}),
            html.Div("Click 'Load' to run the pipeline (~2 min first run, "
                     "cached thereafter).",
                     id="status-msg",
                     style={"fontSize": "12px", "color": "#888"}),
        ]),

        # KPI row
        html.Div(id="kpi-row",
                 style={"display": "flex", "gap": "10px",
                         "marginBottom": "12px", "flexWrap": "wrap"}),

        # timeline
        dcc.Loading(dcc.Graph(id="g-time"), type="circle",
                    color="#00ff88"),

        # probability area
        dcc.Loading(dcc.Graph(id="g-probs"), type="circle",
                    color="#00ff88"),

        # middle row — PCA / graph / heatmap
        html.Div(style={"display": "flex", "gap": "8px",
                         "marginBottom": "8px"},
                  children=[
            html.Div(dcc.Graph(id="g-phase"), style={"flex": "1"}),
            html.Div(dcc.Graph(id="g-graph"), style={"flex": "1"}),
            html.Div(dcc.Graph(id="g-heat"),  style={"flex": "1"}),
        ]),

        # performance
        dcc.Loading(dcc.Graph(id="g-perf"), type="circle",
                    color="#00ff88"),

        dcc.Store(id="cur-ticker", data=DEFAULT_TICKER),
    ])


app.layout = make_layout


@app.callback(
    [Output("kpi-row", "children"),
     Output("g-time",  "figure"),
     Output("g-probs", "figure"),
     Output("g-phase", "figure"),
     Output("g-graph", "figure"),
     Output("g-heat",  "figure"),
     Output("g-perf",  "figure"),
     Output("status-msg", "children"),
     Output("cur-ticker", "data")],
    [Input("load-btn", "n_clicks"),
     Input("refresh-btn", "n_clicks")],
    [State("ticker-input", "value"),
     State("cur-ticker", "data")],
    prevent_initial_call=True,
)
def update_all(n_load, n_refresh, ticker_val, stored_ticker):
    ctx = dash.callback_context
    trigger = (ctx.triggered[0]["prop_id"].split(".")[0]
               if ctx.triggered else "")
    if not trigger:
        # No explicit user action — don't launch the pipeline.  Prevents
        # Dash's initial render from kicking off a 2-min HMM+LSTM run
        # that the user's subsequent refreshes would duplicate.
        raise dash.exceptions.PreventUpdate

    if trigger == "load-btn":
        ticker = (ticker_val or DEFAULT_TICKER).upper().strip()
        force = True
    elif trigger == "refresh-btn":
        ticker = (stored_ticker or DEFAULT_TICKER).upper().strip()
        force = True
    else:
        # initial page load — use pre-loaded cache
        ticker = (stored_ticker or DEFAULT_TICKER).upper().strip()
        force = False

    try:
        df = get_data(ticker, force=force)
    except Exception as exc:
        import traceback
        empty = go.Figure()
        _dark(empty, "Error loading data", 300)
        msg = f"Error: {exc}\n{traceback.format_exc()}"
        print(f"[dashboard] get_data failed: {msg}", flush=True)
        return ([], empty, empty, empty, empty, empty, empty,
                msg, stored_ticker)

    try:
        figs, info = build_all(df, ticker)
    except Exception as exc:
        import traceback
        empty = go.Figure()
        _dark(empty, "Error in build_all", 300)
        msg = f"Error: {exc}\n{traceback.format_exc()}"
        print(f"[dashboard] build_all failed: {msg}", flush=True)
        return ([], empty, empty, empty, empty, empty, empty,
                msg, stored_ticker)

    # v9.3: emit full terminal summary + statistical validation
    # after every successful pipeline run.
    print(f"[dashboard] build_all done for {ticker} — "
          f"calling print_summary", flush=True)
    try:
        print_summary(df, ticker)
    except Exception as exc:
        import traceback
        print(f"[dashboard] print_summary failed: {exc}", flush=True)
        print(traceback.format_exc(), flush=True)

    if not info:
        empty = go.Figure()
        _dark(empty, "Insufficient data", 300)
        return ([_kpi_card("STATUS", "No data")],
                empty, empty, empty, empty, empty, empty,
                "No classified bars", ticker)

    # Hero panel handles everything the old 9-card row showed.
    kpis = [_hero_panel(info, ticker)]

    parts = ["Rules"]
    if info.get("has_hmm"):
        parts.append("HMM")
    if info.get("has_lstm"):
        parts.append("LSTM+Attn")
    if info.get("has_trans"):
        parts.append("TransDet")
    model_tag = "+".join(parts)

    status = f"{ticker}  |  {info['last_date']}  |  {model_tag}"

    return (kpis,
            figs["time"], figs["probs"], figs["phase"],
            figs["graph"], figs["heat"], figs["perf"],
            status, ticker)


# =====================================================================
# v9.4 CROSS-ASSET EVALUATION HARNESS
# =====================================================================

CROSS_ASSET_DEFAULT = ["SPY", "QQQ", "IWM", "DIA", "EFA", "GLD", "TLT"]


def _eval_one_ticker(ticker: str) -> dict:
    """Run pipeline on one ticker, return summary metrics."""
    df = get_data(ticker, force=False)
    v = df.dropna(subset=["regime"]).copy()
    if v.empty:
        return {"ticker": ticker, "error": "no classified bars"}
    v["regime"] = v["regime"].astype(int)

    v["daily_ret"] = v["close"].pct_change().fillna(0)
    raw_ens = _compute_raw_signal("prob", v).clip(-1.0, 1.0)
    v["sig_ens"] = (_apply_risk_overlays(raw_ens, v["daily_ret"])
                    .shift(1).fillna(0))
    v["strat_ret"] = v["daily_ret"] * v["sig_ens"]

    sm = _metrics(v["strat_ret"])
    bm = _metrics(v["daily_ret"])

    r = v["strat_ret"].dropna().values
    if len(r) > 0 and r.std() > 0:
        ann_ret = float(r.mean() * 252)
        mdd_abs = max(abs(sm["mdd"]), 1e-6)
        calmar = ann_ret / mdd_abs
    else:
        calmar = 0.0

    n_bars = len(v)
    crisis_pct = float((v["regime"] == 5).sum() / n_bars * 100)
    corr_pct   = float((v["regime"] == 4).sum() / n_bars * 100)
    churn_pct  = float((v["regime"] == 3).sum() / n_bars * 100)
    riskoff_pct = float(v["regime"].isin(RISKOFF_REGIMES).sum()
                        / n_bars * 100)

    rec_recall = None
    try:
        dates_ts = pd.to_datetime(v["date"])
        rec_mask = pd.Series(False, index=v.index)
        for r0, r1 in RECESSION_RANGES:
            rec_mask |= (dates_ts >= pd.Timestamp(r0)) & \
                        (dates_ts <= pd.Timestamp(r1))
        n_rec = int(rec_mask.sum())
        if n_rec > 0:
            hits = int(v.loc[rec_mask, "regime"]
                       .isin(RISKOFF_REGIMES).sum())
            rec_recall = hits / n_rec
    except Exception:
        pass

    return {
        "ticker": ticker,
        "bars": n_bars,
        "strat_sharpe": sm["sharpe"],
        "strat_mdd": sm["mdd"],
        "strat_ret": sm["total"],
        "strat_calmar": calmar,
        "bh_sharpe": bm["sharpe"],
        "bh_mdd": bm["mdd"],
        "bh_ret": bm["total"],
        "crisis_pct": crisis_pct,
        "corr_pct": corr_pct,
        "churn_pct": churn_pct,
        "riskoff_pct": riskoff_pct,
        "rec_recall": rec_recall,
    }


def run_cross_asset_eval(tickers=None):
    tickers = tickers or CROSS_ASSET_DEFAULT
    print("=" * 96)
    print(f"  CROSS-ASSET EVALUATION HARNESS  v9.4  "
          f"({len(tickers)} tickers)")
    print("=" * 96)
    rows = []
    for i, tk in enumerate(tickers, 1):
        print(f"\n[{i}/{len(tickers)}] {tk}  — running pipeline...",
              flush=True)
        try:
            row = _eval_one_ticker(tk)
            rows.append(row)
            if "error" in row:
                print(f"  skipped: {row['error']}", flush=True)
            else:
                print(f"  done  Sharpe={row['strat_sharpe']:.2f}  "
                      f"MDD={row['strat_mdd']:.1%}  "
                      f"Calmar={row['strat_calmar']:.2f}  "
                      f"Crisis={row['crisis_pct']:.1f}%",
                      flush=True)
        except Exception as exc:
            import traceback
            print(f"  FAILED: {exc}", flush=True)
            print(traceback.format_exc(), flush=True)
            rows.append({"ticker": tk, "error": str(exc)})

    ok = [r for r in rows if "error" not in r]
    if not ok:
        print("\nNo successful runs.")
        return rows

    print("\n" + "=" * 96)
    print("  COMPARISON TABLE  (strategy vs buy-and-hold)")
    print("=" * 96)
    hdr = (f"  {'Ticker':<7} {'Bars':>5} | "
           f"{'Shrp':>5} {'MDD':>7} {'Ret':>8} {'Calm':>6} | "
           f"{'bhShrp':>6} {'bhMDD':>7} {'bhRet':>8} | "
           f"{'Cris%':>5} {'Cor%':>5} {'Chu%':>5} "
           f"{'Rec.Rcl':>7}")
    print(hdr)
    print("  " + "-" * 94)
    for r in ok:
        rc = (f"{r['rec_recall']:.0%}" if r['rec_recall'] is not None
              else "  n/a")
        print(f"  {r['ticker']:<7} {r['bars']:>5} | "
              f"{r['strat_sharpe']:>5.2f} {r['strat_mdd']:>7.1%} "
              f"{r['strat_ret']:>8.1%} {r['strat_calmar']:>6.2f} | "
              f"{r['bh_sharpe']:>6.2f} {r['bh_mdd']:>7.1%} "
              f"{r['bh_ret']:>8.1%} | "
              f"{r['crisis_pct']:>4.1f}% {r['corr_pct']:>4.1f}% "
              f"{r['churn_pct']:>4.1f}% {rc:>7}")

    print("  " + "-" * 94)
    avg_s = np.mean([r["strat_sharpe"] for r in ok])
    avg_c = np.mean([r["strat_calmar"] for r in ok])
    avg_m = np.mean([r["strat_mdd"]    for r in ok])
    avg_b = np.mean([r["bh_sharpe"]    for r in ok])
    avg_bm = np.mean([r["bh_mdd"]       for r in ok])
    print(f"  {'AVG':<7} {'':>5} | "
          f"{avg_s:>5.2f} {avg_m:>7.1%} {'':>8} {avg_c:>6.2f} | "
          f"{avg_b:>6.2f} {avg_bm:>7.1%}")
    print("=" * 96 + "\n")
    return rows


# =====================================================================
# MAIN
# =====================================================================

if __name__ == "__main__":
    # v9.4: CLI dispatcher
    # Usage:
    #   python regime_dashboard.py              -> dashboard
    #   python regime_dashboard.py cross-asset  -> cross-asset eval
    #   python regime_dashboard.py cross-asset SPY QQQ TLT -> custom list
    if len(sys.argv) > 1 and sys.argv[1] == "cross-asset":
        extras = [t.upper() for t in sys.argv[2:]]
        run_cross_asset_eval(extras or None)
        sys.exit(0)

    print("-" * 64)
    print("  Market Regime Classification Engine  v9.4")
    print(f"  21 features | {N_REGIMES} regimes | online HMM (K={HMM_N_STATES}, full cov)")
    print(f"  EWMA vol (lam={EWMA_LAM_MED}/{EWMA_LAM_LONG}/{EWMA_LAM_YEARLY}) — no rolling-window cliffs")
    print(f"  directional ADX (t_up / t_down) — distinguishes bull from bear trends")
    print(f"  ensemble: rules={ENS_W_RULES} hmm={ENS_W_HMM} lstm={ENS_W_LSTM}  entropy_mix={ENS_ENTROPY_MIX}")
    print(f"  softmax temp={SOFTMAX_TEMP}  persist={MIN_PERSIST}  hyst={HYSTERESIS_THRESH}")
    print("  LSTM+Attn (soft HMM labels) | TransDet (HMM-weighted, OOS F1)")
    print("  Isotonic calibration | OOS ECE + Brier diagnostics")
    print("-" * 64)
    print(f"\n[1/1] Dashboard -> http://localhost:{DASH_PORT}")
    print("  Dashboard loads INSTANTLY. Click 'Load' to fetch any ticker.")
    print("  Full pipeline (HMM+LSTM+Trans) runs on-demand (2-3 min).")
    print("  Press Ctrl+C to stop.\n")
    app.run(debug=False, port=DASH_PORT, host="0.0.0.0")
