# Development guide

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate                 # Windows: .venv\Scripts\activate
pip install -r requirements.txt -r requirements-dev.txt
python main.py                            # http://127.0.0.1:8000
```

Python 3.9 or newer (developed on 3.14). Node.js is **not** required to run the app; it is only used for
`node --check` syntax checks of the front-end scripts.

### Configuration

| Setting | How | Default |
|---|---|---|
| Port | `PORT=9000 python main.py` | `8000` |
| Start folder | `python main.py /path/to/folder` (or Settings → Start folder) | `data/` |
| Database file | `WORKSPACE_DB=/path/study.db` | `workspace.db` next to `store.py` |

Templates are cached by Flask: **restart the server** after editing anything in `templates/`. Static files
(`static/js`, `static/css`) are served fresh; reload the page.

## Project layout

```
main.py  common.py  catalog.py  store.py  studystore.py     backend core
viewers/                 one Flask blueprint per feature (see docs/ARCHITECTURE.md)
templates/index.html     the page shell;  templates/partials/<viewer>.html  one pane per viewer
static/js, static/css    front end;  static/vendor/pdfjs  vendored pdf.js (Apache-2.0)
data/                    sample files for every viewer (used by the tests and as the default folder)
tests/                   unit tests (unittest) and a browser smoke test
docs/                    documentation
```

## Testing

```bash
python -m unittest discover -s tests        # 50+ API, storage and documentation tests (a second or two)
ruff check .                                # static analysis (configured in pyproject.toml)
for f in static/js/*.js; do node --check "$f"; done      # syntax check of the front end
```

* **API tests** use Flask's test client with a temporary database (`store.reset(path)` gives each test a fresh one).
  They run against the real sample files in `data/`.
* **Documentation tests** (`tests/test_docs.py`) fail if a route is missing from `docs/API.md`, a relative link in the
  Markdown files is broken, or the documented migration count is stale.
* **Contrast and layout checks** worth repeating after a visual change: run the smoke test in both themes
  (`Theme.set('dark')` in the console first), and view the dashboard, file browser, a PDF and a code file at phone width
  (375 px) using the browser's device mode. Text should keep at least 4.5:1 contrast.
* **Browser smoke test**: start the app, open it in a browser, paste `tests/e2e_smoke.js` into the developer-tools
  console. It checks every page, a file of every type, keyboard shortcuts, accessible names and script errors.
* Things that need a real person: the print dialog, the native file dialog, full screen, sound, drawing with a real
  mouse or touch screen, screen readers. Check these manually before a release.

### Writing tests

* Add API tests to `tests/test_api.py` (library, viewers, security), `tests/test_annotations.py` or
  `tests/test_study.py`. Use `data/` samples; create temporary files **inside `data/`** (and delete them in `finally`),
  because paths outside your home folder are refused by design.
* A new endpoint needs: a test, a row in `docs/API.md`, and (if it is user visible) a line in
  `docs/USER_GUIDE.md`.
* A schema change needs a migration, a migration test, and an update to `docs/DATA_MODEL.md`.

## Code conventions

**Python**
* Every module starts with a docstring; public functions have a one-line docstring (these are the API descriptions).
* Endpoints validate input, return `abort(status, "message for the user")`, and never build SQL from request data.
* Resolve every incoming path with `ws.resolve(...)`; never open a path from a request directly.
* No global state besides the SQLite connection and small in-memory caches (`mat_viewer.LOADED`, `sql_viewer.SANDBOXES`).

**JavaScript**
* No build step and no dependencies. Scripts are plain browser JavaScript (ES2020).
* Never use `confirm()` / `prompt()`; use `UI.confirm` / `UI.prompt` / `UI.menu` from `ui.js`. Style with the CSS tokens in
  `static/css/base.css` (`var(--accent)`, `--r-md`, `--fs-md`, ...), never with literal colours, so light and dark both work.
* Never leave a viewer blank or spinning when it fails: **throw** from `Viewers.<name>` and the app shows one shared
  error state (what happened, Try again, Open with system app, Go back). Slow opens get a shared "Opening…" overlay.
* Give new class names a prefix or a scope (`#v-name`, `.ui-tip`): a generic name such as `.tip` can collide with
  rendered Markdown or Word content.
* A viewer that leaves the app layout (focus / study mode) toggles `body.reading-focus` and must turn it off on `hashchange`
  and handle `Esc` itself with `stopImmediatePropagation()`, so Esc never also leaves the document.
* Each viewer is an IIFE with scoped `$` / `$$` helpers (see any viewer). Do not use `document.getElementById` for ids
  that exist in more than one pane.
* Escape with `esc()` before `innerHTML`; assign handlers from code (`el.onclick = ...`), never inline `onclick="..."`
  attributes (the Content-Security-Policy forbids relying on them being safe).
* Use `icon('name')` from `icons.js`; add new icons there as 24×24 stroke paths.
* Icon-only buttons need `aria-label`/`title`; form controls need a label or `aria-label` (the `A11y` helper fills
  most gaps, but do not rely on it for new controls).

**CSS**
* Design tokens (colours, radius) live in `static/css/base.css`; use `var(--...)`, never hard-coded colours, so light and
  dark themes both work. One accent colour only.
* Viewer stylesheets are scoped with `#v-<name>`.

## Common tasks

* **Add a viewer / study resource / migration**: step-by-step lists in [ARCHITECTURE.md](ARCHITECTURE.md#extending-the-app).
* **Update pdf.js**: download the `pdfjs-dist` package of the version you want, replace `pdf.min.mjs`,
  `pdf.worker.min.mjs`, `standard_fonts/`, `cmaps/` and `LICENSE` in `static/vendor/pdfjs/`, update the version in
  `README.txt` there, and run the smoke test (open a PDF, search, annotate). The app was verified with 4.10.38.
* **Add a built-in reference entry** (complexity row, concept, pattern, starter question): edit
  `static/js/reference.js`. Patterns must be runnable Python; test them before committing.
* **Reset your local data**: stop the app and delete `workspace.db*`.

## Release checklist

1. `python -m unittest discover -s tests` and `ruff check .` are clean.
2. Run `tests/e2e_smoke.js` in the browser: all checks pass, no console errors.
3. Manual checks: native file dialog, print/PDF export of a note and of a code file, full screen, timer sound,
   annotate and export a PDF and open the result in another PDF reader, keyboard-only walk through the dashboard.
4. Try a clean install: new virtual environment, `pip install -r requirements.txt`, start with no `workspace.db`.
5. Upgrade check: start the new version on a copy of an old `workspace.db`.
6. Update `CHANGELOG.md` and the version note in the README.
7. Confirm `git status` shows no personal data (`workspace.db`, backups, `comments.json*`) and that `THIRD_PARTY.md`
   still matches `requirements.txt`.
