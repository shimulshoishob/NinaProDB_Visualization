"""Unified annotation API (all viewers) and annotated-PDF export.

An annotation = {kind, category, text (your comment), quote (the marked text), locator}.
The locator says where it is: {"start","end"} lines for code, {"page","rects"|"points"} for PDF.
"""
import io
import json
from pathlib import Path

from flask import Blueprint, Response, abort, jsonify, request
from pypdf import PdfReader, PdfWriter
from pypdf.generic import ArrayObject, DictionaryObject, FloatObject, NameObject, NumberObject, TextStringObject

import store
from catalog import ANNOTATION_CATEGORIES, ANNOTATION_KINDS, describe
from common import ws

bp = Blueprint("annotations", __name__)
MAX_TEXT, MAX_QUOTE, MAX_LOCATOR = 20_000, 4_000, 400_000


def _file_record(path_str):
    p = ws.resolve(path_str)
    if not p.is_file():
        abort(404, "File not found. It may have been moved or deleted.")
    info = describe(p)
    info["fingerprint"] = store.fingerprint(p)
    return store.ensure(info)


def _clean(body, creating):
    out = {}
    if creating or "kind" in body:
        if body.get("kind") not in ANNOTATION_KINDS:
            abort(400, "Unknown annotation type.")
        out["kind"] = body["kind"]
    if "category" in body or creating:
        cat = body.get("category", "general")
        if cat not in ANNOTATION_CATEGORIES:
            abort(400, "Unknown category.")
        out["category"] = cat
    if "text" in body or creating:
        out["text"] = str(body.get("text", ""))[:MAX_TEXT]
    if "quote" in body or creating:
        out["quote"] = str(body.get("quote", ""))[:MAX_QUOTE]
    if "locator" in body or creating:
        loc = body.get("locator")
        if not isinstance(loc, dict) or len(json.dumps(loc)) > MAX_LOCATOR:
            abort(400, "Invalid location for this annotation.")
        out["locator"] = loc
    return out


@bp.get("/api/annotations")
def list_for_file():
    """Annotations stored for one file."""
    rec = store.get(str(ws.resolve(request.args.get("path", ""))))
    return jsonify(store.ann_list(rec["id"]) if rec else [])


@bp.post("/api/annotations")
def create():
    """Create an annotation (highlight, underline, strikeout, comment, note, bookmark or drawing)."""
    body = request.get_json(silent=True) or {}
    rec = _file_record(body.get("path", ""))
    return jsonify(store.ann_add(rec["id"], **_clean(body, True)))


@bp.route("/api/annotations/<ann_id>", methods=["PATCH", "DELETE"])
def change(ann_id):
    """PATCH: edit an annotation; DELETE: remove it."""
    if not store.ann_get(ann_id):
        abort(404, "Annotation not found.")
    if request.method == "DELETE":
        store.ann_delete(ann_id)
        return jsonify(ok=True)
    return jsonify(store.ann_update(ann_id, **_clean(request.get_json(silent=True) or {}, False)))


@bp.get("/api/annotations/all")
def search_all():
    """Search annotations across all files (text, kind, category, file)."""
    file_id = None
    if request.args.get("path"):
        rec = store.get(str(ws.resolve(request.args["path"])))
        file_id = rec["id"] if rec else -1
    items = store.ann_search(request.args.get("q", "").strip(), request.args.get("kind", ""),
                             request.args.get("category", ""), file_id)
    import os
    for a in items:
        a["file"]["exists"] = os.path.exists(a["file"]["path"])
    return jsonify(items=items, categories=ANNOTATION_CATEGORIES)


# ---------------------------------------------------------------- annotated PDF export
def _rgb(hex_color):
    h = hex_color.lstrip("#")
    return ArrayObject([FloatObject(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4)])


def _markup(subtype, a, rect, quads, hex_color):
    d = DictionaryObject()
    d.update({NameObject("/Type"): NameObject("/Annot"), NameObject("/Subtype"): NameObject("/" + subtype),
              NameObject("/Rect"): ArrayObject([FloatObject(v) for v in rect]),
              NameObject("/QuadPoints"): ArrayObject([FloatObject(v) for v in quads]),
              NameObject("/C"): _rgb(hex_color), NameObject("/F"): NumberObject(4),
              NameObject("/T"): TextStringObject("Study Workspace"),
              NameObject("/Contents"): TextStringObject(a["text"] or a["quote"] or "")})
    return d


def _add_pdf_annotations(writer, anns):
    n_pages, added = len(writer.pages), 0
    for a in anns:
        loc, color = a["locator"], ANNOTATION_CATEGORIES[a["category"]]["color"]
        page = int(loc.get("page", 0)) - 1
        if not 0 <= page < n_pages or a["kind"] == "bookmark":
            continue
        rects = [r for r in loc.get("rects", []) if len(r) == 4]
        if a["kind"] in ("highlight", "underline", "strikeout", "comment") and rects:
            subtype = {"highlight": "Highlight", "underline": "Underline", "strikeout": "StrikeOut", "comment": "Highlight"}[a["kind"]]
            quads = []
            for ax, ay, bx, by in rects:
                x1, x2, y1, y2 = min(ax, bx), max(ax, bx), min(ay, by), max(ay, by)
                quads += [x1, y2, x2, y2, x1, y1, x2, y1]     # PDF order: top-left, top-right, bottom-left, bottom-right
            xs, ys = quads[0::2], quads[1::2]
            writer.add_annotation(page, _markup(subtype, a, [min(xs), min(ys), max(xs), max(ys)], quads, color))
            added += 1
        elif a["kind"] == "note" and rects:
            x, y = rects[0][0], rects[0][1]
            d = DictionaryObject()
            d.update({NameObject("/Type"): NameObject("/Annot"), NameObject("/Subtype"): NameObject("/Text"),
                      NameObject("/Rect"): ArrayObject([FloatObject(v) for v in (x, y - 18, x + 18, y)]),
                      NameObject("/Contents"): TextStringObject(a["text"]), NameObject("/Name"): NameObject("/Comment"),
                      NameObject("/C"): _rgb(color), NameObject("/F"): NumberObject(4),
                      NameObject("/T"): TextStringObject("Study Workspace")})
            writer.add_annotation(page, d)
            added += 1
        elif a["kind"] == "drawing" and loc.get("points"):
            strokes = [s for s in loc["points"] if len(s) >= 2]
            if not strokes:
                continue
            flat = [v for s in strokes for pt in s for v in pt]
            xs, ys = flat[0::2], flat[1::2]
            d = DictionaryObject()
            d.update({NameObject("/Type"): NameObject("/Annot"), NameObject("/Subtype"): NameObject("/Ink"),
                      NameObject("/Rect"): ArrayObject([FloatObject(v) for v in (min(xs) - 2, min(ys) - 2, max(xs) + 2, max(ys) + 2)]),
                      NameObject("/InkList"): ArrayObject([ArrayObject([FloatObject(v) for pt in s for v in pt]) for s in strokes]),
                      NameObject("/C"): _rgb(color), NameObject("/F"): NumberObject(4),
                      NameObject("/BS"): DictionaryObject({NameObject("/W"): FloatObject(float(loc.get("width", 2)))}),
                      NameObject("/Contents"): TextStringObject(a["text"])})
            writer.add_annotation(page, d)
            added += 1
    marks = [a for a in anns if a["kind"] == "bookmark" and 0 < int(a["locator"].get("page", 0)) <= n_pages]
    if marks:                                   # bookmarks become entries in the PDF's own outline
        parent = writer.add_outline_item(title="Study bookmarks", page_number=0)
        for a in sorted(marks, key=lambda x: x["locator"]["page"]):
            writer.add_outline_item(title=a["text"] or f"Page {a['locator']['page']}", page_number=a["locator"]["page"] - 1, parent=parent)
    return added


@bp.get("/api/pdf/export")
def export_pdf():
    """A copy of the PDF with your highlights, underlines, notes, drawings and bookmarks embedded."""
    p = ws.resolve(request.args.get("path", ""))
    if p.suffix.lower() != ".pdf" or not p.is_file():
        abort(404, "PDF not found.")
    rec = store.get(str(p))
    anns = store.ann_list(rec["id"]) if rec else []
    try:
        writer = PdfWriter(clone_from=PdfReader(str(p)))
        added = _add_pdf_annotations(writer, anns)
    except Exception as e:
        abort(400, f"Could not export this PDF: {e}")
    buf = io.BytesIO()
    writer.write(buf)
    name = Path(p.stem + ".annotated.pdf").name
    return Response(buf.getvalue(), mimetype="application/pdf", headers={
        "Content-Disposition": f'attachment; filename="{name}"', "X-Annotations-Embedded": str(added)})
