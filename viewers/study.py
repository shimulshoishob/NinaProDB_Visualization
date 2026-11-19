"""Study API: subjects, notes, snippets, practice questions, planner, collections, tags and unified search."""
import contextlib
import os

from flask import Blueprint, abort, jsonify, request

import store
import studystore as S
from catalog import describe
from common import ws

bp = Blueprint("study", __name__)


@bp.errorhandler(S.Invalid)
def invalid(e):
    """Turn validation errors into a 400 response."""
    return jsonify(error=str(e)), 400


def body():
    """The request's JSON body (an empty dict when missing)."""
    return request.get_json(silent=True) or {}


def resource(name):
    """Validate a resource name or return 404."""
    if name not in S.RESOURCES:
        abort(404, "Unknown item type.")
    return name


def file_record(path_str):
    """Library record for a path (created if the file is not known yet)."""
    p = ws.resolve(path_str)
    if not p.is_file():
        abort(404, "File not found. It may have been moved or deleted.")
    info = describe(p)
    info["fingerprint"] = store.fingerprint(p)
    return store.ensure(info)


# ---------------------------------------------------------------- generic CRUD
@bp.get("/api/study/<name>")
def list_items(name):
    """List items of a resource (notes also accept q, subject and tag filters)."""
    resource(name)
    if name == "notes":
        return jsonify(S.search_notes(request.args.get("q", "").strip(), request.args.get("subject", ""), request.args.get("tag", "")))
    where = {k: v for k, v in request.args.items() if k in S.RESOURCES[name]["cols"] and v != ""}
    items = S.list_(name, where)
    if name == "reminders":                                  # show which file a reminder is about
        for r in items:
            f = store.file_by_id(r["file_id"]) if r.get("file_id") else None
            r["file"] = {"name": f["name"], "path": f["path"], "exists": os.path.exists(f["path"])} if f else None
    return jsonify(items)


@bp.get("/api/study/<name>/<rid>")
def get_item(name, rid):
    """One item of a resource."""
    item = S.get(resource(name), rid)
    if not item:
        abort(404, "Not found.")
    return jsonify(item)


@bp.post("/api/study/<name>")
def create_item(name):
    """Create an item of a resource."""
    return jsonify(S.add(resource(name), body()))


@bp.patch("/api/study/<name>/<rid>")
def update_item(name, rid):
    """Update fields of an item."""
    resource(name)
    if not S.get(name, rid):
        abort(404, "Not found.")
    return jsonify(S.update(name, rid, body()))


@bp.delete("/api/study/<name>/<rid>")
def delete_item(name, rid):
    """Delete an item."""
    if not S.delete(resource(name), rid):
        abort(404, "Not found.")
    return jsonify(ok=True)


# ---------------------------------------------------------------- notes
@bp.get("/api/study/notes/<rid>/links")
def links(rid):
    """Files linked from a note."""
    return jsonify([{"file": {k: l["file"][k] for k in ("path", "name", "category", "ext")}, "locator": l["locator"],
                     "exists": os.path.exists(l["file"]["path"])} for l in S.note_links(rid)])


@bp.post("/api/study/notes/<rid>/links")
def add_link(rid):
    """Link a note to a file (and optionally a page or line)."""
    if not S.get("notes", rid):
        abort(404, "Note not found.")
    b = body()
    S.add_note_link(rid, file_record(b.get("path", ""))["id"], b.get("locator") or {})
    return jsonify(ok=True)


@bp.delete("/api/study/notes/<rid>/links")
def remove_link(rid):
    """Remove a note-to-file link."""
    b = body()
    rec = store.get(str(ws.resolve(b.get("path", ""))))
    if rec:
        S.remove_note_link(rid, rec["id"], b.get("locator") or {})
    return jsonify(ok=True)


@bp.post("/api/study/notes/append")
def append_to_note():
    """“Send to notes”: add a quote (with its source) to the note kept for that file, creating it if needed."""
    b = body()
    rec = file_record(b.get("path", ""))
    title = f"Notes: {rec['name']}"
    note = next((n for n in S.notes_for_file(rec["id"]) if n["title"] == title), None)
    where = b.get("where", "")
    chunk = ""
    if b.get("quote") and b.get("fence") is not None:       # code: keep it as a code block
        chunk += f"```{b['fence']}\n{str(b['quote']).rstrip()}\n```\n\n"
    elif b.get("quote"):
        chunk += "\n".join("> " + l for l in str(b["quote"]).splitlines()) + "\n\n"
    if b.get("text"):
        chunk += str(b["text"]).strip() + "\n\n"
    chunk += f"*— {rec['name']}{', ' + where if where else ''}*\n\n"
    if note:
        note = S.update("notes", note["id"], {"body": (note["body"].rstrip() + "\n\n" + chunk) if note["body"] else chunk})
    else:
        note = S.add("notes", {"title": title, "body": chunk, "subject_id": rec.get("subject_id") or ""})
    S.add_note_link(note["id"], rec["id"], b.get("locator") or {})
    return jsonify(note)


@bp.get("/api/study/file-notes")
def file_notes():
    """Notes linked to a file."""
    rec = store.get(str(ws.resolve(request.args.get("path", ""))))
    return jsonify(S.notes_for_file(rec["id"]) if rec else [])


# ---------------------------------------------------------------- practice, summary
@bp.get("/api/study/practice/due")
def due():
    """Practice questions due for review."""
    return jsonify(S.due_questions(request.args.get("subject", "")))


@bp.post("/api/study/questions/<rid>/review")
def review(rid):
    """Grade a practice question and schedule its next review."""
    q = S.review_question(rid, body().get("grade", ""))
    if not q:
        abort(404, "Question not found.")
    return jsonify(q)


@bp.get("/api/study/summary")
def summary():
    """Planner summary: progress, streak, due items and next exam."""
    return jsonify(S.summary())


@bp.get("/api/study/subject-counts")
def subject_counts():
    """Counts of notes, files, snippets, questions and minutes per subject."""
    return jsonify(S.subject_counts())


# ---------------------------------------------------------------- organising files
@bp.get("/api/study/file")
def file_meta():
    """A file's subject, tags, pin, favourite, collections and notes."""
    p = ws.resolve(request.args.get("path", ""))
    rec = store.get(str(p))
    if not rec:
        return jsonify(subject_id=None, tags=[], pinned=False, favorite=False, collections=[], notes=[])
    return jsonify(subject_id=rec.get("subject_id"), tags=rec["tags"], pinned=rec["pinned"], favorite=rec["favorite"],
                   collections=S.file_collections(rec["id"]), notes=S.notes_for_file(rec["id"]))


@bp.put("/api/study/file")
def set_file_meta():
    """Change a file's subject, tags, pin or collection membership."""
    b = body()
    rec = file_record(b.get("path", ""))
    if "subject_id" in b or "tags" in b:
        rec = S.set_file_meta(rec["id"], b.get("subject_id"), b.get("tags"), "subject_id" in b)
    if "pinned" in b:
        rec = store.set_flag(rec["path"], "pinned", bool(b["pinned"]))
    if "collection" in b:
        S.toggle_collection(b["collection"], rec["id"], bool(b.get("member", True)))
    return jsonify(subject_id=rec.get("subject_id"), tags=rec["tags"], pinned=rec["pinned"], collections=S.file_collections(rec["id"]))


def with_exists(files):
    """Add an "exists" flag (is the file still on disk) to file records."""
    return [{**f, "exists": os.path.exists(f["path"])} for f in files]


@bp.get("/api/study/files")
def files_with():
    """Known files filtered by subject, tag or pinned."""
    return jsonify(with_exists(S.files_with(request.args.get("subject", ""), request.args.get("tag", ""), request.args.get("pinned") == "1")))


@bp.get("/api/study/collections/<rid>/files")
def collection_files(rid):
    """Files in a collection."""
    return jsonify(with_exists(S.collection_files(rid)))


@bp.get("/api/study/collection-counts")
def collection_counts():
    """Number of files per collection."""
    return jsonify(S.collection_counts())


@bp.get("/api/study/tags")
def tags():
    """All tags with usage counts."""
    return jsonify(S.all_tags())


@bp.get("/api/study/modified")
def modified():
    """Files you know about, newest change on disk first."""
    seen = []
    for f in store.recent(limit=300) + store.favorites() + S.files_with():
        if f["path"] not in {s["path"] for s in seen} and os.path.exists(f["path"]):
            with contextlib.suppress(OSError):
                seen.append({**f, "mtime": os.path.getmtime(f["path"]), "exists": True})
    return jsonify(sorted(seen, key=lambda x: -x["mtime"])[:60])


@bp.get("/api/search")
def search():
    """Search notes, annotations, snippets, questions and tagged files."""
    q = request.args.get("q", "").strip()
    if len(q) < 2:
        return jsonify({})
    res = S.search_all(q)
    for a in res["annotations"]:
        a["file"]["exists"] = os.path.exists(a["file"]["path"])
    return jsonify(res)
