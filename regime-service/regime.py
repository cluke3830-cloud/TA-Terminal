"""Thin JSON wrapper around regime_dashboard.py.

Loads the standalone Dash engine that lives at the repo root and exposes
its pipeline + figures as a JSON payload that the Next.js /regime page
can consume directly via window.Plotly.

Public surface:
  compute(ticker, force=False) -> dict
  warm()                       -> None   (called on FastAPI startup)
  health()                     -> dict
"""

from __future__ import annotations

import math
import os
import sys
import threading
import time
import traceback
from typing import Any

import numpy as np
import plotly.io as pio


# ── Locate regime_dashboard.py at the repo root ───────────────────────
_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)
_REGIME_PATH = os.environ.get("REGIME_DASHBOARD_DIR", _ROOT)
if _REGIME_PATH not in sys.path:
    sys.path.insert(0, _REGIME_PATH)

# Imported lazily so a missing dep produces a clear error at /regime/run
# call time instead of crashing the whole gpu-service on import.
_rd = None
_IMPORT_ERR: Exception | None = None


def _load() -> Any:
    global _rd, _IMPORT_ERR
    if _rd is not None:
        return _rd
    try:
        import regime_dashboard as rd  # type: ignore
        _rd = rd
        return rd
    except Exception as exc:
        _IMPORT_ERR = exc
        raise


# ── JSON sanitisation ─────────────────────────────────────────────────
def _scrub(o: Any) -> Any:
    """Recursively map numpy / NaN / Inf into JSON-safe Python."""
    if o is None:
        return None
    if isinstance(o, dict):
        return {str(k): _scrub(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_scrub(v) for v in o]
    if isinstance(o, np.ndarray):
        return _scrub(o.tolist())
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.floating,)):
        f = float(o)
        return None if not math.isfinite(f) else f
    if isinstance(o, float):
        return None if not math.isfinite(o) else o
    return o


def _fig_to_json(fig: Any) -> dict:
    """Plotly figure -> plain dict ready for Plotly.newPlot on the JS side."""
    import json
    return json.loads(pio.to_json(fig, validate=False))


def _meta(rd: Any) -> dict:
    """Pull regime constants the React page needs to render the hero card."""
    return {
        "regimeNames":        {int(k): v for k, v in rd.REGIME_NAMES.items()},
        "regimeColors":       {int(k): v for k, v in rd.REGIME_COLORS.items()},
        "regimeDescriptions": {int(k): v for k, v in rd.REGIME_DESCRIPTIONS.items()},
        "regimeActions":      {int(k): v for k, v in rd.REGIME_ACTIONS_TEXT.items()},
        "regimeAlloc":        {int(k): v for k, v in rd.REGIME_ALLOC.items()},
        "voltrdUp":           rd.VOLTRD_UP,
        "voltrdDown":         rd.VOLTRD_DOWN,
        "voltrdThresh":       rd.VOLTRD_THRESH,
        "nRegimes":           rd.N_REGIMES,
        "version":            "v9.4",
    }


# ── Cached computed payloads (separate from rd._CACHE which holds DataFrames) ─
_LAST_PAYLOAD: dict[str, dict] = {}
_LAST_LOCK = threading.Lock()
_PAYLOAD_TTL = 3600  # match rd.CACHE_TTL


def compute(ticker: str, force: bool = False) -> dict:
    rd = _load()
    ticker = (ticker or rd.DEFAULT_TICKER).upper().strip()

    with _LAST_LOCK:
        cached = _LAST_PAYLOAD.get(ticker)
    if cached and not force and (time.time() - cached["computedAt"]) < _PAYLOAD_TTL:
        return cached

    df = rd.get_data(ticker, force=force)
    figs, info = rd.build_all(df, ticker)

    figs_json = {k: _fig_to_json(v) for k, v in figs.items()}

    payload = {
        "ticker": ticker,
        "info":   _scrub(info),
        "figs":   _scrub(figs_json),
        "meta":   _meta(rd),
        "computedAt": time.time(),
    }

    with _LAST_LOCK:
        _LAST_PAYLOAD[ticker] = payload
    return payload


def warm(tickers: tuple[str, ...] = ("SPY",)) -> None:
    """Pre-compute common tickers in the background so the first user
    click on /regime returns instantly. Failures are swallowed so a missing
    optional dep doesn't take the FastAPI process down."""
    for t in tickers:
        try:
            compute(t)
        except Exception as exc:
            print(f"[regime.warm] {t}: {type(exc).__name__}: {exc}", flush=True)
            traceback.print_exc()


def health() -> dict:
    try:
        rd = _load()
    except Exception as exc:
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}"}

    cached = sorted(_LAST_PAYLOAD.keys())
    return {
        "ok":          True,
        "nRegimes":    rd.N_REGIMES,
        "cached":      cached,
        "hasHmm":      getattr(rd, "HAS_HMM", False),
        "hasLstm":     getattr(rd, "HAS_LSTM", False),
        "hasFred":     getattr(rd, "HAS_FRED", False),
        "hasScipy":    getattr(rd, "HAS_SCIPY", False),
    }