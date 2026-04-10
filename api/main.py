"""
main.py — Claude Memory Hub FastAPI backend (v2.3.0)

Endpoints:
    GET  /api/health    — liveness probe (no auth required)
    POST /api/sync      — upsert a memory entry from a client machine
    POST /api/search    — full-text + tag search across all entries
    GET  /api/entries   — list entries with optional filters
    GET  /api/stats     — capacity and distribution stats

Authentication: X-API-Key header
Client identity: X-Client-CN header injected by nginx mTLS layer (not user-settable)
"""
import os
import logging
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException, Header, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import text

from scrubber import scrub_entry

# ── Configuration ──────────────────────────────────────────────────────────────
DATABASE_URL = os.environ["DATABASE_URL"]
API_KEY      = os.environ["API_KEY"]
LOG_LEVEL    = os.environ.get("LOG_LEVEL", "info").upper()

logging.basicConfig(level=getattr(logging, LOG_LEVEL, logging.INFO))
logger = logging.getLogger("memory-hub")

# ── Database ───────────────────────────────────────────────────────────────────
engine = create_async_engine(DATABASE_URL, pool_size=5, max_overflow=10, echo=False)
AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Memory Hub API starting — v2.3.0")
    yield
    await engine.dispose()
    logger.info("Memory Hub API shut down")


app = FastAPI(title="Claude Memory Hub", version="2.3.0", lifespan=lifespan)


# ── Auth ───────────────────────────────────────────────────────────────────────
async def verify_api_key(x_api_key: str = Header(...)):
    if x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session


# ── Request / Response Models ──────────────────────────────────────────────────
class EntryIn(BaseModel):
    local_entry_id:          str
    title:                   str
    category:                str
    subcategory:             str | None = None
    type:                    str = "learning"
    severity:                str = "minor"
    recurrence_count:        int = 1
    successful_applications: int = 0
    confidence_score:        float = Field(0.1, ge=0.0, le=1.0)
    tags:                    list[str] = []
    trigger_context:         str | None = None
    root_cause:              str | None = None
    what_happened:           str | None = None
    correct_solution:        str | None = None
    prevention_rule:         str | None = None
    context_notes:           str | None = None
    related_files:           list[str] = []
    related_entries:         list[str] = []
    content_hash:            str | None = None
    first_seen:              str | None = None  # ISO date string
    last_seen:               str | None = None  # ISO date string


class SearchRequest(BaseModel):
    query:      str = ""
    tags:       list[str] = []
    category:   str | None = None
    machine_id: str | None = None
    limit:      int = Field(20, ge=1, le=100)


# ── Endpoints ──────────────────────────────────────────────────────────────────
@app.get("/api/health")
async def health():
    return {"status": "ok", "version": "2.3.0"}


@app.get("/api/token")
async def get_token():
    """Return API key for dashboard bootstrap.
    No X-API-Key required — mTLS client cert authentication is sufficient.
    Only mTLS-authenticated clients can reach this endpoint via nginx."""
    return {"key": API_KEY}


@app.get("/api/machines", dependencies=[Depends(verify_api_key)])
async def list_machines(db: AsyncSession = Depends(get_db)):
    """List all distinct machine IDs for filter dropdowns."""
    result = await db.execute(text(
        "SELECT DISTINCT machine_id FROM entries WHERE status='active' ORDER BY machine_id"
    ))
    return {"machines": [r[0] for r in result.all()]}


@app.get("/api/categories", dependencies=[Depends(verify_api_key)])
async def list_categories(db: AsyncSession = Depends(get_db)):
    """List categories with active entry counts for filter dropdowns."""
    result = await db.execute(text("""
        SELECT category, COUNT(*) AS count
        FROM entries WHERE status = 'active'
        GROUP BY category ORDER BY count DESC
    """))
    return {"categories": [{"category": r[0], "count": r[1]} for r in result.all()]}


@app.post("/api/sync", dependencies=[Depends(verify_api_key)])
async def sync_entry(
    entry: EntryIn,
    db: AsyncSession = Depends(get_db),
    x_client_cn: str = Header(default="unknown"),
):
    """Upsert a single memory entry. machine_id is taken from the mTLS client CN."""
    data = scrub_entry(entry.model_dump())
    machine_id = x_client_cn

    try:
        result = await db.execute(
            text("""
                SELECT upsert_entry(
                    :machine_id, :local_entry_id, :title, :category, :subcategory,
                    :type, :severity, :recurrence_count, :successful_applications,
                    :confidence_score, :tags, :trigger_context, :root_cause,
                    :what_happened, :correct_solution, :prevention_rule,
                    :context_notes, :related_files, :related_entries,
                    :content_hash,
                    CAST(:first_seen AS DATE),
                    CAST(:last_seen  AS DATE)
                )
            """),
            {
                "machine_id":              machine_id,
                "local_entry_id":          data["local_entry_id"],
                "title":                   data["title"],
                "category":                data["category"],
                "subcategory":             data.get("subcategory"),
                "type":                    data["type"],
                "severity":                data["severity"],
                "recurrence_count":        data["recurrence_count"],
                "successful_applications": data["successful_applications"],
                "confidence_score":        data["confidence_score"],
                "tags":                    data["tags"],
                "trigger_context":         data.get("trigger_context"),
                "root_cause":              data.get("root_cause"),
                "what_happened":           data.get("what_happened"),
                "correct_solution":        data.get("correct_solution"),
                "prevention_rule":         data.get("prevention_rule"),
                "context_notes":           data.get("context_notes"),
                "related_files":           data.get("related_files", []),
                "related_entries":         data.get("related_entries", []),
                "content_hash":            data.get("content_hash"),
                "first_seen":              data.get("first_seen"),
                "last_seen":               data.get("last_seen"),
            },
        )
        entry_id = result.scalar_one()
        await db.commit()
        logger.info("sync ok: machine=%s entry=%s id=%s", machine_id, data["local_entry_id"], entry_id)
        return {"id": str(entry_id), "status": "ok"}
    except Exception as exc:
        await db.rollback()
        logger.error("sync error for %s/%s: %s", machine_id, data.get("local_entry_id"), exc)
        raise HTTPException(status_code=500, detail="Sync failed") from exc


@app.post("/api/search", dependencies=[Depends(verify_api_key)])
async def search_entries(req: SearchRequest, db: AsyncSession = Depends(get_db)):
    """Full-text + tag search. Ranked by recurrence, then confidence, then recency."""
    conditions = ["status = 'active'"]
    params: dict[str, Any] = {"limit": req.limit}

    if req.query:
        conditions.append(
            "to_tsvector('english', coalesce(title,'') || ' ' || coalesce(trigger_context,'') "
            "|| ' ' || coalesce(what_happened,'') || ' ' || coalesce(prevention_rule,'')) "
            "@@ plainto_tsquery('english', :query)"
        )
        params["query"] = req.query

    if req.tags:
        conditions.append("tags && :tags::text[]")
        params["tags"] = req.tags

    if req.category:
        conditions.append("category = :category")
        params["category"] = req.category

    if req.machine_id:
        conditions.append("machine_id = :machine_id")
        params["machine_id"] = req.machine_id

    where = " AND ".join(conditions)
    result = await db.execute(
        text(f"""
            SELECT id, machine_id, local_entry_id, title, category, subcategory,
                   type, severity, recurrence_count, confidence_score, tags,
                   trigger_context, prevention_rule, last_seen, updated_at
            FROM entries
            WHERE {where}
            ORDER BY recurrence_count DESC, confidence_score DESC, last_seen DESC
            LIMIT :limit
        """),
        params,
    )
    rows = result.mappings().all()
    return {"results": [dict(r) for r in rows], "count": len(rows)}


@app.get("/api/entries", dependencies=[Depends(verify_api_key)])
async def list_entries(
    db: AsyncSession = Depends(get_db),
    machine_id: str | None = Query(None),
    category:   str | None = Query(None),
    status:     str        = Query("active"),
    limit:      int        = Query(50, ge=1, le=500),
    offset:     int        = Query(0, ge=0),
):
    """List entries with optional filters."""
    conditions = ["status = :status"]
    params: dict[str, Any] = {"status": status, "limit": limit, "offset": offset}

    if machine_id:
        conditions.append("machine_id = :machine_id")
        params["machine_id"] = machine_id
    if category:
        conditions.append("category = :category")
        params["category"] = category

    where = " AND ".join(conditions)
    result = await db.execute(
        text(f"""
            SELECT * FROM entries
            WHERE {where}
            ORDER BY last_seen DESC
            LIMIT :limit OFFSET :offset
        """),
        params,
    )
    rows = result.mappings().all()
    return {"entries": [dict(r) for r in rows], "count": len(rows)}


@app.get("/api/stats", dependencies=[Depends(verify_api_key)])
async def get_stats(db: AsyncSession = Depends(get_db)):
    """Hub capacity and distribution stats."""
    result = await db.execute(text("""
        SELECT
            COUNT(*) FILTER (WHERE status = 'active')   AS active,
            COUNT(*) FILTER (WHERE status = 'archived') AS archived,
            COUNT(DISTINCT machine_id)                  AS machines,
            COUNT(DISTINCT category)                    AS categories,
            MAX(updated_at)                             AS last_sync
        FROM entries
    """))
    row = dict(result.mappings().one())
    row["capacity_pct"] = round(float(row["active"] or 0) / 500 * 100, 1)
    return row
