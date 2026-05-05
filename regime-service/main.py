"""Lightweight FastAPI wrapping the regime engine for CPU-only hosting (Render).

Exposes:
  POST /regime/run   — run / return cached regime payload for a ticker
  GET  /health       — service liveness + cached tickers

No GPU deps. PyTorch is optional — if absent the engine runs HMM-only mode
(HAS_LSTM=False) which still produces all 6-regime outputs.

Start:
    uvicorn main:app --host 0.0.0.0 --port $PORT
"""

from __future__ import annotations

import threading

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import regime as regime_mod

app = FastAPI(title="Quantum Terminal · regime-service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class RegimeRequest(BaseModel):
    ticker: str = "SPY"
    force: bool = False


# Pre-warm SPY so the first browser hit returns from cache.
threading.Thread(target=regime_mod.warm, daemon=True).start()


@app.get("/health")
def health():
    return {"ok": True, "regime": regime_mod.health()}


@app.post("/regime/run")
def regime_run(req: RegimeRequest):
    ticker = (req.ticker or "SPY").upper().strip()
    if not ticker:
        raise HTTPException(status_code=400, detail="ticker is required")
    try:
        return regime_mod.compute(ticker, force=req.force)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"{type(e).__name__}: {e}")
