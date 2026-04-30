"""ChromaDB-backed RAG layer over SEC EDGAR filings. The collection is
populated once via ``ingest_edgar.py``; query time is ~10–50ms for top-k=5
on a few hundred MB of chunks. Embeddings are produced locally with a
sentence-transformer so the entire pipeline can claim "no data leaves the
device" — central to the demo's privacy story.
"""

from __future__ import annotations

import os
from functools import lru_cache
from typing import Iterable

import chromadb
from chromadb.config import Settings
from sentence_transformers import SentenceTransformer


COLLECTION = "sec_edgar"
EMBED_MODEL_NAME = os.environ.get("RAG_EMBED_MODEL", "BAAI/bge-small-en-v1.5")
CHROMA_DIR = os.environ.get("CHROMA_DIR", "./chroma_db")


@lru_cache(maxsize=1)
def _client() -> chromadb.PersistentClient:
    return chromadb.PersistentClient(path=CHROMA_DIR, settings=Settings(anonymized_telemetry=False))


@lru_cache(maxsize=1)
def _embedder() -> SentenceTransformer:
    # bge-small is 33M params and runs comfortably on CPU; bge-base is 109M
    # and benefits from GPU. Either way it's local and free.
    return SentenceTransformer(EMBED_MODEL_NAME)


def get_collection() -> chromadb.Collection:
    """Idempotent: returns the collection, creating it if absent. The
    ingestion script and the query path both go through this."""
    return _client().get_or_create_collection(name=COLLECTION, metadata={"hnsw:space": "cosine"})


def add_chunks(chunks: list[dict]) -> int:
    """Embed and upsert a list of chunks. Each chunk dict needs:
        id (str), text (str), and any other metadata (ticker, filing_type,
        fiscal_period, section, url).
    """
    if not chunks:
        return 0
    coll = get_collection()
    texts = [c["text"] for c in chunks]
    ids = [c["id"] for c in chunks]
    metadatas = [{k: v for k, v in c.items() if k not in ("id", "text") and v is not None} for c in chunks]
    embeddings = _embedder().encode(texts, normalize_embeddings=True, show_progress_bar=False).tolist()
    coll.upsert(ids=ids, documents=texts, metadatas=metadatas, embeddings=embeddings)
    return len(chunks)


def search(query: str, k: int = 5, ticker: str | None = None) -> list[dict]:
    """Top-k cosine-similar chunks. Returns rich dicts ready for a tool-call
    response — the LLM gets ticker, filing_type, fiscal_period, section, the
    chunk text, and a similarity score so it can decide which to cite."""
    coll = get_collection()
    q_emb = _embedder().encode([query], normalize_embeddings=True).tolist()
    where = {"ticker": ticker.upper()} if ticker else None
    res = coll.query(query_embeddings=q_emb, n_results=max(1, min(k, 25)), where=where)
    out = []
    if not res or not res.get("ids") or not res["ids"][0]:
        return out
    for i, doc_id in enumerate(res["ids"][0]):
        meta = (res.get("metadatas") or [[{}]])[0][i] or {}
        # Chroma returns distances; convert to a [0..1] similarity score.
        dist = (res.get("distances") or [[0.0]])[0][i]
        score = max(0.0, 1.0 - float(dist))
        out.append({
            "id": doc_id,
            "score": round(score, 4),
            "ticker": meta.get("ticker"),
            "filing_type": meta.get("filing_type"),
            "fiscal_period": meta.get("fiscal_period"),
            "section": meta.get("section"),
            "url": meta.get("url"),
            "text": (res.get("documents") or [[""]])[0][i],
        })
    return out


def stats() -> dict:
    coll = get_collection()
    return {"count": coll.count(), "embed_model": EMBED_MODEL_NAME, "store": CHROMA_DIR}
