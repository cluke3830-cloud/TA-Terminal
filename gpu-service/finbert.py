"""FinBERT (ProsusAI/finbert) sentiment scoring on the MI300X.

Lazy-loads the model on first call to keep healthchecks fast. Inference is
batched at BATCH_SIZE forward passes; the whole headline firehose for a single
ticker (5–10 items) typically fits in one pass.

Label order from FinBERT logits is [positive, negative, neutral].
"""

from __future__ import annotations

import os
import threading
from typing import List, Dict, Any, Optional

import torch

_MODEL_NAME = os.environ.get("FINBERT_MODEL", "ProsusAI/finbert")
_BATCH_SIZE = int(os.environ.get("FINBERT_BATCH", "32"))
_DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

_lock = threading.Lock()
_loaded: Dict[str, Any] = {"tok": None, "model": None}


def _load() -> None:
    if _loaded["model"] is not None:
        return
    with _lock:
        if _loaded["model"] is not None:
            return
        from transformers import AutoTokenizer, AutoModelForSequenceClassification
        tok = AutoTokenizer.from_pretrained(_MODEL_NAME)
        model = AutoModelForSequenceClassification.from_pretrained(_MODEL_NAME)
        model.to(_DEVICE).eval()
        _loaded["tok"] = tok
        _loaded["model"] = model


def warm() -> None:
    """Trigger model download/load. Safe to call from a startup background
    thread — failures are swallowed so the service still boots if HF is
    unreachable. The first user request will then retry."""
    try:
        _load()
        # One warm forward pass.
        score(["AMD beat earnings estimates."])
    except Exception:
        pass


@torch.inference_mode()
def score(texts: List[str]) -> List[Dict[str, Any]]:
    if not texts:
        return []
    _load()
    tok = _loaded["tok"]
    model = _loaded["model"]
    out: List[Dict[str, Any]] = []
    for i in range(0, len(texts), _BATCH_SIZE):
        batch = texts[i : i + _BATCH_SIZE]
        enc = tok(batch, padding=True, truncation=True, max_length=128, return_tensors="pt").to(_DEVICE)
        logits = model(**enc).logits
        probs = logits.softmax(dim=-1).detach().cpu().numpy()
        # FinBERT label index: 0=positive, 1=negative, 2=neutral.
        labels = ["positive", "negative", "neutral"]
        for p in probs:
            idx = int(p.argmax())
            out.append({
                "label": labels[idx],
                "score": float(p[idx]),
                "positive": float(p[0]),
                "negative": float(p[1]),
                "neutral": float(p[2]),
            })
    return out


def health() -> Dict[str, Any]:
    return {
        "model": _MODEL_NAME,
        "device": _DEVICE,
        "loaded": _loaded["model"] is not None,
        "batch_size": _BATCH_SIZE,
    }