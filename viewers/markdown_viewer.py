"""Markdown viewer API: GitHub-style rendering with sanitised HTML."""
import re

import markdown
import nh3
from flask import Blueprint, abort, jsonify, request

from catalog import VIEWER_EXTS
from common import read_text, ws

bp = Blueprint("md_viewer", __name__)

EXTENSIONS = [
    "extra", "toc", "sane_lists", "admonition", "footnotes", "attr_list", "md_in_html",
    "pymdownx.superfences", "pymdownx.tasklist", "pymdownx.tilde", "pymdownx.mark",
    "pymdownx.highlight", "pymdownx.magiclink", "pymdownx.emoji", "pymdownx.caret",
]
EXT_CFG = {
    "toc": {"permalink": "#", "toc_depth": "1-4"},
    "pymdownx.highlight": {"css_class": "hl", "guess_lang": False, "use_pygments": True},
    "pymdownx.tasklist": {"custom_checkbox": False},
    "pymdownx.magiclink": {"repo_url_shorthand": False},
}
TAGS = set(nh3.ALLOWED_TAGS) | {"input", "span", "div", "pre", "code", "mark", "details", "summary",
                                "sup", "sub", "figure", "figcaption", "del", "ins", "kbd", "img"}
ATTRS = {"*": {"class", "id", "title"}, "a": {"href", "name", "target", "rel"},
         "img": {"src", "alt", "width", "height"}, "input": {"type", "checked", "disabled"},
         "th": {"align"}, "td": {"align"}, "ol": {"start"}, "li": {"id"}, "details": {"open"}}


def render(text):
    """Convert Markdown to sanitised HTML; returns (html, table-of-contents tokens)."""
    md = markdown.Markdown(extensions=EXTENSIONS, extension_configs=EXT_CFG)
    body = md.convert(text)
    body = nh3.clean(body, tags=TAGS, attributes=ATTRS, link_rel=None, strip_comments=True,
                     url_schemes={"http", "https", "mailto", "tel"} )
    return body, md.toc_tokens


def flat_toc(tokens, out=None):
    """Flatten nested table-of-contents tokens into a list."""
    out = [] if out is None else out
    for t in tokens:
        out.append({"id": t["id"], "text": re.sub(r"\s*#$", "", t["name"]), "level": t["level"]})
        flat_toc(t.get("children", []), out)
    return out


@bp.get("/api/md")
def md_file():
    """Rendered HTML, source, outline and reading statistics of a Markdown file."""
    p = ws.resolve(request.args.get("path", ""))
    if not p.is_file() or p.suffix.lower() not in VIEWER_EXTS["md"]:
        abort(404, "File not found.")
    text, truncated = read_text(p, 5_000_000)
    html_body, toc = render(text)
    words = len(re.findall(r"\w+", text))
    return jsonify(source=text, html=html_body, toc=flat_toc(toc), words=words,
                   minutes=max(1, round(words / 220)), lines=text.count("\n") + 1,
                   truncated=truncated, dir=p.parent.as_posix())


@bp.post("/api/render")
def render_live():
    """Render arbitrary markdown text (used by the live editor/split view)."""
    text = (request.get_json(silent=True) or {}).get("text", "")
    html_body, toc = render(text[:5_000_000])
    return jsonify(html=html_body, toc=flat_toc(toc))

