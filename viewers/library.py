"""File library API: browse folders, preview files, native file dialog, recents, favourites, settings."""
import os
import platform
import subprocess
import sqlite3
import time
from pathlib import Path

from flask import Blueprint, abort, jsonify, request

import store
import studystore
from catalog import BY_ID, CATEGORIES, EXT_CATEGORY, describe, viewer_for
from common import highlight_lines, natural_key, ws

bp = Blueprint("library", __name__)
MAX_LISTING = 3000


def start_folder():
    """The folder the file browser opens in (saved setting or the sample data folder)."""
    saved = store.settings().get("start_folder")
    return Path(saved) if saved and Path(saved).is_dir() else ws.root


def with_state(rec):
    """Attach live facts (does the file still exist?) to a stored record."""
    rec = dict(rec)
    rec["exists"] = os.path.exists(rec["path"])
    rec["viewer"] = viewer_for(rec["ext"])
    return rec


# ------------------------------------------------------------- browsing
@bp.get("/api/fs/list")
def fs_list():
    """List a folder: sub-folders and files of a category, searchable and sortable."""
    p = ws.resolve(request.args.get("path", "") or str(start_folder()))
    if not p.is_dir():
        abort(400, "That is not a folder.")
    cat = request.args.get("category", "")
    exts = set(BY_ID[cat]["exts"]) if cat in BY_ID else set(EXT_CATEGORY)
    q = request.args.get("q", "").strip().lower()
    sort, desc = request.args.get("sort", "name"), request.args.get("order") == "desc"
    dirs, files, truncated = [], [], False
    try:
        entries = list(os.scandir(p))
    except PermissionError:
        abort(403, "Permission denied for this folder.")
    favs = {f["path"] for f in store.favorites()}
    for e in entries:
        if e.name.startswith("."):
            continue
        try:
            st = e.stat()
            if e.is_dir():
                if not q or q in e.name.lower():
                    dirs.append({"name": e.name, "path": e.path, "mtime": st.st_mtime})
            elif Path(e.name).suffix.lower() in exts and (not q or q in e.name.lower()):
                d = describe(Path(e.path), st)
                d["favorite"] = d["path"] in favs
                files.append(d)
        except OSError:
            continue
    keyf = {"name": lambda x: natural_key(x["name"]), "date": lambda x: x["mtime"],
            "size": lambda x: x.get("size", 0)}.get(sort, lambda x: natural_key(x["name"]))
    files.sort(key=keyf, reverse=desc)
    dirs.sort(key=(keyf if sort == "date" else lambda x: natural_key(x["name"])), reverse=desc and sort == "date")
    if len(files) > MAX_LISTING:
        files, truncated = files[:MAX_LISTING], True
    crumbs, cur = [], p
    while True:
        crumbs.append({"name": cur.name or str(cur), "path": str(cur)})
        if cur.parent == cur:
            break
        cur = cur.parent
    return jsonify(path=str(p), parent=str(p.parent) if p.parent != p and ws.allowed(p.parent) else None,
                   crumbs=crumbs[::-1], dirs=dirs, files=files, truncated=truncated, home=str(Path.home()))


@bp.get("/api/fs/preview")
def fs_preview():
    """Preview data for a file: highlighted head, image URL, variables of a .mat, or tables of a database."""
    p = ws.resolve(request.args.get("path", ""))
    if not p.is_file():
        abort(404, "File not found.")
    info = describe(p)
    ext = info["ext"]
    prev = {"kind": "meta"}
    try:
        if info["category"] == "images":
            prev = {"kind": "image", "url": "/api/asset?path=" + request.args["path"]}
        elif ext == ".mat":
            prev = {"kind": "list", "title": "Variables", "items": mat_variables(p)}
        elif ext in (".db", ".sqlite", ".sqlite3", ".db3"):
            prev = {"kind": "list", "title": "Tables", "items": sqlite_tables(p)}
        elif info["category"] in ("code", "text", "data"):
            with open(p, "rb") as fh:
                head = fh.read(6000)
            if b"\0" not in head:
                from viewers.code_viewer import pick_lexer
                text = head.decode("utf-8", "replace")
                lexer = pick_lexer(p, text)
                lines = text.split("\n")[:40]
                prev = {"kind": "code", "language": lexer.name, "lines": highlight_lines("\n".join(lines), lexer)}
    except Exception:  # a preview must never break browsing
        prev = {"kind": "meta"}
    return jsonify(info=info, preview=prev)


def mat_variables(p):
    """Variable names, shapes and types inside a .mat file."""
    try:
        from scipy.io import whosmat
        return [f"{n}  {'×'.join(map(str, s))}  {t}" for n, s, t in whosmat(str(p))][:40]
    except NotImplementedError:
        import h5py
        with h5py.File(p, "r") as f:
            return [f"{k}  {'×'.join(map(str, v.shape[::-1]))}" for k, v in f.items() if hasattr(v, "shape")][:40]


def sqlite_tables(p):
    """Table and view names of a SQLite database."""
    c = sqlite3.connect(f"{p.as_uri()}?mode=ro", uri=True)
    try:
        return [r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%'")][:40]
    finally:
        c.close()


# ------------------------------------------------------------- native dialog / OS integration
def run_native_dialog(mode, exts):
    """Open the operating system's own file/folder chooser on this machine. Returns a list of paths."""
    system = platform.system()
    if system == "Darwin":
        types = "{" + ",".join(f'"{e.lstrip(".")}"' for e in exts) + "}" if exts else ""
        if mode == "folder":
            body = 'set r to choose folder with prompt "Choose a folder"\nreturn POSIX path of r'
        else:
            multi = " with multiple selections allowed" if mode == "files" else ""
            of_type = f" of type {types}" if types else ""
            body = (f'set r to choose file with prompt "Choose a file"{of_type}{multi}\n'
                    'if class of r is list then\nset out to ""\nrepeat with f in r\nset out to out & POSIX path of f & linefeed\n'
                    'end repeat\nreturn out\nelse\nreturn POSIX path of r\nend if')
        script = f'tell application "System Events"\nactivate\n{body}\nend tell'
        cmd = ["osascript", "-e", script]
    elif system == "Windows":
        flt = "|".join(f"*{e}" for e in exts) or "*.*"
        multi = "$true" if mode == "files" else "$false"
        ps = ("Add-Type -AssemblyName System.Windows.Forms;"
              + ("$d=New-Object System.Windows.Forms.FolderBrowserDialog;if($d.ShowDialog() -eq 'OK'){$d.SelectedPath}" if mode == "folder" else
                 f"$d=New-Object System.Windows.Forms.OpenFileDialog;$d.Multiselect={multi};$d.Filter='Supported files|{flt.replace('|', ';')}|All files|*.*';"
                 "if($d.ShowDialog() -eq 'OK'){$d.FileNames}"))
        cmd = ["powershell", "-NoProfile", "-Command", ps]
    else:
        cmd = ["zenity", "--file-selection"] + (["--directory"] if mode == "folder" else []) + (["--multiple", "--separator=\n"] if mode == "files" else [])
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=900, check=False)
    except FileNotFoundError:
        abort(501, "No native file dialog is available on this system. Use the in-app browser instead.")
    except subprocess.TimeoutExpired:
        return []
    if out.returncode != 0:  # user cancelled (osascript -128) or dialog failed
        if "-128" in out.stderr or not out.stderr.strip():
            return []
        abort(501, "The system file dialog could not be opened. Use the in-app browser instead.")
    return [line.strip() for line in out.stdout.splitlines() if line.strip()]


@bp.post("/api/fs/native")
def fs_native():
    """Open the operating system's own file or folder chooser and return the chosen paths."""
    body = request.get_json(silent=True) or {}
    cat = BY_ID.get(body.get("category"))
    mode = body.get("mode", "file")
    if mode == "files" and cat and not cat["multi"]:
        mode = "file"
    paths = run_native_dialog(mode, cat["exts"] if cat else [])
    safe = [str(ws.resolve(p)) for p in paths if ws.allowed(Path(p).resolve())]
    return jsonify(paths=safe, skipped=len(paths) - len(safe))


@bp.post("/api/fs/external")
def fs_external():
    """Open a file, or reveal it in the file manager, with the operating system's default app."""
    body = request.get_json(silent=True) or {}
    p = ws.resolve(body.get("path", ""))
    if not p.exists():
        abort(404, "File not found.")
    reveal = body.get("action") == "reveal"
    system = platform.system()
    if system == "Darwin":
        cmd = ["open", "-R", str(p)] if reveal else ["open", str(p)]
    elif system == "Windows":
        cmd = ["explorer", f"/select,{p}"] if reveal else ["cmd", "/c", "start", "", str(p)]
    else:
        cmd = ["xdg-open", str(p.parent if reveal else p)]
    try:
        subprocess.Popen(cmd)
    except FileNotFoundError:
        abort(501, "Cannot launch the system opener on this machine.")
    return jsonify(ok=True)


# ------------------------------------------------------------- library: recents & favourites
@bp.post("/api/library/open")
def lib_open():
    """Record that a file was opened (recents, fingerprint) and return its library record."""
    p = ws.resolve((request.get_json(silent=True) or {}).get("path", ""))
    if not p.is_file():
        abort(404, "File not found. It may have been moved or deleted.")
    info = describe(p)
    info["fingerprint"] = store.fingerprint(p)
    rec = store.touch(info)
    return jsonify(with_state(rec))


@bp.get("/api/library/summary")
def lib_summary():
    """Dashboard data: categories with recent counts, pinned and recent files."""
    counts = store.recent_counts()
    cats = [{"id": c["id"], "name": c["name"], "description": c["description"], "icon": c["icon"],
             "available": c["available"], "recent": counts.get(c["id"], 0)} for c in CATEGORIES]
    cats.append({"id": "recent", "name": "Recent Files", "icon": "clock", "available": True,
                 "description": "Pick up where you left off", "recent": sum(counts.values())})
    recents = [with_state(r) for r in store.recent(limit=8)]
    pinned = [with_state(r) for r in studystore.files_with(pinned=True)]
    return jsonify(categories=cats, recents=recents, pinned=pinned, start_folder=str(start_folder()))


@bp.get("/api/library/recent")
def lib_recent():
    """Recently opened files, optionally of one category."""
    return jsonify([with_state(r) for r in store.recent(request.args.get("category"), 100)])


@bp.get("/api/library/favorites")
def lib_favorites():
    """Favourite files."""
    return jsonify([with_state(r) for r in store.favorites()])


@bp.post("/api/library/favorite")
def lib_favorite():
    """Add or remove a file from favourites."""
    body = request.get_json(silent=True) or {}
    p = ws.resolve(body.get("path", ""))
    if not store.get(str(p)):
        info = describe(p)
        store.touch(info)
        store.forget_recent_only(str(p))
    rec = store.set_flag(str(p), "favorite", bool(body.get("value", True)))
    return jsonify(with_state(rec))


@bp.post("/api/library/forget")
def lib_forget():
    """Clear recent history (one file or all); favourites and your organisation are kept."""
    body = request.get_json(silent=True) or {}
    store.forget(str(ws.resolve(body["path"])) if body.get("path") else None)
    return jsonify(ok=True)


@bp.get("/api/library/search")
def lib_search():
    """Quick filename search: recents and favourites first, then the start folder (bounded walk)."""
    q = request.args.get("q", "").strip().lower()
    if len(q) < 2:
        return jsonify([])
    seen, out = set(), []
    for r in store.recent(limit=200) + store.favorites():
        if q in r["name"].lower() and r["path"] not in seen and os.path.exists(r["path"]):
            seen.add(r["path"]); out.append({**with_state(r), "source": "recent"})
    budget, t0 = 20000, time.time()
    for dirpath, dirnames, filenames in os.walk(start_folder()):
        dirnames[:] = [d for d in dirnames if not d.startswith(".") and d not in ("node_modules", "__pycache__")]
        for fn in filenames:
            budget -= 1
            full = os.path.join(dirpath, fn)
            if q in fn.lower() and Path(fn).suffix.lower() in EXT_CATEGORY and full not in seen:
                seen.add(full)
                out.append({**describe(Path(full)), "source": "folder", "exists": True})
        if budget <= 0 or time.time() - t0 > 2 or len(out) >= 60:
            break
    return jsonify(out[:60])


@bp.get("/api/settings")
def get_settings():
    """Read user settings."""
    s = store.settings()
    s["effective_start_folder"] = str(start_folder())
    return jsonify(s)


@bp.put("/api/settings")
def put_settings():
    """Save user settings (start folder, daily goal, Pomodoro lengths)."""
    body = request.get_json(silent=True) or {}
    folder = body.get("start_folder")
    if folder:
        p = Path(folder).expanduser()
        if not p.is_dir():
            abort(400, "That start folder does not exist.")
        body["start_folder"] = str(ws.resolve(str(p)))
    for key, lo, hi in (("daily_goal_minutes", 0, 1440), ("pomo_focus", 1, 180), ("pomo_short", 1, 60), ("pomo_long", 1, 120)):
        if key in body:
            try:
                body[key] = int(body[key])
            except (TypeError, ValueError):
                abort(400, "Numbers only, please.")
            if not lo <= body[key] <= hi:
                abort(400, f"{key.replace('_', ' ')} must be between {lo} and {hi}.")
    return jsonify(store.update_settings(body))
