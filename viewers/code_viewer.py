"""Code viewer API: syntax highlighting (Pygments), outline, and edit/save with backup. Annotations live in the unified store."""
import re
import shutil
import time
from pathlib import Path

from flask import Blueprint, abort, jsonify, request
from pygments.lexers import (MatlabLexer, TextLexer, get_all_lexers, get_lexer_by_name,
                             get_lexer_for_filename, guess_lexer)
from pygments.util import ClassNotFound

from common import highlight_lines, read_text, ws

bp = Blueprint("code_viewer", __name__)
MAX_BYTES = 2_000_000


# ------------------------------------------------------------- language detection
def pick_lexer(path, text, lang=None):
    """Choose the Pygments lexer: explicit language, file name, then content guess."""
    if lang:
        try:
            return get_lexer_by_name(lang)
        except ClassNotFound:
            pass
    if path.suffix.lower() == ".m":
        return MatlabLexer()
    try:
        return get_lexer_for_filename(path.name, text[:20000])
    except ClassNotFound:
        pass
    try:
        if len(text) > 50 and path.suffix.lower() not in (".txt", ".log", ".csv"):
            return guess_lexer(text[:20000])
    except ClassNotFound:
        pass
    return TextLexer()


# ------------------------------------------------------------- outline (functions / classes)
_C_FUNC = re.compile(r"^[A-Za-z_][\w\s\*&:<>,\[\]]*?\b(\w+)\s*\([^;{}]*\)\s*(?:const\s*)?(?:\{|$)")
OUTLINE_RULES = {
    "python": [("class", r"^\s*class\s+(\w+)"), ("function", r"^\s*(?:async\s+)?def\s+(\w+)")],
    "js": [("class", r"^\s*(?:export\s+(?:default\s+)?)?class\s+(\w+)"),
           ("function", r"^\s*(?:export\s+(?:default\s+)?)?(?:async\s+)?function\*?\s+(\w+)"),
           ("function", r"^\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*=>")],
    "java": [("class", r"^\s*(?:(?:public|private|protected|abstract|final|static)\s+)*(?:class|interface|enum|record)\s+(\w+)"),
             ("function", r"^\s*(?:(?:public|private|protected|static|final|abstract|synchronized|override|suspend)\s+)+[\w<>\[\],\s\?]+?\s+(\w+)\s*\([^;]*\)\s*(?:throws\s+[\w,\s]+)?\{?\s*$")],
    "kotlin": [("class", r"^\s*(?:(?:data|sealed|open|abstract|private|internal|enum)\s+)*(?:class|interface|object)\s+(\w+)"), ("function", r"^\s*(?:(?:private|public|internal|override|suspend|inline)\s+)*fun\s+(?:<[^>]+>\s*)?(?:[\w.]+\.)?(\w+)")],
    "c": [("class", r"^\s*(?:typedef\s+)?(?:struct|class|enum|union)\s+(\w+)\s*(?:\{|:|$)"), ("function", None)],
    "go": [("class", r"^type\s+(\w+)\s+(?:struct|interface)"), ("function", r"^func\s+(?:\([^)]*\)\s*)?(\w+)")],
    "rust": [("class", r"^\s*(?:pub(?:\([^)]*\))?\s+)?(?:struct|enum|trait|impl(?:<[^>]*>)?)\s+(\w+)"), ("function", r"^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+(\w+)")],
    "php": [("class", r"^\s*(?:abstract\s+|final\s+)?(?:class|interface|trait)\s+(\w+)"), ("function", r"^\s*(?:(?:public|private|protected|static)\s+)*function\s+&?(\w+)")],
    "ruby": [("class", r"^\s*(?:class|module)\s+([\w:]+)"), ("function", r"^\s*def\s+(?:self\.)?(\w+[?!=]?)")],
    "shell": [("function", r"^\s*(?:function\s+)?(\w+)\s*\(\)\s*\{?"), ("function", r"^\s*function\s+(\w+)")],
    "sql": [("class", r"^\s*CREATE\s+(?:OR\s+REPLACE\s+)?(?:TEMP(?:ORARY)?\s+)?(?:TABLE|VIEW)\s+(?:IF\s+NOT\s+EXISTS\s+)?[`\"\[]?([\w.]+)"),
            ("function", r"^\s*CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE|TRIGGER)\s+[`\"\[]?([\w.]+)")],
    "matlab": [("function", r"^\s*function\s+(?:[^=]+=\s*)?(\w+)")],
    "markdown": [("class", r"^(#{1,4})\s+(.+)$")],
}
ALIAS_GROUP = {"python": "python", "py": "python", "python3": "python", "javascript": "js", "js": "js", "typescript": "js", "ts": "js",
               "tsx": "js", "jsx": "js", "java": "java", "csharp": "java", "cs": "java", "scala": "java", "kotlin": "kotlin", "c": "c", "cpp": "c",
               "go": "go", "rust": "rust", "php": "php", "ruby": "ruby", "rb": "ruby", "bash": "shell", "sh": "shell", "shell": "shell",
               "zsh": "shell", "sql": "sql", "mysql": "sql", "postgresql": "sql", "sqlite3": "sql", "matlab": "matlab", "objective-c": "c"}
C_KEYWORDS = {"if", "for", "while", "switch", "return", "else", "sizeof", "catch", "do"}


def make_outline(alias, raw_lines):
    """Find functions, classes and similar landmarks in source lines (regular-expression based)."""
    group = ALIAS_GROUP.get(alias)
    if not group or len(raw_lines) > 30000:
        return []
    rules = [(k, re.compile(r, re.I if group == "sql" else 0) if r else None) for k, r in OUTLINE_RULES[group]]
    out = []
    for i, line in enumerate(raw_lines, 1):
        if len(line) > 300:
            continue
        for kind, rx in rules:
            m = rx.match(line) if rx else _C_FUNC.match(line)
            if m and not (group == "c" and kind == "function" and (m.group(1) in C_KEYWORDS or line.startswith((" ", "\t")) and not line.rstrip().endswith("{") and "(" not in line)):
                if group == "c" and kind == "function" and line.startswith(("\t", "        ")):
                    continue  # calls inside bodies, not definitions
                out.append({"line": i, "kind": kind, "name": m.group(m.lastindex or 1).strip(), "indent": len(line) - len(line.lstrip())})
                break
    return out


@bp.get("/api/code")
def code():
    """Highlighted lines, raw lines, language, outline and line-ending flag for a source file."""
    p = ws.resolve(request.args.get("path", ""))
    if not p.is_file():
        abort(404, "File not found.")
    with open(p, "rb") as fh:
        if b"\0" in fh.read(8192):
            abort(415, "This looks like a binary file, so it cannot be shown as code.")
    text, truncated = read_text(p, MAX_BYTES)
    lexer = pick_lexer(p, text, request.args.get("lang"))
    lines = highlight_lines(text, lexer)
    raw = text.split("\n")[:len(lines)]
    alias = lexer.aliases[0] if lexer.aliases else "text"
    return jsonify(lines=lines, raw=raw, language=lexer.name, alias=alias, truncated=truncated,
                   size=p.stat().st_size, outline=make_outline(alias, raw), eol=text.endswith("\n"))


@bp.post("/api/code/highlight")
def highlight_text():
    """Highlight text that is not on disk (the working copy after Find & Replace)."""
    body = request.get_json(silent=True) or {}
    text = str(body.get("text", ""))[:MAX_BYTES]
    lexer = pick_lexer(Path(body.get("name") or "x.txt"), text, body.get("lang") or None)
    lines = highlight_lines(text, lexer)
    raw = text.split("\n")[:len(lines)]
    alias = lexer.aliases[0] if lexer.aliases else "text"
    return jsonify(lines=lines, raw=raw, outline=make_outline(alias, raw))


@bp.post("/api/code/save")
def save_file():
    """Write edited text back to the original file. Only on explicit request; a backup copy is kept first."""
    body = request.get_json(silent=True) or {}
    if body.get("confirm") is not True:
        abort(400, "Saving must be confirmed explicitly.")
    p = ws.resolve(body.get("path", ""))
    if not p.is_file():
        abort(404, "File not found.")
    with open(p, "rb") as fh:
        if b"\0" in fh.read(8192):
            abort(415, "Binary files cannot be edited.")
    text = str(body.get("text", ""))
    if len(text.encode("utf-8")) > MAX_BYTES:
        abort(413, "File is too large to save from the viewer.")
    backup = p.with_name(f"{p.name}.bak-{time.strftime('%Y%m%d-%H%M%S')}")
    shutil.copy2(p, backup)
    p.write_text(text, encoding="utf-8")
    return jsonify(ok=True, backup=str(backup))


@bp.get("/api/languages")
def languages():
    """All language names and aliases Pygments can highlight."""
    return jsonify([{"name": n, "alias": a[0]} for n, a, *_ in get_all_lexers() if a])
