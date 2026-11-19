"""SQL viewer API: highlight/format .sql scripts, browse SQLite DBs read-only."""
import csv
import io
import re
import sqlite3
import threading
import time
import uuid

import sqlparse
from flask import Blueprint, Response, abort, jsonify, request
from pygments.lexers import SqlLexer

from catalog import VIEWER_EXTS
from common import highlight_lines, read_text, ws

bp = Blueprint("sql_viewer", __name__)

LOCK = threading.RLock()
SANDBOXES = {}          # id -> in-memory sqlite3 connection (script executed into it)
QUERY_ROW_LIMIT = 1000
QUERY_TIMEOUT = 8       # seconds


READ_ONLY_START = re.compile(r"^\s*(select|with|values|pragma|explain)\b", re.I)
SCRIPT_FORBIDDEN = re.compile(r"^\s*(vacuum|attach|detach)\b", re.I)    # would touch files outside the throw-away database


def strip_comments(sql):
    """SQL without leading comments (so the first keyword can be checked)."""
    return re.sub(r"^(\s*(--[^\n]*\n|/\*.*?\*/))*", "", sql, flags=re.S)


# ------------------------------------------------------------- helpers
def deny_dangerous(action, *_):
    """Authorizer: never allow ATTACH/DETACH (would touch other files on disk)."""
    if action in (sqlite3.SQLITE_ATTACH, sqlite3.SQLITE_DETACH):
        return sqlite3.SQLITE_DENY
    return sqlite3.SQLITE_OK


def open_handle(handle):
    """Return a connection for 'file:<relpath>' or 'sandbox:<id>' (caller closes files)."""
    kind, _, ref = handle.partition(":")
    if kind == "sandbox":
        conn = SANDBOXES.get(ref)
        if not conn:
            abort(404, "Sandbox expired. Run the script again.")
        return conn, False
    if kind == "file":
        p = ws.resolve(ref)
        if not p.is_file() or p.suffix.lower() not in VIEWER_EXTS["sql"]:
            abort(404, "Database not found.")
        try:
            conn = sqlite3.connect(f"{p.as_uri()}?mode=ro", uri=True, check_same_thread=False)
            conn.execute("SELECT count(*) FROM sqlite_master")  # validates it is a database
        except sqlite3.DatabaseError:
            abort(400, "This file is not a valid SQLite database.")
        conn.set_authorizer(deny_dangerous)
        return conn, True
    abort(400, "Bad database handle.")


def q_ident(name):
    """Quote an SQL identifier."""
    return '"' + name.replace('"', '""') + '"'


def cellv(v):
    """JSON-safe version of a database value (blobs become a size label)."""
    if isinstance(v, bytes):
        return f"<BLOB {len(v)} bytes>"
    if isinstance(v, float) and v != v:
        return None
    return v


class Timeout(Exception):
    pass


def run_readonly(conn, sql, params=(), limit=QUERY_ROW_LIMIT):
    """Run one statement without allowing writes; returns (columns, rows, truncated)."""
    deadline = time.time() + QUERY_TIMEOUT
    with LOCK:
        conn.execute("PRAGMA query_only=ON")
        conn.set_progress_handler(lambda: 1 if time.time() > deadline else 0, 20000)
        try:
            cur = conn.execute(sql, params)
            cols = [d[0] for d in cur.description] if cur.description else []
            rows = cur.fetchmany(limit + 1)
        finally:
            conn.set_progress_handler(None, 0)
            conn.execute("PRAGMA query_only=OFF")
    truncated = len(rows) > limit
    return cols, [[cellv(v) for v in r] for r in rows[:limit]], truncated


def schema(conn):
    """Tables and views with columns, row counts, DDL, indexes and foreign keys."""
    with LOCK:
        objs = conn.execute("SELECT type,name,tbl_name,sql FROM sqlite_master "
                            "WHERE name NOT LIKE 'sqlite_%' ORDER BY type DESC, name").fetchall()
        out = []
        for typ, name, _tbl, ddl in objs:
            if typ not in ("table", "view"):
                continue
            cols = [{"name": c[1], "type": c[2], "notnull": bool(c[3]), "pk": bool(c[5]),
                     "default": c[4]} for c in conn.execute(f"PRAGMA table_info({q_ident(name)})")]
            try:
                n = conn.execute(f"SELECT count(*) FROM {q_ident(name)}").fetchone()[0]
            except sqlite3.Error:
                n = None
            idx = [d for t, nm, tb, d in objs if t == "index" and tb == name and d]
            fks = [{"from": f[3], "table": f[2], "to": f[4]} for f in
                   conn.execute(f"PRAGMA foreign_key_list({q_ident(name)})")] if typ == "table" else []
            out.append({"name": name, "type": typ, "rows": n, "columns": cols, "ddl": ddl,
                        "indexes": idx, "fks": fks})
        return out


# ------------------------------------------------------------- pages / script API
def split_statements(text):
    """Split a script into statements with type, name and line number."""
    out, pos = [], 0
    for stmt in sqlparse.split(text):
        s = stmt.strip()
        if not s:
            continue
        i = text.find(stmt, pos)
        i = pos if i < 0 else i
        pos = i + len(stmt)
        lead = len(stmt) - len(stmt.lstrip())
        line = text.count("\n", 0, i + lead) + 1
        parsed = sqlparse.parse(s)[0]
        kind = parsed.get_type()
        if kind == "UNKNOWN":
            kind = s.split(None, 1)[0].upper().rstrip(";") if s.split() else "?"
        m = re.search(r"(?i)\b(?:TABLE|VIEW|INDEX|TRIGGER|INTO|UPDATE|FROM)\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?[`\"\[]?([\w.]+)", s)
        out.append({"type": kind, "name": m.group(1) if m else "", "line": line, "sql": s})
    return out


@bp.get("/api/sql/script")
def script():
    """Highlighted lines and statement outline of a .sql script."""
    p = ws.resolve(request.args.get("path", ""))
    if p.suffix.lower() != ".sql" or not p.is_file():
        abort(404, "Script not found.")
    text, truncated = read_text(p, 5_000_000)
    stmts = split_statements(text)
    return jsonify(lines=highlight_lines(text, SqlLexer()), text=text, truncated=truncated,
                   statements=[{k: v for k, v in s.items() if k != "sql"} for s in stmts])


@bp.post("/api/sql/format")
def fmt():
    """Re-indent SQL text and return it highlighted."""
    text = (request.get_json(silent=True) or {}).get("text", "")
    formatted = sqlparse.format(text, reindent=True, keyword_case="upper", indent_width=2)
    return jsonify(lines=highlight_lines(formatted, SqlLexer()), text=formatted)


@bp.post("/api/sql/sandbox")
def sandbox():
    """Execute a .sql script in a throw-away in-memory SQLite database."""
    p = ws.resolve((request.get_json(silent=True) or {}).get("path", ""))
    if p.suffix.lower() != ".sql" or not p.is_file():
        abort(404, "Script not found.")
    text, _ = read_text(p, 5_000_000)
    conn = sqlite3.connect(":memory:", check_same_thread=False)
    conn.set_authorizer(deny_dangerous)
    errors, ok = [], 0
    for s in split_statements(text):
        if SCRIPT_FORBIDDEN.match(strip_comments(s["sql"])):
            errors.append({"line": s["line"], "error": "VACUUM, ATTACH and DETACH are not allowed in the sandbox.", "sql": s["sql"][:160]})
            continue
        try:
            with LOCK:
                conn.execute(s["sql"])
            ok += 1
        except sqlite3.Error as e:
            errors.append({"line": s["line"], "error": str(e), "sql": s["sql"][:160]})
    with LOCK:
        conn.commit()
    sid = uuid.uuid4().hex[:10]
    SANDBOXES[sid] = conn
    while len(SANDBOXES) > 5:
        SANDBOXES.pop(next(iter(SANDBOXES))).close()
    return jsonify(handle=f"sandbox:{sid}", ok=ok, errors=errors)


# ------------------------------------------------------------- database API
@bp.get("/api/db/info")
def db_info():
    """Schema of a database handle ("file:<path>" or "sandbox:<id>")."""
    conn, close = open_handle(request.args.get("handle", ""))
    try:
        return jsonify(objects=schema(conn))
    finally:
        if close:
            conn.close()


@bp.get("/api/db/rows")
def db_rows():
    """A page of table rows with optional sort and text filter."""
    conn, close = open_handle(request.args.get("handle", ""))
    try:
        table = request.args.get("table", "")
        info = {o["name"]: o for o in schema(conn)}
        if table not in info:
            abort(404, "Unknown table.")
        cols = [c["name"] for c in info[table]["columns"]]
        where, params = "", []
        q = request.args.get("q", "").strip()
        if q:
            where = " WHERE " + " OR ".join(f"CAST({q_ident(c)} AS TEXT) LIKE ?" for c in cols)
            params = [f"%{q}%"] * len(cols)
        order = ""
        sort = request.args.get("sort")
        if sort in cols:
            order = f" ORDER BY {q_ident(sort)} {'DESC' if request.args.get('desc') == '1' else 'ASC'}"
        limit = max(1, min(1000, request.args.get("limit", 100, type=int)))
        offset = max(0, request.args.get("offset", 0, type=int))
        t = q_ident(table)
        with LOCK:
            total = conn.execute(f"SELECT count(*) FROM {t}{where}", params).fetchone()[0]
        _, rows, _ = run_readonly(conn, f"SELECT * FROM {t}{where}{order} LIMIT {limit} OFFSET {offset}", params, limit)
        return jsonify(columns=cols, rows=rows, total=total, offset=offset)
    except sqlite3.Error as e:
        return jsonify(error=str(e)), 400
    finally:
        if close:
            conn.close()


@bp.post("/api/db/query")
def db_query():
    """Run one read-only SELECT / PRAGMA / EXPLAIN query (8 s limit, 1000 rows shown)."""
    body = request.get_json(silent=True) or {}
    conn, close = open_handle(body.get("handle", ""))
    sql = body.get("sql", "").strip().rstrip(";")
    if not sql:
        return jsonify(error="Type a query first."), 400
    if not READ_ONLY_START.match(strip_comments(sql)):
        return jsonify(error="The console is read-only: only SELECT, WITH, VALUES, PRAGMA and EXPLAIN queries are allowed."), 400
    t0 = time.time()
    try:
        cols, rows, trunc = run_readonly(conn, sql)
        return jsonify(columns=cols, rows=rows, truncated=trunc, ms=round((time.time() - t0) * 1000, 1))
    except sqlite3.Error as e:
        msg = str(e)
        if "interrupted" in msg:
            msg = f"Query stopped after {QUERY_TIMEOUT}s."
        elif "readonly" in msg.lower() or "query_only" in msg.lower():
            msg = "The console is read-only: only SELECT / PRAGMA / EXPLAIN queries are allowed."
        return jsonify(error=msg), 400
    finally:
        if close:
            conn.close()


@bp.get("/api/db/export.csv")
def db_export():
    """Download a table or a query result as CSV."""
    conn, close = open_handle(request.args.get("handle", ""))
    table, sql = request.args.get("table"), request.args.get("sql")
    try:
        if table:
            if table not in {o["name"] for o in schema(conn)}:
                abort(404, "Unknown table.")
            sql = f"SELECT * FROM {q_ident(table)}"
        elif not sql:
            abort(400, "Nothing to export.")
        cols, rows, _ = run_readonly(conn, sql.strip().rstrip(";"), limit=1_000_000)
    except sqlite3.Error as e:
        abort(400, str(e))
    finally:
        if close:
            conn.close()
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(cols)
    w.writerows(rows)
    name = re.sub(r"[^\w.-]+", "_", table or "query") + ".csv"
    return Response(buf.getvalue(), mimetype="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="{name}"'})

