"""PyTorch Monte Carlo option pricer. Runs on the MI300X via ROCm (PyTorch
exposes ROCm as ``cuda``) — falls back to CPU if no accelerator is visible so
the same code can be smoke-tested on a laptop.

The hot loop is a single matmul-shaped operation: a (paths, steps) Brownian
matrix, accumulated in log-space, exponentiated, then reduced to a payoff per
path. ``torch.cumsum`` and ``torch.randn`` make the whole thing one fused GPU
kernel — exactly the shape MI300X's HBM bandwidth was built for.
"""

from __future__ import annotations

import math
import time
from dataclasses import dataclass
from typing import Optional

import torch


# Pick the best device once at import. ROCm is exposed as 'cuda' in PyTorch's
# device API, so this works for both AMD and NVIDIA accelerators. CPU fallback
# means the file imports cleanly on a dev laptop with no GPU.
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
DTYPE = torch.float32


@dataclass
class MCResult:
    price: float
    stderr: float
    runtime_ms: float
    paths_per_sec: float
    paths_used: int
    source: str

    def to_dict(self) -> dict:
        return {
            "price": self.price,
            "stderr": self.stderr,
            "runtimeMs": self.runtime_ms,
            "pathsPerSec": self.paths_per_sec,
            "pathsUsed": self.paths_used,
            "source": self.source,
        }


def _gen_paths(S0: float, r: float, sigma: float, T: float, paths: int, steps: int) -> torch.Tensor:
    """Returns (paths, steps) tensor of simulated stock prices via GBM."""
    dt = T / steps
    drift = (r - 0.5 * sigma * sigma) * dt
    diff = sigma * math.sqrt(dt)
    Z = torch.randn(paths, steps, device=DEVICE, dtype=DTYPE)
    log_returns = drift + diff * Z
    log_paths = torch.cumsum(log_returns, dim=1)
    return S0 * torch.exp(log_paths)


def _lsm_american(S: torch.Tensor, K: float, r: float, dt: float, is_call: bool) -> torch.Tensor:
    """Longstaff–Schwartz on-GPU. Polynomial basis [1, S, S^2]. Returns the
    pathwise payoff (already discounted to t=0) so the caller only has to mean.
    """
    paths, steps = S.shape
    disc = math.exp(-r * dt)
    if is_call:
        payoff = torch.clamp(S - K, min=0.0)
    else:
        payoff = torch.clamp(K - S, min=0.0)

    # Cashflow at terminal step
    cashflow = payoff[:, -1].clone()

    # Backward induction
    for t in range(steps - 2, -1, -1):
        cashflow = cashflow * disc
        s_t = S[:, t]
        intrinsic = payoff[:, t]
        itm = intrinsic > 0
        if itm.sum().item() < 4:
            continue
        # Regression on ITM paths
        x = s_t[itm]
        y = cashflow[itm]
        X = torch.stack([torch.ones_like(x), x, x * x], dim=1)  # (n, 3)
        # Solve normal equations: (X^T X) beta = X^T y
        XtX = X.t() @ X
        Xty = X.t() @ y
        try:
            beta = torch.linalg.solve(XtX, Xty)
        except Exception:
            continue
        cont = beta[0] + beta[1] * x + beta[2] * x * x
        exercise = intrinsic[itm] > cont
        # Where exercise is optimal, replace cashflow with intrinsic
        # Otherwise keep the discounted future cashflow
        new = torch.where(exercise, intrinsic[itm], y)
        cashflow = cashflow.clone()
        cashflow[itm] = new
    return cashflow


def price_mc(
    *,
    option_type: str,
    S0: float,
    K: float,
    T: float,
    r: float,
    sigma: float,
    paths: int = 1_000_000,
    steps: int = 252,
    barrier: Optional[float] = None,
    is_call: bool = True,
) -> MCResult:
    paths = max(1, int(paths))
    steps = max(1, int(steps))
    option_type = (option_type or "asian").lower()

    if DEVICE.type == "cuda":
        torch.cuda.synchronize()
    t0 = time.perf_counter()

    S = _gen_paths(S0, r, sigma, T, paths, steps)

    if option_type == "asian":
        terminal = S.mean(dim=1)
    elif option_type == "lookback":
        terminal = S.max(dim=1).values if is_call else S.min(dim=1).values
    elif option_type == "barrier":
        if barrier is None:
            raise ValueError("barrier required for barrier option")
        if is_call:
            breached = (S >= barrier).any(dim=1)
        else:
            breached = (S <= barrier).any(dim=1)
        terminal = torch.where(breached, torch.zeros_like(S[:, -1]), S[:, -1])
    elif option_type == "european":
        terminal = S[:, -1]
    elif option_type == "american":
        # LSM handles the discounting itself — return its pathwise payoff and
        # skip the global discount below.
        cashflow = _lsm_american(S, K, r, T / steps, is_call)
        if DEVICE.type == "cuda":
            torch.cuda.synchronize()
        runtime_ms = (time.perf_counter() - t0) * 1000.0
        price = cashflow.mean().item()
        stderr = (cashflow.std().item() / math.sqrt(paths)) if paths > 1 else 0.0
        return MCResult(
            price=price, stderr=stderr,
            runtime_ms=runtime_ms,
            paths_per_sec=paths * steps / max(runtime_ms / 1000.0, 1e-9),
            paths_used=paths,
            source=("mi300x" if DEVICE.type == "cuda" else "cpu-torch"),
        )
    else:
        raise ValueError(f"unknown option_type: {option_type}")

    if is_call:
        payoff = torch.clamp(terminal - K, min=0.0)
    else:
        payoff = torch.clamp(K - terminal, min=0.0)

    disc = math.exp(-r * T)
    price = (disc * payoff.mean()).item()
    stderr = (disc * payoff.std().item() / math.sqrt(paths)) if paths > 1 else 0.0

    if DEVICE.type == "cuda":
        torch.cuda.synchronize()
    runtime_ms = (time.perf_counter() - t0) * 1000.0

    return MCResult(
        price=price, stderr=stderr,
        runtime_ms=runtime_ms,
        paths_per_sec=paths * steps / max(runtime_ms / 1000.0, 1e-9),
        paths_used=paths,
        source=("mi300x" if DEVICE.type == "cuda" else "cpu-torch"),
    )
