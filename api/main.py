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
import hashlib
import os
import logging
import secrets
from contextlib import asynccontextmanager
from datetime import date, datetime
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


# ── Database session dependency ────────────────────────────────────────────────
async def get_db():
    async with AsyncSessionLocal() as session:
        yield session


# ── Auth ───────────────────────────────────────────────────────────────────────
async def verify_api_key(
    x_api_key:   str          = Header(...),
    x_client_cn: str          = Header(default="unknown"),
    db:          AsyncSession = Depends(get_db),
):
    """Authenticate by hashed per-client key with env API_KEY as bootstrap fallback.

    AUDIT-016: looks up SHA-256(x_api_key) in client_keys WHERE revoked_at IS NULL.
    On match, updates last_used_at. On miss, falls back to env API_KEY so legacy
    clients keep working during the migration window. Final miss logs to
    auth_failures and raises 401.
    """
    key_hash = hashlib.sha256(x_api_key.encode()).hexdigest()

    result = await db.execute(
        text(
            "SELECT id FROM client_keys "
            "WHERE key_hash = :key_hash AND revoked_at IS NULL"
        ),
        {"key_hash": key_hash},
    )
    row = result.first()
    if row is not None:
        await db.execute(
            text("UPDATE client_keys SET last_used_at = now() WHERE id = :id"),
            {"id": row[0]},
        )
        await db.commit()
        return

    # Bootstrap fallback: env API_KEY stays valid until the operator retires it.
    if x_api_key == API_KEY:
        return

    # Neither path matched — record the failure and reject.
    try:
        await db.execute(
            text(
                "INSERT INTO auth_failures (attempted_cn, reason) "
                "VALUES (:cn, :reason)"
            ),
            {"cn": x_client_cn or "unknown", "reason": "invalid key"},
        )
        await db.commit()
    except Exception:
        await db.rollback()
    raise HTTPException(status_code=401, detail="Invalid API key")


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
    client_type:             str = "claude-code"


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

    # Normalize ISO date strings → datetime.date; default to today if missing.
    # asyncpg requires a Python date for PG DATE columns; plain strings raise
    # DataError. Stored columns are NOT NULL so None is not an option.
    def _to_date(v: Any) -> date:
        if isinstance(v, date):
            return v
        if isinstance(v, str) and v:
            try:
                return date.fromisoformat(v)
            except ValueError:
                return datetime.fromisoformat(v.replace("Z", "+00:00")).date()
        return date.today()

    first_seen_d = _to_date(data.get("first_seen"))
    last_seen_d  = _to_date(data.get("last_seen"))

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
                    :first_seen,
                    :last_seen,
                    :client_type
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
                "first_seen":              first_seen_d,
                "last_seen":               last_seen_d,
                "client_type":             data.get("client_type", "claude-code"),
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


@app.get("/api/friction-points", dependencies=[Depends(verify_api_key)])
async def friction_points(
    db: AsyncSession = Depends(get_db),
    limit:       int        = Query(20, ge=1, le=100),
    client_type: str | None = Query(None),
):
    """Known recurring problems that aren't yet reliably solved."""
    conditions = [
        "status = 'active'",
        "recurrence_count >= 3",
        "confidence_score < 0.5",
    ]
    params: dict[str, Any] = {"limit": limit}

    if client_type:
        conditions.append("client_type = :client_type")
        params["client_type"] = client_type

    where = " AND ".join(conditions)
    result = await db.execute(
        text(f"""
            SELECT id, machine_id, title, category, recurrence_count, confidence_score,
                   trigger_context, last_seen
            FROM entries
            WHERE {where}
            ORDER BY recurrence_count DESC, confidence_score ASC
            LIMIT :limit
        """),
        params,
    )
    rows = result.mappings().all()
    return {"results": [dict(r) for r in rows], "count": len(rows)}


@app.get("/api/cross-machine-overlap", dependencies=[Depends(verify_api_key)])
async def cross_machine_overlap(
    db: AsyncSession = Depends(get_db),
    limit: int = Query(20, ge=1, le=100),
):
    """Identify learnings that appear on multiple machines via content_hash."""
    result = await db.execute(
        text("""
            WITH hash_groups AS (
                SELECT content_hash,
                       COUNT(DISTINCT machine_id)    AS machine_count,
                       array_agg(DISTINCT machine_id) AS machines,
                       array_agg(id::text)            AS entry_ids,
                       MIN(title)                     AS sample_title
                FROM entries
                WHERE status = 'active' AND content_hash IS NOT NULL
                GROUP BY content_hash
                HAVING COUNT(DISTINCT machine_id) >= 2
            )
            SELECT content_hash, machine_count, machines, entry_ids, sample_title
            FROM hash_groups
            ORDER BY machine_count DESC
            LIMIT :limit
        """),
        {"limit": limit},
    )
    rows = result.mappings().all()
    return {"overlaps": [dict(r) for r in rows], "count": len(rows)}


@app.get("/api/trends", dependencies=[Depends(verify_api_key)])
async def trends(
    db: AsyncSession = Depends(get_db),
    category:    str | None = Query(None),
    days:        int        = Query(30, ge=1, le=365),
    client_type: str | None = Query(None),
):
    """Time-series of new entries per day over the last N days."""
    conditions = [
        "status = 'active'",
        "first_seen >= CURRENT_DATE - make_interval(days => :days)",
    ]
    params: dict[str, Any] = {"days": days}

    if category:
        conditions.append("category = :category")
        params["category"] = category
    if client_type:
        conditions.append("client_type = :client_type")
        params["client_type"] = client_type

    where = " AND ".join(conditions)
    result = await db.execute(
        text(f"""
            SELECT first_seen AS date, COUNT(*) AS count
            FROM entries
            WHERE {where}
            GROUP BY first_seen
            ORDER BY first_seen ASC
        """),
        params,
    )
    rows = result.mappings().all()
    trends_list = [{"date": r["date"].isoformat() if r["date"] else None, "count": r["count"]} for r in rows]
    total = sum(r["count"] for r in rows)
    return {"trends": trends_list, "total": total, "days": days}


# ── Admin: per-client API keys (AUDIT-016) ─────────────────────────────────────
class ClientKeyCreate(BaseModel):
    client_cn:   str
    description: str | None = None


@app.post("/api/admin/keys", dependencies=[Depends(verify_api_key)])
async def create_client_key(
    body: ClientKeyCreate,
    db: AsyncSession = Depends(get_db),
):
    """Create a per-client API key and return the plaintext ONCE.

    WARNING: the plaintext key is returned exactly once — it is never recoverable
    after this response. Only the SHA-256 hash is stored server-side.
    """
    plaintext = secrets.token_urlsafe(32)
    key_hash  = hashlib.sha256(plaintext.encode()).hexdigest()
    try:
        result = await db.execute(
            text(
                "INSERT INTO client_keys (key_hash, client_cn, description) "
                "VALUES (:key_hash, :client_cn, :description) "
                "RETURNING id, client_cn"
            ),
            {
                "key_hash":    key_hash,
                "client_cn":   body.client_cn,
                "description": body.description,
            },
        )
        row = result.mappings().one()
        await db.commit()
    except Exception as exc:
        await db.rollback()
        logger.error("create_client_key failed for %s: %s", body.client_cn, exc)
        raise HTTPException(status_code=500, detail="Could not create key") from exc
    return {"id": str(row["id"]), "client_cn": row["client_cn"], "key": plaintext}


@app.get("/api/admin/keys", dependencies=[Depends(verify_api_key)])
async def list_client_keys(db: AsyncSession = Depends(get_db)):
    """List per-client API key metadata. Hashes are never exposed."""
    result = await db.execute(
        text(
            "SELECT id, client_cn, description, created_at, revoked_at, last_used_at "
            "FROM client_keys ORDER BY created_at DESC"
        )
    )
    rows = result.mappings().all()
    keys = [
        {
            "id":           str(r["id"]),
            "client_cn":    r["client_cn"],
            "description":  r["description"],
            "created_at":   r["created_at"].isoformat() if r["created_at"] else None,
            "revoked_at":   r["revoked_at"].isoformat() if r["revoked_at"] else None,
            "last_used_at": r["last_used_at"].isoformat() if r["last_used_at"] else None,
        }
        for r in rows
    ]
    return {"keys": keys, "count": len(keys)}


@app.post("/api/admin/keys/{key_id}/revoke", dependencies=[Depends(verify_api_key)])
async def revoke_client_key(key_id: str, db: AsyncSession = Depends(get_db)):
    """Revoke a per-client key by setting revoked_at = now(). Additive, not destructive."""
    try:
        result = await db.execute(
            text(
                "UPDATE client_keys SET revoked_at = now() "
                "WHERE id = :id AND revoked_at IS NULL "
                "RETURNING id, revoked_at"
            ),
            {"id": key_id},
        )
        row = result.mappings().first()
        await db.commit()
    except Exception as exc:
        await db.rollback()
        logger.error("revoke_client_key failed for %s: %s", key_id, exc)
        raise HTTPException(status_code=500, detail="Could not revoke key") from exc
    if row is None:
        raise HTTPException(status_code=404, detail="Key not found or already revoked")
    return {
        "id":         str(row["id"]),
        "revoked_at": row["revoked_at"].isoformat() if row["revoked_at"] else None,
    }
