"""Backup and restore of everything you created: notes, annotations, planner, practice, tags and collections.

The file is plain JSON. References between items use file paths and subject names (never database ids), so a backup
can be restored into a fresh installation or on another computer. Restoring MERGES: nothing is deleted, and importing
the same backup twice does not create duplicates.
"""
import json
import time
from datetime import datetime

from flask import Blueprint, Response, abort, jsonify, request

import store
import studystore as S
from store import LOCK, conn

bp = Blueprint("backup", __name__)
VERSION = 1
MAX_BYTES = 50 * 1024 * 1024


def _rows(sql, args=()):
    with LOCK:
        return [dict(r) for r in conn().execute(sql, args)]


def build():
    """Collect all user-created data into a portable dictionary."""
    subjects = {r["id"]: r["name"] for r in _rows("SELECT id,name FROM subjects")}
    files = {r["id"]: r for r in _rows("SELECT * FROM files")}
    fpath = lambda fid: files[int(fid)]["path"] if fid not in (None, "") and int(fid) in files else None
    sname = lambda sid: subjects.get(sid)
    out = {"app": "NinaPro Study Workspace", "version": VERSION, "exported": datetime.now().isoformat(timespec="seconds")}
    out["subjects"] = [{"name": n} for n in subjects.values()]
    out["files"] = [{"path": f["path"], "name": f["name"], "ext": f["ext"], "category": f["category"], "favorite": bool(f["favorite"]),
                     "pinned": bool(f["pinned"]), "tags": json.loads(f["tags"] or "[]"), "subject": sname(f["subject_id"])}
                    for f in files.values() if f["favorite"] or f["pinned"] or f["subject_id"] or f["tags"] != "[]"]
    out["annotations"] = [{"file": files[a["file_id"]]["path"], "kind": a["kind"], "category": a["category"], "text": a["text"], "quote": a["quote"],
                           "locator": json.loads(a["locator"]), "created": a["created"], "updated": a["updated"]}
                          for a in _rows("SELECT * FROM annotations") if a["file_id"] in files]
    out["notes"] = [{"title": n["title"], "body": n["body"], "subject": sname(n["subject_id"]), "tags": json.loads(n["tags"]), "pinned": bool(n["pinned"]),
                     "created": n["created"], "updated": n["updated"],
                     "links": [{"file": files[l["file_id"]]["path"], "locator": json.loads(l["locator"])}
                               for l in _rows("SELECT * FROM note_links WHERE note_id=?", (n["id"],)) if l["file_id"] in files]}
                    for n in _rows("SELECT * FROM notes")]
    out["snippets"] = [{**{k: s[k] for k in ("title", "language", "code", "created", "updated")}, "subject": sname(s["subject_id"]), "tags": json.loads(s["tags"])} for s in _rows("SELECT * FROM snippets")]
    out["questions"] = [{**{k: q[k] for k in ("question", "answer", "difficulty", "source", "box", "due", "last_reviewed", "created", "updated")}, "subject": sname(q["subject_id"])} for q in _rows("SELECT * FROM questions")]
    out["todos"] = [{**{k: t[k] for k in ("title", "done", "due", "priority", "completed_at", "created")}, "subject": sname(t["subject_id"])} for t in _rows("SELECT * FROM todos")]
    out["goals"] = [{**{k: g[k] for k in ("title", "kind", "target", "period", "active", "created")}, "subject": sname(g["subject_id"])} for g in _rows("SELECT * FROM goals")]
    out["sessions"] = [{**{k: s[k] for k in ("minutes", "kind", "note", "day", "created")}, "subject": sname(s["subject_id"])} for s in _rows("SELECT * FROM sessions")]
    out["reminders"] = [{**{k: r[k] for k in ("title", "due", "done", "created")}, "subject": sname(r["subject_id"]), "file": fpath(r["file_id"])} for r in _rows("SELECT * FROM reminders")]
    out["exams"] = [{**{k: e[k] for k in ("name", "date", "created")}, "subject": sname(e["subject_id"]),
                     "checklist": [{"text": c["text"], "done": bool(c["done"]), "position": c["position"]} for c in _rows("SELECT * FROM checklist WHERE exam_id=? ORDER BY position", (e["id"],))]}
                    for e in _rows("SELECT * FROM exams")]
    out["collections"] = [{"name": c["name"], "files": [files[m["file_id"]]["path"] for m in _rows("SELECT file_id FROM collection_files WHERE collection_id=?", (c["id"],)) if m["file_id"] in files]}
                          for c in _rows("SELECT * FROM collections")]
    out["settings"] = store.settings()
    return out


def _file(path_str, cache):
    """Library record for a path, created (as a placeholder) if the file is not known yet."""
    if path_str not in cache:
        from pathlib import Path
        from catalog import category_for
        p = Path(path_str)
        cache[path_str] = store.ensure({"path": path_str, "name": p.name, "ext": p.suffix.lower(), "category": category_for(p.suffix), "size": 0, "mtime": 0})
    return cache[path_str]


def restore(data):
    """Merge a backup dictionary into the database; returns how many items of each type were added."""
    if not isinstance(data, dict) or data.get("app") != "NinaPro Study Workspace" or not isinstance(data.get("version"), int):
        raise S.Invalid("This is not a backup file made by this app.")
    if data["version"] > VERSION:
        raise S.Invalid("This backup was made by a newer version of the app.")
    added = {}
    bump = lambda k: added.__setitem__(k, added.get(k, 0) + 1)
    cache = {}
    by_name = {s["name"].lower(): s["id"] for s in S.list_("subjects")}

    def subject(name):
        """Id of the subject with this name, creating it if needed."""
        if not name:
            return ""
        key = name.lower()
        if key not in by_name:
            by_name[key] = S.add("subjects", {"name": name, "position": len(by_name)})["id"]
            bump("subjects")
        return by_name[key]

    for s in data.get("subjects", []):
        subject(s.get("name"))
    for f in data.get("files", []):
        rec = _file(f["path"], cache)
        S.set_file_meta(rec["id"], subject(f.get("subject")) or None, (f.get("tags") or []) or None, True)
        if f.get("favorite"):
            store.set_flag(f["path"], "favorite", True)
        if f.get("pinned"):
            store.set_flag(f["path"], "pinned", True)
    have = {(a["file_id"], a["kind"], json.dumps(a["locator"], sort_keys=True), a["text"]) for a in _rows("SELECT file_id,kind,locator,text FROM annotations") for a in [{**a, "locator": json.loads(a["locator"])}]}
    for a in data.get("annotations", []):
        rec = _file(a["file"], cache)
        key = (rec["id"], a["kind"], json.dumps(a["locator"], sort_keys=True), a.get("text", ""))
        if key in have:
            continue
        have.add(key)
        store.ann_add(rec["id"], a["kind"], a.get("category", "general"), a.get("text", ""), a.get("quote", ""), a["locator"])
        bump("annotations")
    existing = {(n["title"], n["body"]) for n in S.list_("notes")}
    for n in data.get("notes", []):
        if (n["title"], n["body"]) in existing:
            continue
        existing.add((n["title"], n["body"]))
        note = S.add("notes", {"title": n["title"], "body": n["body"], "subject_id": subject(n.get("subject")), "tags": n.get("tags", []), "pinned": n.get("pinned", False)})
        for l in n.get("links", []):
            S.add_note_link(note["id"], _file(l["file"], cache)["id"], l.get("locator"))
        bump("notes")

    def simple(resource, items, key_fields, fields):
        """Insert items of a simple resource that are not already present."""
        have_keys = {tuple(r.get(k) for k in key_fields) for r in S.list_(resource)}
        for it in items:
            if tuple(it.get(k) for k in key_fields) in have_keys:
                continue
            body = {f: it.get(f) for f in fields if f in it}
            body["subject_id"] = subject(it.get("subject"))
            S.add(resource, {k: v for k, v in body.items() if v is not None})
            have_keys.add(tuple(it.get(k) for k in key_fields))
            bump(resource)

    simple("snippets", data.get("snippets", []), ("title", "code"), ("title", "language", "code", "tags"))
    simple("questions", data.get("questions", []), ("question",), ("question", "answer", "difficulty", "source", "box", "due"))
    simple("todos", data.get("todos", []), ("title", "due"), ("title", "done", "due", "priority"))
    simple("goals", data.get("goals", []), ("title", "kind"), ("title", "kind", "target", "period", "active"))
    simple("sessions", data.get("sessions", []), ("day", "minutes", "note"), ("minutes", "kind", "note", "day"))
    have_rem = {(r["title"], r["due"]) for r in S.list_("reminders")}
    for r in data.get("reminders", []):
        if (r["title"], r.get("due")) not in have_rem:
            fid = str(_file(r["file"], cache)["id"]) if r.get("file") else ""
            S.add("reminders", {"title": r["title"], "due": r.get("due") or "", "done": r.get("done", False), "subject_id": subject(r.get("subject")), "file_id": fid})
            bump("reminders")
    have_ex = {(e["name"], e["date"]) for e in S.list_("exams")}
    for e in data.get("exams", []):
        if (e["name"], e.get("date")) in have_ex:
            continue
        ex = S.add("exams", {"name": e["name"], "date": e.get("date") or "", "subject_id": subject(e.get("subject"))})
        for c in e.get("checklist", []):
            S.add("checklist", {"exam_id": ex["id"], "text": c["text"], "done": c.get("done", False), "position": c.get("position", 0)})
        bump("exams")
    cols = {c["name"].lower(): c["id"] for c in S.list_("collections")}
    for c in data.get("collections", []):
        if c["name"].lower() not in cols:
            cols[c["name"].lower()] = S.add("collections", {"name": c["name"]})["id"]
            bump("collections")
        for path in c.get("files", []):
            S.toggle_collection(cols[c["name"].lower()], _file(path, cache)["id"], True)
    values = {k: v for k, v in (data.get("settings") or {}).items() if k in store.DEFAULT_SETTINGS and k != "start_folder"}
    if values:
        store.update_settings(values)
    return added


@bp.get("/api/backup")
def export():
    """Download a JSON backup of notes, annotations, planner data, practice questions, tags and collections."""
    name = f"study-backup-{time.strftime('%Y%m%d-%H%M')}.json"
    return Response(json.dumps(build(), indent=1, ensure_ascii=False), mimetype="application/json",
                    headers={"Content-Disposition": f'attachment; filename="{name}"'})


@bp.post("/api/backup/restore")
def restore_backup():
    """Merge an uploaded backup into the database (nothing is deleted; repeating it adds nothing)."""
    if request.content_length and request.content_length > MAX_BYTES:
        abort(413, "That file is too large to be a backup.")
    try:
        data = json.loads(request.get_data() or b"null")
    except ValueError:
        abort(400, "That file is not valid JSON.")
    try:
        return jsonify(added=restore(data))
    except S.Invalid as e:
        abort(400, str(e))
    except (KeyError, TypeError) as e:
        abort(400, f"This backup is damaged or incomplete ({e}).")
