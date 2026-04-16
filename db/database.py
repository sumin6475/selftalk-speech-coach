import os
import uuid
from datetime import datetime, timezone

import certifi
from motor.motor_asyncio import AsyncIOMotorClient

from db.models import INDEXES

DB_NAME = "selftalk"

_client: AsyncIOMotorClient | None = None
_db = None


def _get_db():
    global _client, _db
    if _db is None:
        uri = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
        _client = AsyncIOMotorClient(uri, tlsCAFile=certifi.where())
        _db = _client[DB_NAME]
    return _db


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _doc(doc: dict | None) -> dict | None:
    """Remove MongoDB _id from document for API compatibility."""
    if doc and "_id" in doc:
        doc.pop("_id")
    return doc


async def init_db():
    db = _get_db()
    for coll_name, keys, opts in INDEXES:
        await db[coll_name].create_index(keys, **opts)


# ── Sessions ──


async def create_session(
    reference_text: str | None = None,
    scenario: str = "persuade",
    reference_text_original: str | None = None,
    reference_text_transformed: str | None = None,
    reference_transform_mode: str | None = None,
    beta_flags: str | None = None,
    coaching_style: str = "guide",
    mode: str = "coaching",
    practice_mode: str = "conversation",
) -> dict:
    db = _get_db()
    session = {
        "id": str(uuid.uuid4()),
        "title": None,
        "mode": mode,
        "practice_mode": practice_mode,
        "scenario": scenario,
        "reference_text": reference_text,
        "reference_text_original": reference_text_original,
        "reference_text_transformed": reference_text_transformed,
        "reference_transform_mode": reference_transform_mode,
        "status": "active",
        "created_at": _now_iso(),
        "ended_at": None,
        "duration_seconds": None,
        "summary": None,
        "beta_flags": beta_flags,
        "coaching_style": coaching_style,
    }
    await db.sessions.insert_one(session)
    return _doc(session)


async def list_sessions() -> list[dict]:
    db = _get_db()
    cursor = db.sessions.find().sort("created_at", -1)
    return [_doc(doc) async for doc in cursor]


async def get_session(session_id: str) -> dict | None:
    db = _get_db()
    doc = await db.sessions.find_one({"id": session_id})
    return _doc(doc)


async def update_session_title(session_id: str, title: str):
    db = _get_db()
    await db.sessions.update_one({"id": session_id}, {"$set": {"title": title}})


async def end_session(session_id: str, duration_seconds: int):
    db = _get_db()
    await db.sessions.update_one(
        {"id": session_id},
        {"$set": {
            "status": "completed",
            "ended_at": _now_iso(),
            "duration_seconds": duration_seconds,
        }},
    )


async def update_session_summary(session_id: str, summary_json: str):
    db = _get_db()
    await db.sessions.update_one({"id": session_id}, {"$set": {"summary": summary_json}})


async def delete_session(session_id: str):
    db = _get_db()
    await db.drill_expression_usage.delete_many({"session_id": session_id})
    await db.reports.delete_many({"session_id": session_id})
    await db.checklist_items.delete_many({"session_id": session_id})
    await db.transcripts.delete_many({"session_id": session_id})
    await db.sessions.delete_one({"id": session_id})


async def update_session_status(session_id: str, status: str):
    db = _get_db()
    await db.sessions.update_one({"id": session_id}, {"$set": {"status": status}})


# ── Transcripts ──


async def save_transcript(session_id: str, role: str, content: str):
    db = _get_db()
    await db.transcripts.insert_one({
        "session_id": session_id,
        "role": role,
        "content": content,
        "timestamp": _now_iso(),
    })


async def get_transcripts(session_id: str) -> list[dict]:
    db = _get_db()
    cursor = db.transcripts.find({"session_id": session_id}).sort("timestamp", 1)
    return [_doc(doc) async for doc in cursor]


# ── Checklist ──

CHECKLIST_DEFS = {
    "persuade": [
        ("State your proposal", '"I propose / suggest..."'),
        ("Reason 1", "Frame as listener benefit"),
        ("Reason 2", "Frame as listener benefit"),
        ("Preempt objection", '"You might worry about..."'),
        ("Call to action", '"Let\'s decide on ~ by ~"'),
    ],
    "explain": [
        ("One-line summary", '"In short, it\'s..."'),
        ("Background / context", '"Why this matters..."'),
        ("Core explanation", "Use analogy or contrast"),
        ("So what?", '"What this means is..."'),
    ],
    "storytelling": [
        ("Open with a scene", "Time, place, situation"),
        ("Tension / problem", '"That\'s when ~ became..."'),
        ("Action and turning point", '"So what I did was..."'),
        ("Lesson / transformation", '"Since then, I..."'),
    ],
}


async def populate_checklist(session_id: str, scenario: str):
    items = CHECKLIST_DEFS.get(scenario, [])
    if not items:
        return
    db = _get_db()
    docs = [
        {
            "session_id": session_id,
            "item_index": i,
            "label": label,
            "description": desc,
            "checked": 0,
            "checked_at": None,
        }
        for i, (label, desc) in enumerate(items)
    ]
    await db.checklist_items.insert_many(docs)


async def update_checklist_item(session_id: str, item_index: int, checked: bool):
    db = _get_db()
    update = {"$set": {"checked": 1 if checked else 0}}
    if checked:
        update["$set"]["checked_at"] = _now_iso()
    else:
        update["$set"]["checked_at"] = None
    await db.checklist_items.update_one(
        {"session_id": session_id, "item_index": item_index},
        update,
    )


async def get_checklist(session_id: str) -> list[dict]:
    db = _get_db()
    cursor = db.checklist_items.find({"session_id": session_id}).sort("item_index", 1)
    return [_doc(doc) async for doc in cursor]


# ── Reports ──


async def create_report(session_id: str, file_path: str) -> dict:
    db = _get_db()
    report = {
        "id": str(uuid.uuid4()),
        "session_id": session_id,
        "file_path": file_path,
        "created_at": _now_iso(),
    }
    await db.reports.insert_one(report)
    return _doc(report)


async def get_report_by_session(session_id: str) -> dict | None:
    db = _get_db()
    doc = await db.reports.find_one(
        {"session_id": session_id},
        sort=[("created_at", -1)],
    )
    return _doc(doc)


# ── Notes ──


async def create_note(title: str = "", content: str = "") -> dict:
    db = _get_db()
    now = _now_iso()
    note = {
        "id": str(uuid.uuid4()),
        "title": title,
        "content": content,
        "created_at": now,
        "updated_at": now,
    }
    await db.notes.insert_one(note)
    return _doc(note)


async def list_notes() -> list[dict]:
    db = _get_db()
    cursor = db.notes.find().sort("updated_at", -1)
    return [_doc(doc) async for doc in cursor]


async def update_note(note_id: str, title: str | None = None, content: str | None = None) -> dict | None:
    db = _get_db()
    update_fields = {"updated_at": _now_iso()}
    if title is not None:
        update_fields["title"] = title
    if content is not None:
        update_fields["content"] = content
    await db.notes.update_one({"id": note_id}, {"$set": update_fields})
    doc = await db.notes.find_one({"id": note_id})
    return _doc(doc)


async def delete_note(note_id: str):
    db = _get_db()
    await db.notes.delete_one({"id": note_id})


# ── Drill Expressions ──


async def create_drill_expression(expression: str, hint: str | None = None) -> dict:
    db = _get_db()
    doc = {
        "id": str(uuid.uuid4()),
        "expression": expression,
        "hint": hint,
        "created_at": _now_iso(),
    }
    await db.drill_expressions.insert_one(doc)
    return _doc(doc)


async def list_drill_expressions() -> list[dict]:
    db = _get_db()
    cursor = db.drill_expressions.find().sort("created_at", -1)
    return [_doc(d) async for d in cursor]


async def delete_drill_expression(expr_id: str):
    db = _get_db()
    await db.drill_expressions.delete_one({"id": expr_id})


async def populate_drill_expressions(session_id: str, expression_ids: list[str]):
    if not expression_ids:
        return
    db = _get_db()
    docs = []
    for expr_id in expression_ids:
        expr = await db.drill_expressions.find_one({"id": expr_id})
        if expr:
            docs.append({
                "session_id": session_id,
                "expression_id": expr["id"],
                "expression_text": expr["expression"],
                "hint": expr.get("hint"),
                "use_count": 0,
                "first_used_at": None,
                "last_used_at": None,
            })
    if docs:
        await db.drill_expression_usage.insert_many(docs)


async def increment_drill_expression_usage(session_id: str, expression_id: str):
    db = _get_db()
    now = _now_iso()
    # Look up library expression to snapshot text/hint into the per-session record.
    expr = await db.drill_expressions.find_one({"id": expression_id})
    if not expr:
        return
    # Upsert per-session usage: creates the doc on first use, increments count on subsequent uses.
    await db.drill_expression_usage.update_one(
        {"session_id": session_id, "expression_id": expression_id},
        {
            "$inc": {"use_count": 1},
            "$set": {"last_used_at": now},
            "$setOnInsert": {
                "expression_text": expr["expression"],
                "hint": expr.get("hint"),
                "first_used_at": now,
            },
        },
        upsert=True,
    )


async def get_drill_expression_usage(session_id: str) -> list[dict]:
    db = _get_db()
    cursor = db.drill_expression_usage.find({"session_id": session_id})
    return [_doc(d) async for d in cursor]
