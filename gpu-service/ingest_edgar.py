"""One-shot SEC EDGAR ingestion. Pulls the most recent 10-K and 10-Q filings
for a curated ticker set, chunks the text, embeds locally, and writes to the
ChromaDB collection used by ``rag.py``.

Usage (run on the MI300X box, but works fine on any machine — embedding is
local CPU/GPU agnostic)::

    pip install -r requirements.txt
    python ingest_edgar.py                       # all 50 default tickers
    python ingest_edgar.py NVDA AMD AAPL         # subset
    python ingest_edgar.py --filings 6           # last 6 filings each

EDGAR rules: include a contact ``User-Agent`` header (set ``EDGAR_UA`` env)
and stay under 10 req/s. The script throttles to ~5 req/s to be safe.
"""

from __future__ import annotations

import argparse
import os
import re
import time
from typing import Iterable

import requests
from bs4 import BeautifulSoup
from tqdm import tqdm

import rag as rag_mod


DEFAULT_TICKERS = [
    "NVDA", "AMD", "AAPL", "MSFT", "GOOGL", "META", "AMZN", "TSLA", "AVGO", "NFLX",
    "JPM", "BAC", "WFC", "GS", "MS", "V", "MA", "BLK", "C", "AXP",
    "XOM", "CVX", "COP", "SLB", "EOG",
    "JNJ", "LLY", "PFE", "ABBV", "MRK", "TMO", "UNH",
    "WMT", "HD", "COST", "TGT", "MCD", "SBUX",
    "BA", "CAT", "GE", "HON", "RTX",
    "PG", "KO", "PEP", "PM", "MO",
    "T", "VZ", "CMCSA", "DIS",
]
EDGAR_UA = os.environ.get("EDGAR_UA", "Quantum Terminal Demo contact@example.com")
HEADERS = {"User-Agent": EDGAR_UA, "Accept-Encoding": "gzip, deflate"}
SLEEP = 0.22  # ~4.5 req/s, well under the 10 req/s ceiling


def _ticker_to_cik(ticker: str) -> str | None:
    r = requests.get("https://www.sec.gov/files/company_tickers.json", headers=HEADERS, timeout=15)
    r.raise_for_status()
    j = r.json()
    t = ticker.upper()
    for entry in j.values():
        if entry.get("ticker", "").upper() == t:
            return str(entry.get("cik_str", "")).zfill(10)
    return None


def _list_filings(cik: str, forms: tuple[str, ...] = ("10-K", "10-Q"), limit: int = 4) -> list[dict]:
    url = f"https://data.sec.gov/submissions/CIK{cik}.json"
    r = requests.get(url, headers=HEADERS, timeout=15)
    r.raise_for_status()
    j = r.json()
    recent = j.get("filings", {}).get("recent", {})
    out = []
    for i, form in enumerate(recent.get("form", [])):
        if form not in forms:
            continue
        out.append({
            "form": form,
            "accession": recent["accessionNumber"][i],
            "primary_doc": recent["primaryDocument"][i],
            "report_date": recent.get("reportDate", [None] * len(recent["form"]))[i],
            "filing_date": recent.get("filingDate", [None] * len(recent["form"]))[i],
        })
        if len(out) >= limit:
            break
    return out


def _fetch_filing_text(cik: str, accession: str, primary_doc: str) -> str:
    accession_clean = accession.replace("-", "")
    url = f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{accession_clean}/{primary_doc}"
    r = requests.get(url, headers=HEADERS, timeout=30)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "lxml")
    for tag in soup(["script", "style", "table"]):
        tag.decompose()
    text = soup.get_text("\n")
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    return text.strip()


def _chunk(text: str, chunk_chars: int = 2400, overlap: int = 200) -> list[str]:
    """~2400 chars ≈ ~600 tokens — good fit for bge-small's 512-token window
    with a small overlap so cross-section facts aren't split."""
    chunks = []
    i = 0
    n = len(text)
    while i < n:
        j = min(i + chunk_chars, n)
        chunks.append(text[i:j])
        if j >= n:
            break
        i = j - overlap
    return chunks


def ingest_ticker(ticker: str, max_filings: int = 4) -> int:
    cik = _ticker_to_cik(ticker)
    if not cik:
        print(f"  [skip] no CIK for {ticker}")
        return 0
    time.sleep(SLEEP)
    filings = _list_filings(cik, limit=max_filings)
    total = 0
    for f in filings:
        time.sleep(SLEEP)
        try:
            text = _fetch_filing_text(cik, f["accession"], f["primary_doc"])
        except Exception as e:
            print(f"  [warn] {ticker} {f['form']} {f['accession']}: {e}")
            continue
        if not text:
            continue
        pieces = _chunk(text)
        chunk_records = []
        for idx, piece in enumerate(pieces):
            chunk_records.append({
                "id": f"{ticker}-{f['accession']}-{idx}",
                "text": piece,
                "ticker": ticker.upper(),
                "filing_type": f["form"],
                "fiscal_period": f["report_date"] or f["filing_date"],
                "section": f"chunk-{idx}",
                "url": f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{f['accession'].replace('-', '')}/{f['primary_doc']}",
            })
        added = rag_mod.add_chunks(chunk_records)
        total += added
        print(f"  [+ {added:>4} chunks] {ticker} {f['form']} {f.get('report_date') or f.get('filing_date')}")
    return total


def main(tickers: Iterable[str], max_filings: int = 4) -> None:
    grand = 0
    for t in tqdm(list(tickers), desc="Tickers"):
        grand += ingest_ticker(t, max_filings=max_filings)
    print(f"Done. {grand} chunks total. Stats: {rag_mod.stats()}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Ingest SEC EDGAR filings into ChromaDB.")
    parser.add_argument("tickers", nargs="*", help="Tickers to ingest. Empty = default 50.")
    parser.add_argument("--filings", type=int, default=4, help="Max filings per ticker (default 4).")
    args = parser.parse_args()
    main(args.tickers or DEFAULT_TICKERS, max_filings=args.filings)
