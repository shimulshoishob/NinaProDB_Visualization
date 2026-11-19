"""Storage for the study features: one small, validated CRUD layer shared by every study resource.

Resources are declared in RESOURCES (columns + types). The API layer never builds SQL from user input:
column names come from this whitelist and every value is a bound parameter.
"""
import json
import re
import time
import uuid
from datetime import date, timedelta

import store
from store import LOCK, conn

# column types: sN = string (max N chars), t = long text, i = int, f = float, b = bool, d = date (YYYY-MM-DD or empty), j = list of strings, id = id or empty
RESOURCES = {
    "subjects": dict(cols={"name": "s80", "color": "s9", "position": "i"}, order="position, name COLLATE NOCASE"),
    "notes": dict(cols={"title": "s200", "body": "t", "subject_id": "id", "tags": "j", "pinned": "b"}, order="pinned DESC, updated DESC"),
    "snippets": dict(cols={"title": "s200", "language": "s40", "code": "t", "subject_id": "id", "tags": "j"}, order="updated DESC"),
    "questions": dict(cols={"question": "t", "answer": "t", "subject_id": "id", "difficulty": "s10", "source": "s300", "box": "i", "due": "d", "last_reviewed": "f"},
                      order="due IS NULL, due, created"),
    "todos": dict(cols={"title": "s300", "done": "b", "due": "d", "subject_id": "id", "priority": "i", "completed_at": "f"},
                  order="done, due IS NULL, due, priority DESC, created"),
    "goals": dict(cols={"title": "s200", "kind": "s20", "target": "i", "period": "s10", "subject_id": "id", "active": "b"}, order="active DESC, created"),
    "sessions": dict(cols={"minutes": "i", "subject_id": "id", "kind": "s20", "note": "s300", "day": "d"}, order="day DESC, created DESC"),
    "reminders": dict(cols={"title": "s300", "due": "d", "subject_id": "id", "file_id": "id", "done": "b"}, order="done, due IS NULL, due"),
    "exams": dict(cols={"name": "s200", "date": "d", "subject_id": "id"}, order="date IS NULL, date"),
    "checklist": dict(cols={"exam_id": "id", "text": "s300", "done": "b", "position": "i"}, order="position, created"),
    "collections": dict(cols={"name": "s100"}, order="name COLLATE NOCASE"),
}
REQUIRED = {"subjects": ["name"], "todos": ["title"], "goals": ["title"], "sessions": ["minutes"], "reminders": ["title"],
            "exams": ["name"], "checklist": ["exam_id", "text"], "collections": ["name"]}
JSON_COLS = {"tags"}
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
INTERVALS = [0, 1, 3, 7, 14, 30]           # days until the next review for box 0..5 (Leitner system)


class Invalid(ValueError):
    """Raised for bad input; the API turns it into a 400 response."""


def today():
    """Today's date as YYYY-MM-DD (local time)."""
    return date.today().isoformat()


def _coerce(kind, value):
    if kind == "t":
        return str(value or "")[:100_000]
    if kind[0] == "s":
        return str(value if value is not None else "").strip()[:int(kind[1:])]
    if kind == "i":
        try:
            return int(value or 0)
        except (TypeError, ValueError):
            raise Invalid("A number was expected.") from None
    if kind == "f":
        return None if value in (None, "") else float(value)
    if kind == "b":
        return 1 if value in (True, 1, "1", "true") else 0
    if kind == "d":
        v = str(value or "").strip()
        if v and not DATE_RE.match(v):
            raise Invalid("Dates must look like 2026-05-31.")
        return v or None
    if kind == "j":
        if not isinstance(value, list):
            raise Invalid("A list of tags was expected.")
        tags = []
        for raw in value:
            t = str(raw).strip().lower()[:30]
            if t and t not in tags:
                tags.append(t)
        return json.dumps(tags[:30])
    if kind == "id":
        return str(value).strip()[:40] or None if value not in (None, "") else None
    raise Invalid("Unknown column type.")


def _clean(resource, data, creating):
    spec = RESOURCES[resource]["cols"]
    out = {}
    for col, kind in spec.items():
        if col in data:
            out[col] = _coerce(kind, data[col])
    if creating:
        for col in REQUIRED.get(resource, []):
            if not out.get(col):
                raise Invalid(f"“{col}” is required.")
    elif not out:
        raise Invalid("Nothing to update.")
    return out


def _out(resource, r):
    d = dict(r)
    for col in JSON_COLS & set(d):
        d[col] = json.loads(d[col] or "[]")
    for col, kind in RESOURCES[resource]["cols"].items():
        if kind == "b" and col in d:
            d[col] = bool(d[col])
    return d


def list_(resource, where=None, limit=1000):
    """All rows of a resource, optionally filtered by column equality."""
    sql, args = f"SELECT * FROM {resource}", []
    if where:
        sql += " WHERE " + " AND ".join(f"{c}=?" for c in where)          # column names come from code, never from the request
        args = list(where.values())
    sql += f" ORDER BY {RESOURCES[resource]['order']} LIMIT ?"
    with LOCK:
        return [_out(resource, r) for r in conn().execute(sql, args + [limit])]


def get(resource, rid):
    """One row of a resource by id, or None."""
    with LOCK:
        r = conn().execute(f"SELECT * FROM {resource} WHERE id=?", (rid,)).fetchone()
        return _out(resource, r) if r else None


def add(resource, data):
    """Validate and insert a row; returns it. Raises Invalid for bad input."""
    vals = _clean(resource, data, True)
    if resource == "sessions":
        vals.setdefault("day", today())
        vals["day"] = vals["day"] or today()
        if vals["minutes"] <= 0 or vals["minutes"] > 24 * 60:
            raise Invalid("Minutes must be between 1 and 1440.")
    if resource == "todos" and vals.get("done"):
        vals["completed_at"] = time.time()
    rid, now = uuid.uuid4().hex[:12], time.time()
    cols = ["id", *vals, "created", "updated"]
    with LOCK:
        c = conn()
        try:
            c.execute(f"INSERT INTO {resource} ({','.join(cols)}) VALUES ({','.join('?' * len(cols))})", [rid, *vals.values(), now, now])
        except Exception as e:
            c.rollback()
            if "UNIQUE" in str(e):
                raise Invalid("That name already exists.") from e
            raise
        c.commit()
    return get(resource, rid)


def update(resource, rid, data):
    """Validate and update a row; returns it."""
    vals = _clean(resource, data, False)
    if resource == "todos" and "done" in vals:
        vals["completed_at"] = time.time() if vals["done"] else None
    with LOCK:
        c = conn()
        try:
            c.execute(f"UPDATE {resource} SET {', '.join(k + '=?' for k in vals)}, updated=? WHERE id=?", [*vals.values(), time.time(), rid])
        except Exception as e:
            c.rollback()
            if "UNIQUE" in str(e):
                raise Invalid("That name already exists.") from e
            raise
        c.commit()
    return get(resource, rid)


def delete(resource, rid):
    """Delete a row; deleting a subject detaches its items instead of deleting them."""
    with LOCK:
        c = conn()
        cur = c.execute(f"DELETE FROM {resource} WHERE id=?", (rid,))
        if resource == "subjects":              # items keep existing, they just lose their subject
            for t in ("notes", "snippets", "questions", "todos", "goals", "sessions", "reminders", "exams", "files"):
                c.execute(f"UPDATE {t} SET subject_id=NULL WHERE subject_id=?", (rid,))
        c.commit()
        return cur.rowcount > 0


# ---------------------------------------------------------------- notes: search and links
def search_notes(q="", subject="", tag=""):
    """Notes matching text, subject and/or tag."""
    sql, args = "SELECT * FROM notes WHERE 1=1", []
    if q:
        sql += " AND (title LIKE ? OR body LIKE ?)"
        args += [f"%{q}%"] * 2
    if subject:
        sql += " AND subject_id=?"
        args.append(subject)
    if tag:
        sql += " AND tags LIKE ?"
        args.append(f'%"{tag.lower()}"%')
    sql += f" ORDER BY {RESOURCES['notes']['order']} LIMIT 500"
    with LOCK:
        return [_out("notes", r) for r in conn().execute(sql, args)]


def note_links(note_id):
    """Files a note links to, with the page or line of each link."""
    with LOCK:
        return [{"file": store.row(r), "locator": json.loads(r["locator"])} for r in conn().execute(
            """SELECT f.*, l.locator FROM note_links l JOIN files f ON f.id = l.file_id WHERE l.note_id=?""", (note_id,))]


def add_note_link(note_id, file_id, locator):
    """Link a note to a file (and optionally a page or line)."""
    with LOCK:
        c = conn()
        c.execute("INSERT OR IGNORE INTO note_links VALUES (?,?,?)", (note_id, file_id, json.dumps(locator or {}, sort_keys=True)))
        c.commit()


def remove_note_link(note_id, file_id, locator):
    """Remove a note-to-file link."""
    with LOCK:
        c = conn()
        c.execute("DELETE FROM note_links WHERE note_id=? AND file_id=? AND locator=?", (note_id, file_id, json.dumps(locator or {}, sort_keys=True)))
        c.commit()


def notes_for_file(file_id):
    """Notes that link to a file, newest first."""
    with LOCK:
        return [_out("notes", r) for r in conn().execute(
            "SELECT n.* FROM notes n JOIN note_links l ON l.note_id = n.id WHERE l.file_id=? GROUP BY n.id ORDER BY n.updated DESC", (file_id,))]


# ---------------------------------------------------------------- practice questions (Leitner boxes)
def review_question(qid, grade):
    """Apply a spaced-repetition grade (again, hard, good, easy) and schedule the next review."""
    q = get("questions", qid)
    if not q:
        return None
    box = {"again": 0, "hard": max(1, q["box"]) if q["box"] else 1, "good": min(5, q["box"] + 1), "easy": min(5, q["box"] + 2)}.get(grade)
    if box is None:
        raise Invalid("Grade must be again, hard, good or easy.")
    due = (date.today() + timedelta(days=INTERVALS[box] if grade != "hard" else max(1, INTERVALS[box] // 2))).isoformat()
    return update("questions", qid, {"box": box, "due": due, "last_reviewed": time.time()})


def due_questions(subject=""):
    """Practice questions due today or never reviewed."""
    sql, args = "SELECT * FROM questions WHERE (due IS NULL OR due <= ?)", [today()]
    if subject:
        sql += " AND subject_id=?"
        args.append(subject)
    with LOCK:
        return [_out("questions", r) for r in conn().execute(sql + " ORDER BY due IS NULL, due, created LIMIT 200", args)]


# ---------------------------------------------------------------- progress summary
def summary():
    """Planner numbers: minutes today, goal, streak, 7-day chart, due items and next exam."""
    t = today()
    with LOCK:
        c = conn()
        mins = {r["day"]: r["m"] for r in c.execute("SELECT day, SUM(minutes) m FROM sessions WHERE day >= ? GROUP BY day",
                                                    ((date.today() - timedelta(days=60)).isoformat(),))}
        goal = store.settings().get("daily_goal_minutes", 60)
        streak, d = 0, date.today()
        if not mins.get(t):
            d -= timedelta(days=1)                      # today may still be empty; the streak survives until tomorrow
        while mins.get(d.isoformat()):
            streak += 1
            d -= timedelta(days=1)
        week = [{"day": (date.today() - timedelta(days=i)).isoformat(), "minutes": mins.get((date.today() - timedelta(days=i)).isoformat(), 0)} for i in range(6, -1, -1)]
        exam = c.execute("SELECT * FROM exams WHERE date >= ? ORDER BY date LIMIT 1", (t,)).fetchone()
        return {"today_minutes": mins.get(t, 0), "goal_minutes": goal, "streak": streak, "week": week,
                "due_questions": c.execute("SELECT COUNT(*) FROM questions WHERE due IS NULL OR due <= ?", (t,)).fetchone()[0],
                "reminders_due": c.execute("SELECT COUNT(*) FROM reminders WHERE done=0 AND due IS NOT NULL AND due <= ?", (t,)).fetchone()[0],
                "todos_open": c.execute("SELECT COUNT(*) FROM todos WHERE done=0").fetchone()[0],
                "next_exam": _out("exams", exam) if exam else None,
                "total_minutes": c.execute("SELECT COALESCE(SUM(minutes),0) FROM sessions").fetchone()[0]}


def subject_counts():
    """Per-subject counts of notes, files, snippets, questions, to-dos and minutes studied."""
    with LOCK:
        c = conn()
        out = {}
        for key, table in (("notes", "notes"), ("files", "files"), ("snippets", "snippets"), ("questions", "questions"), ("todos", "todos")):
            for r in c.execute(f"SELECT subject_id, COUNT(*) n FROM {table} WHERE subject_id IS NOT NULL GROUP BY subject_id"):
                out.setdefault(r["subject_id"], {})[key] = r["n"]
        for r in c.execute("SELECT subject_id, SUM(minutes) m FROM sessions WHERE subject_id IS NOT NULL GROUP BY subject_id"):
            out.setdefault(r["subject_id"], {})["minutes"] = r["m"]
        return out


# ---------------------------------------------------------------- files: subject, tags, collections
def set_file_meta(file_id, subject_id=None, tags=None, set_subject=False):
    """Set a file subject and/or tags."""
    with LOCK:
        c = conn()
        if set_subject:
            c.execute("UPDATE files SET subject_id=? WHERE id=?", (subject_id or None, file_id))
        if tags is not None:
            c.execute("UPDATE files SET tags=? WHERE id=?", (_coerce("j", tags), file_id))
        c.commit()
        return store.row(c.execute("SELECT * FROM files WHERE id=?", (file_id,)).fetchone())


def file_collections(file_id):
    """Ids of the collections a file belongs to."""
    with LOCK:
        return [r["collection_id"] for r in conn().execute("SELECT collection_id FROM collection_files WHERE file_id=?", (file_id,))]


def toggle_collection(collection_id, file_id, member):
    """Add or remove a file from a collection."""
    with LOCK:
        c = conn()
        if member:
            c.execute("INSERT OR IGNORE INTO collection_files VALUES (?,?)", (collection_id, file_id))
        else:
            c.execute("DELETE FROM collection_files WHERE collection_id=? AND file_id=?", (collection_id, file_id))
        c.commit()


def collection_files(collection_id):
    """Files in a collection."""
    with LOCK:
        return [store.row(r) for r in conn().execute(
            "SELECT f.* FROM collection_files m JOIN files f ON f.id = m.file_id WHERE m.collection_id=? ORDER BY f.name COLLATE NOCASE", (collection_id,))]


def collection_counts():
    """Number of files per collection id."""
    with LOCK:
        return {r["collection_id"]: r["n"] for r in conn().execute("SELECT collection_id, COUNT(*) n FROM collection_files GROUP BY collection_id")}


def files_with(subject="", tag="", pinned=False):
    """Known files filtered by subject, tag and/or pinned."""
    sql, args = "SELECT * FROM files WHERE 1=1", []
    if subject:
        sql += " AND subject_id=?"
        args.append(subject)
    if tag:
        sql += " AND tags LIKE ?"
        args.append(f'%"{tag.lower()}"%')
    if pinned:
        sql += " AND pinned=1"
    with LOCK:
        return [store.row(r) for r in conn().execute(sql + " ORDER BY name COLLATE NOCASE LIMIT 500", args)]


def all_tags():
    """Every tag with how often it is used on files, notes and snippets."""
    counts = {}
    with LOCK:
        for table in ("files", "notes", "snippets"):
            for r in conn().execute(f"SELECT tags FROM {table} WHERE tags != '[]'"):
                for t in json.loads(r["tags"]):
                    counts[t] = counts.get(t, 0) + 1
    return sorted(({"tag": k, "count": v} for k, v in counts.items()), key=lambda x: (-x["count"], x["tag"]))


def search_all(q, limit=8):
    """Search notes, annotations, snippets, questions and tagged files in one go."""
    like = f"%{q}%"
    with LOCK:
        c = conn()
        out = {
            "notes": [_out("notes", r) for r in c.execute("SELECT * FROM notes WHERE title LIKE ? OR body LIKE ? ORDER BY updated DESC LIMIT ?", (like, like, limit))],
            "snippets": [_out("snippets", r) for r in c.execute("SELECT * FROM snippets WHERE title LIKE ? OR code LIKE ? ORDER BY updated DESC LIMIT ?", (like, like, limit))],
            "questions": [_out("questions", r) for r in c.execute("SELECT * FROM questions WHERE question LIKE ? OR answer LIKE ? LIMIT ?", (like, like, limit))],
            "tagged": [store.row(r) for r in c.execute("SELECT * FROM files WHERE tags LIKE ? LIMIT ?", (f'%{q.lower()}%', limit))],
        }
    out["annotations"] = store.ann_search(q, limit=limit)
    return out
