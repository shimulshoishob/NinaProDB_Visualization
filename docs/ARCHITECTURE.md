# Architecture

NinaPro Study Workspace is a **local web application**: a Python (Flask) server that reads your files and keeps a small
SQLite database, and a browser front end written in plain JavaScript (no build step, no framework). Everything runs on
your computer at `http://127.0.0.1:8000`.

```
 Browser (single page, hash routes)                          Python process (Flask)
┌────────────────────────────────────────────┐   JSON    ┌───────────────────────────────────────────┐
│ app.js  router, dashboard, file browser    │  over     │ main.py        app factory, blueprints     │
│ study.js / planner.js / toolkit.js / ...   │  HTTP     │ common.py      access rules, security      │
│ one script + one pane per viewer           │ ───────►  │ viewers/*.py   one blueprint per feature   │
│ util.js, annotations.js, icons.js          │ ◄───────  │ store.py       SQLite: files, annotations  │
│ localStorage: view preferences             │           │ studystore.py  SQLite: study data          │
└────────────────────────────────────────────┘           └───────────────┬───────────────────────────┘
                                                                         │ read-only access
                                                          your files (home folder, drives)   workspace.db
```

## Design principles

| Principle | What it means in the code |
|---|---|
| **Your files are read-only** | Viewers only read. The one write path (`/api/code/save`) needs an explicit `confirm`, writes a `.bak-<timestamp>` copy first, and is the only endpoint that can change a file. |
| **Local and private** | The server binds to `127.0.0.1`, checks the `Host` and `Origin` headers, and sends a strict Content-Security-Policy. No network calls are made; pdf.js is vendored so the PDF reader works offline. |
| **One source of truth** | `catalog.py` decides which viewer opens which extension. `store.py` owns the schema. The annotation palette lives in `catalog.ANNOTATION_CATEGORIES` and is passed to the page. |
| **Real functionality only** | Every feature is backed by tests; anything not built is listed in the README under limitations. |
| **Modular** | One backend blueprint and one front-end script per viewer. They talk to the rest only through the registries below. |

## Backend

| Module | Responsibility |
|---|---|
| `main.py` | Creates the Flask app, registers every blueprint, serves the single page (`templates/index.html`). |
| `common.py` | `Workspace` (which paths may be read), `register_common` (Host/Origin checks, security headers, `/api/asset`, `/pygments.css`, JSON error handler, `run()`), syntax-highlight helpers (`highlight_lines`, `read_text`). |
| `catalog.py` | The eight study categories, extension lists, `viewer_for(ext)`, annotation kinds and the colour palette. |
| `store.py` | SQLite connection, **versioned migrations** (`MIGRATIONS`), the `files` library (recents, favourites, pins, fingerprints), settings, annotations, one-time import of the old `comments.json`, default subjects. |
| `studystore.py` | Validated CRUD for subjects, notes, snippets, practice questions, to-dos, goals, sessions, reminders, exams, checklists and collections; spaced-repetition scheduling; progress summary; tags; unified search. |
| `viewers/library.py` | Folder listing, file preview, native OS file dialog, recents/favourites/pins, settings. |
| `viewers/annotations.py` | Annotation API and the **annotated-PDF export** (pypdf). |
| `viewers/study.py` | HTTP layer over `studystore` (notes, links, practice, file organisation, search). |
| `viewers/backup.py` | JSON backup and merge-restore of everything you created. |
| `viewers/mat_viewer.py` | MATLAB files (v5/v7 and v7.3): sheets, pages of rows, statistics, decimated chart series, CSV/ZIP export. |
| `viewers/json_viewer.py`, `markdown_viewer.py`, `sql_viewer.py`, `code_viewer.py`, `office_viewer.py` | Text-based viewers, SQLite access, source highlighting/outline/save, Word and PowerPoint readers. |

### Request lifecycle

1. The browser asks for `/api/...` with `fetch` (JSON in, JSON out; downloads are plain responses).
2. `before_request` rejects a wrong `Host` (DNS rebinding) and a cross-site `Origin` on non-GET requests (CSRF).
3. The blueprint function resolves every path with `Workspace.resolve()`, which applies the access rules below.
4. Errors use `abort(status, "human-readable message")`; the shared handler returns `{"error": "..."}` and the front end
   shows the message in a toast.
5. `after_request` adds `X-Content-Type-Options`, `Referrer-Policy` and a Content-Security-Policy to HTML responses.

### File access rules (`Workspace`)

A path is readable only if **all** of these hold:

* it resolves (symlinks followed) to somewhere under your home folder, the project folder, or a mounted drive
  (`/Volumes`, `/mnt`, `/media`, or a Windows drive letter);
* no component below that base starts with a dot (so `~/.ssh` and similar are never served).

Relative paths are interpreted relative to the sample `data/` folder, which keeps tests and examples portable.

### Persistence

`workspace.db` (SQLite, WAL mode, next to the code; override with `WORKSPACE_DB`) stores everything the app remembers.
See [DATA_MODEL.md](DATA_MODEL.md). Schema changes are **append-only**: add a script to `store.MIGRATIONS`;
`PRAGMA user_version` records how many have run, so existing databases upgrade in place (covered by a test).

Files are identified by path **and** by a *fingerprint* (size + first 64 KB). If you move or rename a file, opening it
at its new location adopts the old record, so annotations, favourites and tags follow it.

The browser's `localStorage` holds only view preferences (theme, zoom, panel visibility, last folder per category, the
dry-run draft, the running timer, ...). Nothing there is needed to restore your study data.

### Annotations

One table serves every viewer. A row has a `kind` (highlight, underline, strikeout, comment, note, bookmark,
drawing), a `category` (colour), your `text`, the marked `quote`, and a viewer-specific `locator`:

* code: `{"start": line, "end": line}`;
* PDF: `{"page": n, "rects": [[x1,y1,x2,y2], ...]}` in **PDF user-space units**, or `{"page": n, "points": [[[x,y],...]]}`
  for pen strokes. Using PDF units keeps annotations correct at any zoom and rotation and lets the exporter write real
  PDF annotations without conversion.

### Performance techniques

| Where | Technique |
|---|---|
| MAT grid | Virtual scrolling; only visible rows exist in the DOM; rows are fetched in blocks of 100; heights above 10 million px are scaled. |
| MAT chart | Min/max decimation on the server so millions of samples draw as ~1500 points. |
| PDF | pdf.js with lazy rendering of pages near the viewport, canvases freed when far away, sizes measured in the background. |
| Code | One DOM row per line with `content-visibility: auto`; folds are computed once from indentation. |
| JSON | Lazy tree (children built on expand, 200 at a time); search also surfaces matches beyond the first page. |
| SQLite | Paging with `LIMIT/OFFSET`, 8-second query limit, 1000-row display cap. |
| Large exports | CSV is streamed in chunks of 20 000 rows. |

## Front end

No bundler: `templates/index.html` includes the scripts in this order, then calls `App.init()`.

| Script | Role |
|---|---|
| `icons.js` | The single SVG icon set; `icon(name)` and `<i data-icon>`. |
| `ui.js` | Shared components: `UI.confirm`, `UI.prompt` (dialogs that replace the browser's), `UI.menu` (dropdown menus) and styled tooltips for `title=""`. |
| `util.js` | Helpers (`$`, `esc`, `api`, `toast`, `store`, `debounce`, ...), the `Theme` object and the `A11y` helper that names controls and makes rows keyboard friendly. |
| `annotations.js` | `Ann`: API calls, colour palette, and the reusable annotations **panel** used by the PDF and code viewers. |
| `app.js` | The shell: hash router, dashboard, category file browser, recent files, annotations overview, settings, document bar. Defines `Viewers` (registry) and `App.pages` (page registry). |
| `study.js`, `planner.js`, `toolkit.js` (+ `reference.js`), `palette.js` | Notes/subjects/library, planner and Pomodoro timer, learning tools and their built-in reference data, command palette. They register pages with `App.pages.<name>`. |
| `mat.js`, `json.js`, `md.js`, `sql.js`, `code.js`, `pdf.js`, `image.js`, `docx.js`, `pptx.js` | One script per viewer. Each registers `Viewers.<name> = async file => {...}`. |

Conventions:

* **Hash routes** (`#/notes/<id>`, `#/open?path=...`, `#/browse/code?path=...`) keep the app a single static page.
* **Panes are scoped.** Every viewer owns `<section id="v-<name>">` and starts with
  `const P = ...; const $ = (s, r = P) => ...` so element ids and classes can never clash between viewers. Their CSS
  files are scoped with the same `#v-<name>` prefix.
* **Escape everything.** User text goes through `esc()` before `innerHTML`; server-rendered HTML (Markdown, Word) is
  sanitised by `nh3` on the server.
* **No inline event attributes.** Handlers are assigned from scripts, which is what allows the strict CSP.

### Opening a file

```
click in browser / palette / link ─► App.open(path) ─► #/open?path=…
   ─► App.routeOpen: POST /api/library/open  (records recents, fingerprint; returns viewer name)
   ─► App.showPane(viewer), paint the document bar
   ─► Viewers[viewer](record)  ─► viewer-specific API calls (/api/code, /api/asset for PDFs, ...)
```

## Extending the app

### Add a viewer for a new file type

1. Map the extension in `catalog.py` (`VIEWER_EXTS`, and a category in `CATEGORIES` if needed).
2. Add `viewers/<name>_viewer.py` with a `Blueprint` and register it in `viewers/__init__.py`.
3. Add `templates/partials/<name>.html` (`<section class="vpane" id="v-<name>" hidden>`), include it in `index.html`.
4. Add `static/js/<name>.js` (copy the scoped header from an existing viewer) registering `Viewers.<name>`,
   and a stylesheet whose rules are prefixed with `#v-<name>`.
5. Add API tests in `tests/` and a line in `tests/e2e_smoke.js`.

### Add a study resource (a new list of items)

1. Add a table in a **new** migration in `store.MIGRATIONS`.
2. Declare its columns and types in `studystore.RESOURCES` (this gives you validated CRUD at `/api/study/<name>`).
3. Include it in `viewers/backup.py` so it is backed up and restored.
4. Build the page in `static/js/` and register it with `App.pages.<name>`.

### Add a database migration

Append a SQL script to `store.MIGRATIONS`. Never edit an existing one. Add a test that upgrades an older database
(see `test_upgrade_from_an_older_database_keeps_data`).

## Trade-offs worth knowing

* **Single user, single process.** The server is the Flask development server with threads; this is deliberate for a
  local tool. Do not expose it to a network.
* **Files are loaded fully into memory** for `.mat` (last three are cached). It is simple and fast but needs RAM
  roughly equal to the file size.
* **Reading views, not layout engines.** Word and PowerPoint files are converted to HTML/JSON for reading;
  pixel-perfect rendering would need LibreOffice.
* **Code annotations are line-based**, PDF annotations are text/rectangle-based. Annotating other formats would need
  a text-anchoring scheme (quote plus context) and is listed as future work.
