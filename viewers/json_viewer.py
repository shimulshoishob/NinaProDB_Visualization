"""JSON viewer API: serves the raw text; parsing/rendering happens in the browser."""
from flask import Blueprint, abort, jsonify, request

from catalog import VIEWER_EXTS
from common import read_text, ws

bp = Blueprint("json_viewer", __name__)
MAX_BYTES = 100 * 1024 * 1024


@bp.get("/api/json/text")
def text():
    """Raw text of a JSON / JSON Lines file (parsed in the browser)."""
    p = ws.resolve(request.args.get("path", ""))
    if not p.is_file() or p.suffix.lower() not in VIEWER_EXTS["json"]:
        abort(404, "File not found.")
    if p.stat().st_size > MAX_BYTES:
        return jsonify(error=f"File is larger than {MAX_BYTES // 1048576} MB."), 413
    content, _ = read_text(p, MAX_BYTES)
    return jsonify(text=content, size=len(content.encode("utf-8", "ignore")))

