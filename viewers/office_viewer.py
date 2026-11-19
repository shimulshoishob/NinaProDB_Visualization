"""Word (.docx) and PowerPoint (.pptx) readers. Output is a faithful *reading* view, not a pixel-perfect render."""
import base64
import re

import mammoth
import nh3
from flask import Blueprint, abort, jsonify, request
from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE_TYPE
from pptx.util import Emu

from common import ws

bp = Blueprint("office_viewer", __name__)
MAX_BYTES = 60 * 1024 * 1024
TAGS = set(nh3.ALLOWED_TAGS) | {"table", "thead", "tbody", "tr", "td", "th", "img", "sup", "sub", "br", "strong", "em", "u", "s"}
ATTRS = {"*": {"id"}, "a": {"href"}, "img": {"src", "alt"}, "td": {"colspan", "rowspan"}, "th": {"colspan", "rowspan"}}


def _checked(request_path, suffix):
    p = ws.resolve(request_path)
    if p.suffix.lower() != suffix or not p.is_file():
        abort(404, "File not found.")
    if p.stat().st_size > MAX_BYTES:
        abort(413, f"File is larger than {MAX_BYTES // 1048576} MB.")
    return p


def _attr_filter(tag, attr, value):
    # images may be inline data: URIs (that is how Word embeds them); no other element may use data:/javascript:
    if value.lower().lstrip().startswith(("javascript:", "vbscript:")):
        return None
    if value.lower().lstrip().startswith("data:") and not (tag == "img" and value.lower().startswith("data:image/")):
        return None
    return value


@bp.get("/api/docx")
def docx():
    """Word document converted to sanitised HTML with a table of contents."""
    p = _checked(request.args.get("path", ""), ".docx")
    try:
        with open(p, "rb") as f:
            result = mammoth.convert_to_html(f, style_map="p[style-name='Title'] => h1:fresh")
    except Exception as e:  # not a valid docx
        abort(400, f"Could not read this Word document: {e}")
    html = nh3.clean(result.value, tags=TAGS, attributes=ATTRS, attribute_filter=_attr_filter,
                     url_schemes={"http", "https", "mailto", "data"}, link_rel=None)
    toc, n = [], 0

    def add_id(m):
        """Give a heading an id and record it in the table of contents."""
        nonlocal n
        n += 1
        text = re.sub(r"<[^>]+>", "", m.group(2)).strip()
        toc.append({"id": f"h{n}", "level": int(m.group(1)), "text": text})
        return f'<h{m.group(1)} id="h{n}">{m.group(2)}</h{m.group(1)}>'

    html = re.sub(r"<h([1-6])(?:\s[^>]*)?>(.*?)</h\1>", add_id, html, flags=re.S)
    words = len(re.findall(r"\w+", re.sub(r"<[^>]+>", " ", html)))
    return jsonify(html=html, toc=[t for t in toc if t["text"]], words=words, minutes=max(1, round(words / 220)),
                   warnings=len(result.messages))


# ---------------------------------------------------------------- pptx
def _paragraphs(tf):
    out = []
    for para in tf.paragraphs:
        text = "".join(r.text for r in para.runs) or para.text
        if not text.strip():
            continue
        size = next((r.font.size.pt for r in para.runs if r.font.size), None)
        bold = any(r.font.bold for r in para.runs)
        out.append({"text": text, "level": para.level, "size": size, "bold": bool(bold)})
    return out


def _shapes(shapes, sw, sh, budget):
    out = []
    for shp in shapes:
        try:
            if shp.shape_type == MSO_SHAPE_TYPE.GROUP:
                out += _shapes(shp.shapes, sw, sh, budget)
                continue
            if shp.left is None or shp.width is None:
                box = {"x": 5, "y": 5 + 12 * len(out), "w": 90, "h": 10}
            else:
                box = {"x": 100 * shp.left / sw, "y": 100 * shp.top / sh, "w": 100 * shp.width / sw, "h": 100 * shp.height / sh}
            if shp.shape_type == MSO_SHAPE_TYPE.PICTURE:
                blob = shp.image.blob
                if len(blob) < 4 * 1024 * 1024 and budget["bytes"] > 0:
                    budget["bytes"] -= len(blob)
                    out.append({**box, "type": "image", "src": f"data:{shp.image.content_type};base64," + base64.b64encode(blob).decode()})
            elif shp.has_table if hasattr(shp, "has_table") else False:
                out.append({**box, "type": "table", "rows": [[c.text for c in r.cells] for r in shp.table.rows]})
            elif shp.has_text_frame and shp.text_frame.text.strip():
                out.append({**box, "type": "text", "paras": _paragraphs(shp.text_frame),
                            "title": bool(shp.is_placeholder and shp.placeholder_format.type is not None and "TITLE" in str(shp.placeholder_format.type))})
        except Exception:  # one odd shape must not break the slide
            continue
    return out


@bp.get("/api/pptx")
def pptx():
    """Slides of a PowerPoint file: shapes with positions, text, tables, images and notes."""
    p = _checked(request.args.get("path", ""), ".pptx")
    try:
        prs = Presentation(str(p))
    except Exception as e:
        abort(400, f"Could not read this presentation: {e}")
    sw, sh = prs.slide_width, prs.slide_height
    budget = {"bytes": 40 * 1024 * 1024}
    slides = []
    for i, slide in enumerate(prs.slides, 1):
        shapes = _shapes(slide.shapes, sw, sh, budget)
        title = next((" ".join(x["text"] for x in s["paras"]) for s in shapes if s["type"] == "text" and s.get("title")), "")
        notes = slide.notes_slide.notes_text_frame.text if slide.has_notes_slide else ""
        slides.append({"n": i, "title": title or f"Slide {i}", "shapes": shapes, "notes": notes})
    return jsonify(width=Emu(sw).inches, height=Emu(sh).inches, slides=slides)
