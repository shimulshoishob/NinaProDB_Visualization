"""Core helpers: file access rules (Workspace), shared endpoints and syntax-highlight helpers."""
import html
import os
import re
from pathlib import Path
from urllib.parse import urlparse

from flask import abort, jsonify, request, send_file, Response
from pygments.formatters import HtmlFormatter
from pygments.token import STANDARD_TYPES, Token


BASE = Path(__file__).resolve().parent
HOST_OK = {"127.0.0.1", "localhost", "[::1]", "::1"}


def natural_key(s):
    """Sort key that orders "file2" before "file10"."""
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", s)]


class Workspace:
    """Which files the app may read.

    The app only serves a single local user, but it still limits reads to the user's home
    folder, the project folder and mounted drives, and never serves hidden (dot) folders
    such as ~/.ssh.
    """

    def __init__(self, root):
        self.root = Path(root).expanduser().resolve()  # default start folder (sample data)

    def bases(self):
        """Folders the app may read from: home, the project folder and mounted drives."""
        bases = [Path.home().resolve(), self.root]
        for extra in ("/Volumes", "/mnt", "/media"):
            if Path(extra).is_dir():
                bases.append(Path(extra))
        if os.name == "nt":
            bases += [Path(f"{d}:\\") for d in "CDEFGHIJKLMNOPQRSTUVWXYZ" if Path(f"{d}:\\").exists()]
        return bases

    def allowed(self, path: Path):
        """True if the path is inside an allowed base and none of its parts is hidden (starts with a dot)."""
        for b in self.bases():
            if path == b or b in path.parents:
                return not any(part.startswith(".") for part in path.relative_to(b).parts)
        return False

    def resolve(self, p=""):
        """Absolute path (or a path relative to the default folder), checked against the access rules."""
        raw = Path(p).expanduser() if p else self.root
        path = (raw if raw.is_absolute() else self.root / raw).resolve()
        if not self.allowed(path):
            abort(403, "This location is outside your home folder or is hidden, so it cannot be opened.")
        return path


ws = Workspace(BASE / "data")


def read_text(path, limit=5_000_000):
    """Read a text file (UTF-8, falling back to Latin-1). Returns (text, truncated)."""
    with open(path, "rb") as f:
        raw = f.read(limit + 1)
    truncated = len(raw) > limit
    raw = raw[:limit]
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("latin-1")
    return text, truncated


def _css_class(ttype):
    while ttype not in STANDARD_TYPES:
        ttype = ttype.parent
    return STANDARD_TYPES[ttype]


CODE_THEMES = ("solarized-light", "solarized-dark", "one-dark", "dracula", "nord")


def _code_themes_css():
    """Optional colour themes for the code viewer, scoped to `.cwrap[data-ct="<name>"]` (the viewer's wrapper)."""
    out = []
    for name in CODE_THEMES:
        fmt = HtmlFormatter(style=name)
        sel = f'html .cwrap[data-ct="{name}"]'
        bg = (fmt.style.background_color or "#ffffff").lstrip("#")
        if len(bg) == 3:
            bg = "".join(c * 2 for c in bg)
        r, g, b = (int(bg[i:i + 2], 16) for i in (0, 2, 4))
        dark = 0.299 * r + 0.587 * g + 0.114 * b < 128
        fg = fmt.style.style_for_token(Token.Text).get("color") or ("e6e6e6" if dark else "1d1d1f")
        out.append(fmt.get_style_defs(sel))
        out.append(f"{sel}{{--cb:#{bg};--cf:#{fg};}}")
    return "\n".join(out) + "\n"


def highlight_lines(code, lexer):
    """Return a list of HTML strings, one per source line (spans never cross lines)."""
    lines, cur = [], []
    for ttype, value in lexer.get_tokens(code):
        cls = _css_class(ttype)
        parts = value.split("\n")
        for i, part in enumerate(parts):
            if i > 0:
                lines.append("".join(cur))
                cur = []
            if part:
                esc = html.escape(part)
                cur.append(f'<span class="{cls}">{esc}</span>' if cls else esc)
    if cur:
        lines.append("".join(cur))
    # lexers append a trailing newline; drop the phantom last empty line
    if lines and code.endswith("\n") is False and not lines[-1]:
        lines.pop()
    n = code.count("\n") + (0 if code.endswith("\n") or not code else 1)
    return lines[:max(n, 1)] if code else [""]


# Content-Security-Policy for the app itself: everything comes from this server; inline scripts/styles are
# needed by the small bootstrap snippets; blob: is used by pdf.js; nothing may frame the app from another site.
CSP = ("default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; "
       "img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; "
       "frame-ancestors 'self'; base-uri 'self'; form-action 'self'")
ACTIVE_TYPES = ("text/html", "image/svg+xml", "application/xhtml+xml", "text/xml", "application/xml")


def register_common(app, ws, default_port):
    """Attach the shared hooks and endpoints to the Flask app and return a run() function."""

    @app.before_request
    def only_local_hosts():
        """Reject requests whose Host header is not localhost, and cross-site state-changing requests."""
        # DNS rebinding: a web page cannot reach this server under another host name.
        if request.host.rsplit(":", 1)[0] not in HOST_OK:
            abort(403, "Unexpected Host header.")
        # CSRF: browsers send Origin on cross-site POST/PUT/PATCH/DELETE; it must be this app.
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            origin = request.headers.get("Origin")
            if origin and urlparse(origin).netloc != request.host:
                abort(403, "Cross-site request blocked.")

    @app.after_request
    def add_headers(resp):
        """Add security headers (CSP, no-sniff, referrer policy) to every response."""
        resp.headers.setdefault("X-Content-Type-Options", "nosniff")
        resp.headers.setdefault("Referrer-Policy", "no-referrer")
        if resp.mimetype in ("text/html",) and not resp.headers.get("Content-Security-Policy"):
            resp.headers["Content-Security-Policy"] = CSP
        return resp

    @app.get("/api/asset")
    def asset():
        """Serve a file from an allowed location (images, PDFs, Markdown images). Active content is sandboxed."""
        p = ws.resolve(request.args.get("path", ""))
        if not p.is_file():
            abort(404, "Not found.")
        resp = send_file(p)
        if resp.mimetype in ACTIVE_TYPES:       # a local .html / .svg opened directly must not run scripts on this origin
            resp.headers["Content-Security-Policy"] = "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:"
        return resp

    @app.get("/pygments.css")
    def pygments_css():
        """Syntax-highlighting stylesheet for the light and dark themes."""
        light = HtmlFormatter(style="default").get_style_defs('html:not([data-theme="dark"]) .hl')
        dark = HtmlFormatter(style="github-dark").get_style_defs('html[data-theme="dark"] .hl')
        fixes = 'html:not([data-theme="dark"]) .hl .ow{color:#8a1fd0}\n'      # the stock colour is just under 4.5:1 contrast
        return Response(light + "\n" + dark + "\n.hl{background:transparent!important}\n" + fixes + _code_themes_css(), mimetype="text/css")

    @app.errorhandler(400)
    @app.errorhandler(403)
    @app.errorhandler(404)
    @app.errorhandler(413)
    @app.errorhandler(415)
    @app.errorhandler(501)
    def err(e):
        """Turn HTTP errors into JSON {"error": message}."""
        return jsonify(error=getattr(e, "description", "Error")), e.code

    def run(host="127.0.0.1"):
        """Start the development server on 127.0.0.1 (optional first argument: the start folder)."""
        import sys
        if len(sys.argv) > 1:
            cand = Path(sys.argv[1]).expanduser()
            if not cand.is_dir():
                sys.exit(f"Folder not found: {cand}")
            ws.root = cand.resolve()
        port = int(os.environ.get("PORT", default_port))
        print(f"\n  NinaPro Study Workspace -> http://{host}:{port}\n  Start folder: {ws.root}\n")
        app.run(host=host, port=port, debug=False, threaded=True)

    return run
