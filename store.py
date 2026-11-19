"""SQLite persistence for the workspace: recents, favourites and settings.

One file (workspace.db) holds everything the app remembers, so later phases
(annotations, notes, subjects ...) just add tables via the MIGRATIONS list.
"""
import hashlib
import json
import os
import sqlite3
import threading
import time
import uuid
from pathlib import Path

DB_PATH = Path(os.environ.get("WORKSPACE_DB", Path(__file__).resolve().parent / "workspace.db"))
LOCK = threading.RLock()

MIGRATIONS = [
    # v1
    """
    CREATE TABLE files (
        id INTEGER PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        ext TEXT NOT NULL,
        category TEXT NOT NULL,
        size INTEGER, mtime REAL,
        fingerprint TEXT,
        first_opened REAL, last_opened REAL,
        open_count INTEGER NOT NULL DEFAULT 0,
        favorite INTEGER NOT NULL DEFAULT 0,
        pinned INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX idx_files_last ON files(last_opened DESC);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    """,
    # v2: unified annotations (one table for every viewer; the locator JSON says where in the file)
    """
    CREATE TABLE annotations (
        id TEXT PRIMARY KEY,
        file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'general',
        text TEXT NOT NULL DEFAULT '',
        quote TEXT NOT NULL DEFAULT '',
        locator TEXT NOT NULL,
        created REAL NOT NULL,
        updated REAL NOT NULL
    );
    CREATE INDEX idx_ann_file ON annotations(file_id);
    """,
    # v3: study workspace (subjects, notes, snippets, practice questions, planner, collections)
    """
    ALTER TABLE files ADD COLUMN subject_id TEXT;
    ALTER TABLE files ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
    CREATE TABLE subjects (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, color TEXT NOT NULL DEFAULT '',
        position INTEGER NOT NULL DEFAULT 0, created REAL NOT NULL, updated REAL NOT NULL);
    CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', subject_id TEXT,
        tags TEXT NOT NULL DEFAULT '[]', pinned INTEGER NOT NULL DEFAULT 0, created REAL NOT NULL, updated REAL NOT NULL);
    CREATE TABLE note_links (note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE, locator TEXT NOT NULL DEFAULT '{}',
        PRIMARY KEY (note_id, file_id, locator));
    CREATE TABLE snippets (id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', language TEXT NOT NULL DEFAULT '',
        code TEXT NOT NULL DEFAULT '', subject_id TEXT, tags TEXT NOT NULL DEFAULT '[]', created REAL NOT NULL, updated REAL NOT NULL);
    CREATE TABLE questions (id TEXT PRIMARY KEY, question TEXT NOT NULL DEFAULT '', answer TEXT NOT NULL DEFAULT '', subject_id TEXT,
        difficulty TEXT NOT NULL DEFAULT 'medium', source TEXT NOT NULL DEFAULT '', box INTEGER NOT NULL DEFAULT 0, due TEXT,
        last_reviewed REAL, created REAL NOT NULL, updated REAL NOT NULL);
    CREATE TABLE todos (id TEXT PRIMARY KEY, title TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0, due TEXT, subject_id TEXT,
        priority INTEGER NOT NULL DEFAULT 1, completed_at REAL, created REAL NOT NULL, updated REAL NOT NULL);
    CREATE TABLE goals (id TEXT PRIMARY KEY, title TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'text', target INTEGER NOT NULL DEFAULT 0,
        period TEXT NOT NULL DEFAULT 'day', subject_id TEXT, active INTEGER NOT NULL DEFAULT 1, created REAL NOT NULL, updated REAL NOT NULL);
    CREATE TABLE sessions (id TEXT PRIMARY KEY, minutes INTEGER NOT NULL, subject_id TEXT, kind TEXT NOT NULL DEFAULT 'focus',
        note TEXT NOT NULL DEFAULT '', day TEXT NOT NULL, created REAL NOT NULL, updated REAL NOT NULL);
    CREATE INDEX idx_sessions_day ON sessions(day);
    CREATE TABLE reminders (id TEXT PRIMARY KEY, title TEXT NOT NULL, due TEXT, subject_id TEXT, file_id TEXT,
        done INTEGER NOT NULL DEFAULT 0, created REAL NOT NULL, updated REAL NOT NULL);
    CREATE TABLE exams (id TEXT PRIMARY KEY, name TEXT NOT NULL, date TEXT, subject_id TEXT, created REAL NOT NULL, updated REAL NOT NULL);
    CREATE TABLE checklist (id TEXT PRIMARY KEY, exam_id TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE, text TEXT NOT NULL,
        done INTEGER NOT NULL DEFAULT 0, position INTEGER NOT NULL DEFAULT 0, created REAL NOT NULL, updated REAL NOT NULL);
    CREATE TABLE collections (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, created REAL NOT NULL, updated REAL NOT NULL);
    CREATE TABLE collection_files (collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
        file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE, PRIMARY KEY (collection_id, file_id));
    """,
]

_conn = None


def conn():
    """The shared SQLite connection (created and migrated on first use)."""
    global _conn
    if _conn is None:
        _conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        _conn.row_factory = sqlite3.Row
        _conn.execute("PRAGMA journal_mode=WAL")
        version = _conn.execute("PRAGMA user_version").fetchone()[0]
        for i, script in enumerate(MIGRATIONS[version:], start=version + 1):
            _conn.executescript(script)
            _conn.execute(f"PRAGMA user_version={i}")
        _conn.execute("PRAGMA foreign_keys=ON")
        _conn.commit()
        seed_subjects()
        import_legacy_comments()
    return _conn


def reset(path=None):
    """Close the connection (used by tests to point at a temporary database)."""
    global _conn, DB_PATH
    if _conn is not None:
        _conn.close()
        _conn = None
    if path:
        DB_PATH = Path(path)


def fingerprint(path: Path):
    """Cheap identity (size + first 64 KB) so a moved file can be recognised later."""
    h = hashlib.sha1()
    try:
        with open(path, "rb") as f:
            h.update(str(path.stat().st_size).encode())
            h.update(f.read(65536))
    except OSError:
        return None
    return h.hexdigest()


def row(r):
    """Convert a files row to a dict (booleans and the tags list decoded)."""
    if r is None:
        return None
    d = dict(r)
    d["favorite"], d["pinned"] = bool(d["favorite"]), bool(d["pinned"])
    if "tags" in d:
        d["tags"] = json.loads(d["tags"] or "[]")
    return d


# ---------------------------------------------------------------- files
def touch(info: dict):
    """Record that a file was opened (creates the row if needed) and return it."""
    now = time.time()
    with LOCK:
        c = conn()
        relink(c, info)
        c.execute(
            """INSERT INTO files (path,name,ext,category,size,mtime,fingerprint,first_opened,last_opened,open_count)
               VALUES (?,?,?,?,?,?,?,?,?,1)
               ON CONFLICT(path) DO UPDATE SET name=excluded.name, size=excluded.size, mtime=excluded.mtime,
                 fingerprint=excluded.fingerprint, last_opened=excluded.last_opened, open_count=open_count+1""",
            (info["path"], info["name"], info["ext"], info["category"], info["size"], info["mtime"],
             info.get("fingerprint"), now, now))
        c.commit()
        return row(c.execute("SELECT * FROM files WHERE path=?", (info["path"],)).fetchone())


def relink(c, info):
    """If this file was moved or renamed, adopt the old record (keeps annotations, favourites, history)."""
    if c.execute("SELECT 1 FROM files WHERE path=?", (info["path"],)).fetchone() or not info.get("fingerprint"):
        return
    for r in c.execute("SELECT id, path FROM files WHERE fingerprint=? AND ext=? AND size=?",
                       (info["fingerprint"], info["ext"], info["size"])).fetchall():
        if not os.path.exists(r["path"]):
            c.execute("UPDATE files SET path=?, name=? WHERE id=?", (info["path"], info["name"], r["id"]))
            return


def ensure(info):
    """Return the record for a file, creating it (without marking it as opened) when needed."""
    with LOCK:
        c = conn()
        relink(c, info)
        c.execute("""INSERT OR IGNORE INTO files (path,name,ext,category,size,mtime,fingerprint) VALUES (?,?,?,?,?,?,?)""",
                  (info["path"], info["name"], info["ext"], info["category"], info["size"], info["mtime"], info.get("fingerprint")))
        c.commit()
        return row(c.execute("SELECT * FROM files WHERE path=?", (info["path"],)).fetchone())


def file_by_id(file_id):
    """Library record for a numeric file id, or None."""
    with LOCK:
        try:
            return row(conn().execute("SELECT * FROM files WHERE id=?", (int(file_id),)).fetchone())
        except (TypeError, ValueError):
            return None


def get(path):
    """Library record for a path, or None."""
    with LOCK:
        return row(conn().execute("SELECT * FROM files WHERE path=?", (path,)).fetchone())


def recent(category=None, limit=50):
    """Recently opened files, newest first, optionally for one category."""
    q, args = "SELECT * FROM files WHERE last_opened IS NOT NULL", []
    if category and category != "recent":
        q += " AND category=?"
        args.append(category)
    q += " ORDER BY last_opened DESC LIMIT ?"
    args.append(limit)
    with LOCK:
        return [row(r) for r in conn().execute(q, args)]


def favorites():
    """Favourite files, pinned first."""
    with LOCK:
        return [row(r) for r in conn().execute(
            "SELECT * FROM files WHERE favorite=1 ORDER BY pinned DESC, name COLLATE NOCASE")]


def recent_counts():
    """Number of recently opened files per category."""
    with LOCK:
        return {r["category"]: r["n"] for r in conn().execute(
            "SELECT category, COUNT(*) n FROM files WHERE last_opened IS NOT NULL GROUP BY category")}


def set_flag(path, flag, value):
    """Set the favourite or pinned flag of a file."""
    assert flag in ("favorite", "pinned")
    with LOCK:
        c = conn()
        c.execute(f"UPDATE files SET {flag}=? WHERE path=?", (1 if value else 0, path))
        c.commit()
        return row(c.execute("SELECT * FROM files WHERE path=?", (path,)).fetchone())


def forget_recent_only(path):
    """Used when a file is favourited without being opened: it should not show up in Recent."""
    with LOCK:
        c = conn()
        c.execute("UPDATE files SET last_opened=NULL, open_count=0 WHERE path=?", (path,))
        c.commit()


def forget(path=None):
    """Remove a file (or everything) from recents. Favourites are kept but lose their recent timestamp."""
    with LOCK:
        c = conn()
        where, args = ("WHERE path=?", [path]) if path else ("", [])
        c.execute(f"UPDATE files SET last_opened=NULL, open_count=0 {where}", args)
        c.execute("""DELETE FROM files WHERE favorite=0 AND pinned=0 AND last_opened IS NULL
                     AND subject_id IS NULL AND tags='[]'
                     AND id NOT IN (SELECT file_id FROM annotations)
                     AND id NOT IN (SELECT file_id FROM note_links)
                     AND id NOT IN (SELECT file_id FROM collection_files)""")
        c.commit()


# ---------------------------------------------------------------- settings
DEFAULT_SETTINGS = {"start_folder": "", "daily_goal_minutes": 60, "pomo_focus": 25, "pomo_short": 5, "pomo_long": 15}


def settings():
    """All user settings with defaults filled in."""
    with LOCK:
        out = dict(DEFAULT_SETTINGS)
        for r in conn().execute("SELECT key,value FROM settings"):
            if r["key"] in DEFAULT_SETTINGS:
                out[r["key"]] = json.loads(r["value"])
        return out


def update_settings(values: dict):
    """Save known settings (unknown keys are ignored) and return all settings."""
    with LOCK:
        c = conn()
        for k, v in values.items():
            if k in DEFAULT_SETTINGS:
                c.execute("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                          (k, json.dumps(v)))
        c.commit()
    return settings()


# ---------------------------------------------------------------- annotations
def _ann(r):
    d = dict(r)
    d["locator"] = json.loads(d["locator"])
    return d


def ann_list(file_id):
    """Annotations of one file, oldest first."""
    with LOCK:
        return [_ann(r) for r in conn().execute("SELECT * FROM annotations WHERE file_id=? ORDER BY created", (file_id,))]


def ann_get(ann_id):
    """One annotation by id, or None."""
    with LOCK:
        r = conn().execute("SELECT * FROM annotations WHERE id=?", (ann_id,)).fetchone()
        return _ann(r) if r else None


def ann_add(file_id, kind, category, text, quote, locator):
    """Create an annotation and return it."""
    now, ann_id = time.time(), uuid.uuid4().hex[:12]
    with LOCK:
        c = conn()
        c.execute("INSERT INTO annotations VALUES (?,?,?,?,?,?,?,?,?)",
                  (ann_id, file_id, kind, category, text, quote, json.dumps(locator), now, now))
        c.commit()
    return ann_get(ann_id)


def ann_update(ann_id, **fields):
    """Change fields of an annotation and return it."""
    allowed = {"kind", "category", "text", "quote", "locator"}
    sets = {k: (json.dumps(v) if k == "locator" else v) for k, v in fields.items() if k in allowed and v is not None}
    if not sets:
        return ann_get(ann_id)
    with LOCK:
        c = conn()
        c.execute(f"UPDATE annotations SET {', '.join(k + '=?' for k in sets)}, updated=? WHERE id=?",
                  [*sets.values(), time.time(), ann_id])
        c.commit()
    return ann_get(ann_id)


def ann_delete(ann_id):
    """Delete an annotation; True if it existed."""
    with LOCK:
        c = conn()
        cur = c.execute("DELETE FROM annotations WHERE id=?", (ann_id,))
        c.commit()
        return cur.rowcount > 0


def ann_search(q="", kind="", category="", file_id=None, limit=500):
    """Search annotations across files by text, kind, category or file."""
    sql = """SELECT a.*, f.path AS f_path, f.name AS f_name, f.category AS f_category
             FROM annotations a JOIN files f ON f.id = a.file_id WHERE 1=1"""
    args = []
    if q:
        sql += " AND (a.text LIKE ? OR a.quote LIKE ? OR f.name LIKE ?)"
        args += [f"%{q}%"] * 3
    if kind:
        sql += " AND a.kind=?"
        args.append(kind)
    if category:
        sql += " AND a.category=?"
        args.append(category)
    if file_id:
        sql += " AND a.file_id=?"
        args.append(file_id)
    sql += " ORDER BY a.created DESC LIMIT ?"
    args.append(limit)
    with LOCK:
        out = []
        for r in conn().execute(sql, args):
            d = _ann(r)
            d["file"] = {"path": d.pop("f_path"), "name": d.pop("f_name"), "category": d.pop("f_category")}
            out.append(d)
        return out


def ann_counts():
    """Number of annotations per file id."""
    with LOCK:
        return {r["file_id"]: r["n"] for r in conn().execute("SELECT file_id, COUNT(*) n FROM annotations GROUP BY file_id")}


LEGACY_CATEGORY = {"yellow": "general", "green": "definition", "blue": "question", "pink": "exam", "orange": "important"}


def import_legacy_comments():
    """One-time import of the Phase 2/3 comments.json (code viewer) into the annotations table."""
    legacy = DB_PATH.parent / "comments.json"
    if not legacy.exists():
        return
    try:
        data = json.loads(legacy.read_text("utf-8"))
        from catalog import describe
        for path, items in data.items():
            p = Path(path)
            info = describe(p) if p.exists() else {"path": path, "name": p.name, "ext": p.suffix.lower(), "category": "code",
                                                   "size": 0, "mtime": 0}
            info["fingerprint"] = fingerprint(p) if p.exists() else None
            rec = ensure(info)
            for it in items:
                now = time.time()
                kind = "comment" if it.get("text") else "highlight"
                conn().execute("INSERT OR IGNORE INTO annotations VALUES (?,?,?,?,?,?,?,?,?)",
                               (it["id"], rec["id"], kind, LEGACY_CATEGORY.get(it.get("color"), "general"), it.get("text", ""),
                                it.get("snippet", ""), json.dumps({"start": it["start"], "end": it["end"]}),
                                it.get("created", now), it.get("updated", now)))
        conn().commit()
        legacy.rename(legacy.with_suffix(".json.migrated"))
    except Exception:  # never block start-up because of an old file; leave it for the user to inspect
        pass


DEFAULT_SUBJECTS = ["Data Structures and Algorithms", "Object-Oriented Programming", "Computer Networks", "Operating Systems",
                    "Database Management Systems", "Computer Architecture", "Software Engineering", "Artificial Intelligence",
                    "Machine Learning", "Mathematics"]


def seed_subjects():
    """Create the usual CSE subjects the first time only (deleting them later is respected)."""
    c = _conn
    if c.execute("SELECT 1 FROM settings WHERE key='subjects_seeded'").fetchone():
        return
    now = time.time()
    for i, name in enumerate(DEFAULT_SUBJECTS):
        c.execute("INSERT OR IGNORE INTO subjects (id,name,position,created,updated) VALUES (?,?,?,?,?)",
                  (uuid.uuid4().hex[:12], name, i, now, now))
    c.execute("INSERT INTO settings(key,value) VALUES('subjects_seeded','true')")
    c.commit()
