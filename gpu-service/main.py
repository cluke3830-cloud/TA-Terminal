"""FastAPI front door for the gpu-service. Exposes:

  POST /mc/run        — Monte Carlo option pricing on MI300X (ROCm via PyTorch)
  POST /rag/search    — top-k cosine over the SEC EDGAR ChromaDB collection
  POST /finbert/score — FinBERT (ProsusAI/finbert) sentiment scoring
  GET  /health        — device + model + chunk-count snapshot

Run on the MI300X box::

    uvicorn main:app --host 0.0.0.0 --port 8000

The Next.js app proxies to this service via MC_GPU_URL and RAG_URL. vLLM
runs as a separate process (``vllm serve …``) on the same machine — it does
not live in this codebase.
"""

from __future__ import annotations

import threading
from typing import List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

import mc as mc_mod
import rag as rag_mod
import finbert as finbert_mod


app = FastAPI(title="Quantum Terminal · gpu-service")

# CORS open to anything by default since this service sits behind the Next.js
# proxy. Tighten via env var in production.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Schemas ────────────────────────────────────────────────────────────────
class MCRequest(BaseModel):
    optionType: str = Field(default="asian", description="asian | barrier | lookback | american | european")
    S0: float
    K: float
    T: float = Field(description="Years to expiry (e.g. 30/365 for 30 days)")
    r: float = Field(description="Risk-free rate (decimal, e.g. 0.045)")
    sigma: float = Field(description="Volatility (decimal, e.g. 0.42)")
    paths: int = 1_000_000
    steps: int = 252
    barrier: Optional[float] = None
    isCall: bool = True


class RAGRequest(BaseModel):
    query: str
    k: int = 5
    ticker: Optional[str] = None


class FinBERTRequest(BaseModel):
    texts: List[str] = Field(default_factory=list)


# Warm FinBERT in the background so the first user call doesn't pay the
# HuggingFace download cost. Failures are swallowed by finbert.warm().
threading.Thread(target=finbert_mod.warm, daemon=True).start()


# ── Routes ─────────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    import torch
    info = {
        "ok": True,
        "device": str(mc_mod.DEVICE),
        "torch": torch.__version__,
        "cuda_visible": torch.cuda.is_available(),
        "gpu_name": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
    }
    try:
        info["rag"] = rag_mod.stats()
    except Exception as e:
        info["rag_error"] = str(e)
    try:
        info["finbert"] = finbert_mod.health()
    except Exception as e:
        info["finbert_error"] = str(e)
    return info


@app.post("/mc/run")
def mc_run(req: MCRequest):
    try:
        result = mc_mod.price_mc(
            option_type=req.optionType,
            S0=req.S0, K=req.K, T=req.T, r=req.r, sigma=req.sigma,
            paths=req.paths, steps=req.steps,
            barrier=req.barrier, is_call=req.isCall,
        )
        return result.to_dict()
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"{type(e).__name__}: {e}")


@app.post("/rag/search")
def rag_search(req: RAGRequest):
    if not req.query or not req.query.strip():
        raise HTTPException(status_code=400, detail="query is required")
    try:
        return {"results": rag_mod.search(req.query, k=req.k, ticker=req.ticker)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"{type(e).__name__}: {e}")


@app.post("/finbert/score")
def finbert_score(req: FinBERTRequest):
    cleaned = [t for t in (req.texts or []) if t and t.strip()]
    if not cleaned:
        return {"results": []}
    try:
        return {"results": finbert_mod.score(cleaned)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"{type(e).__name__}: {e}")
