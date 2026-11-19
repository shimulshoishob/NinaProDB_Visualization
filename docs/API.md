# HTTP API reference

The front end talks to the server only through these endpoints. They are an **internal API for the bundled UI**, not a
public, versioned interface; they may change between releases. A test (`tests/test_docs.py`) fails if a route is added
without being documented here.

## Conventions

* **Base URL** `http://127.0.0.1:8000`. There is no login: the server only accepts requests addressed to
  `localhost` / `127.0.0.1` and refuses cross-site writes (see [SECURITY.md](SECURITY.md)).
* **Format**: JSON request bodies (`Content-Type: application/json`) and JSON responses, except where a download or a
  stylesheet is noted.
* **Paths** are absolute file-system paths, or paths relative to the sample `data/` folder. A path outside your home
  folder, a mounted drive or the project folder, or inside a hidden folder, returns **403**.
* **Errors** always look like `{"error": "A sentence you can show to the user."}` with status 400 (bad input), 403
  (not allowed), 404 (not found), 413 (too large), 415 (not a text file) or 501 (feature unavailable on this system).
* **Pagination** is explicit (`start`/`count`, `limit`/`offset`); the server caps page sizes (1000 rows).
* `<name>`-style segments in a path are URL parameters.

---

## Pages and static data

| Method | Path | Description |
|---|---|---|
| GET | `/` | The single-page application. |
| GET | `/pygments.css` | Syntax-highlighting styles (light and dark). |
| GET | `/api/asset?path=` | Serve a file (images, PDFs, Markdown images). HTML/SVG/XML files are sent with `Content-Security-Policy: sandbox` so scripts in them cannot run. Supports HTTP range requests (used by pdf.js). |

## Library: browsing, recents, favourites, settings

| Method | Path | Description |
|---|---|---|
| GET | `/api/fs/list` | List a folder. Query: `path` (default: start folder), `category` (`code`, `pdf`, `text`, `word`, `slides`, `images`, `data`), `q` (name filter), `sort` (`name`\|`date`\|`size`), `order` (`asc`\|`desc`). Returns `{path, parent, crumbs[], dirs[], files[], truncated, home}`. At most 3000 files are returned. |
| GET | `/api/fs/preview?path=` | Preview of one file: `{info, preview}` where `preview.kind` is `code` (highlighted first 40 lines), `image`, `list` (variables of a `.mat`, tables of a database) or `meta`. |
| POST | `/api/fs/native` | Open the operating system's file chooser. Body `{mode: "file"\|"files"\|"folder", category?}`. Returns `{paths[], skipped}`; paths outside the allowed area are dropped and counted. 501 if no dialog is available. |
| POST | `/api/fs/external` | Body `{path, action: "open"\|"reveal"}`: open with the default app or show in the file manager. |
| POST | `/api/library/open` | Body `{path}`. Records the file in recents, stores its fingerprint, returns its library record (`id`, `path`, `name`, `ext`, `category`, `viewer`, `favorite`, `pinned`, `tags`, `subject_id`, `exists`, ...). Called every time a document is opened. |
| GET | `/api/library/summary` | Dashboard data: `{categories[], recents[], pinned[], start_folder}`. |
| GET | `/api/library/recent?category=` | Up to 100 recent files. |
| GET | `/api/library/favorites` | Favourite files (pinned first). |
| POST | `/api/library/favorite` | Body `{path, value}`; adds or removes a favourite. |
| POST | `/api/library/forget` | Body `{path?}`. Clears recent history for one file, or all. Favourites and organisation are kept. |
| GET | `/api/library/search?q=` | File-name search (≥ 2 characters) over recents, favourites and the start folder. |
| GET | `/api/settings` | `{start_folder, daily_goal_minutes, pomo_focus, pomo_short, pomo_long, effective_start_folder}`. |
| PUT | `/api/settings` | Body with any of those keys. Numbers are range-checked (goal 0–1440, focus 1–180, short 1–60, long 1–120). |

## Code viewer

| Method | Path | Description |
|---|---|---|
| GET | `/api/code?path=&lang=` | Highlighted source: `{lines[] (HTML), raw[], language, alias, truncated, size, outline[], eol}`. Files over 2 MB are truncated; binary files return 415. |
| POST | `/api/code/highlight` | Body `{text, name, lang?}`. Highlights text that is not on disk (the working copy after Find & Replace). Returns `{lines, raw, outline}`. |
| POST | `/api/code/save` | Body `{path, text, confirm: true}`. **The only endpoint that writes to your files.** Requires `confirm: true`, refuses binary files, copies the original to `<name>.bak-<timestamp>` first. |
| GET | `/api/languages` | `[{name, alias}]` for every language Pygments knows. |

## Data viewers

| Method | Path | Description |
|---|---|---|
| GET | `/api/json/text?path=` | Raw text of a JSON / JSONL file (≤ 100 MB); parsed in the browser. |
| GET | `/api/md?path=` | Rendered, sanitised HTML, source, table of contents, word count and reading time of a Markdown file. |
| POST | `/api/render` | Body `{text}` → `{html, toc}`; used by notes and the Markdown split view. |
| GET | `/api/docx?path=` | Word document as sanitised HTML with `toc`, `words`, `minutes`. |
| GET | `/api/pptx?path=` | Slides: `{width, height, slides[{n, title, shapes[], notes}]}`; shapes carry percentage positions. |
| POST | `/api/mat/open` | Body `{path}` → `{id, name, sheets[{name, rows, cols, dtype, numeric, note}]}`. The file is cached; the last three are kept. |
| GET | `/api/mat/rows/<fid>/<var>?start=&count=` | A page of rows (≤ 1000). |
| GET | `/api/mat/stats/<fid>/<var>` | Per-column min, max, mean, std, RMS, median, NaN count. |
| GET | `/api/mat/series/<fid>/<var>?start=&end=&points=&cols=` | Min/max-decimated series for charting (≤ 4000 points, ≤ 24 columns). |
| GET | `/api/mat/export/<fid>/<var>.csv?from=&to=` | CSV download, optionally a 1-based row range. Streamed. |
| GET | `/api/mat/export-all/<fid>.zip` | Every variable as CSV in a ZIP. |
| GET | `/api/sql/script?path=` | Highlighted `.sql` script with statement outline. |
| POST | `/api/sql/format` | Body `{text}` → re-indented, highlighted SQL. |
| POST | `/api/sql/sandbox` | Body `{path}`. Runs the script in a throw-away in-memory SQLite database (`VACUUM`, `ATTACH`, `DETACH` are refused). Returns `{handle: "sandbox:<id>", ok, errors[]}`. |
| GET | `/api/db/info?handle=` | Tables and views with columns, row counts, DDL, indexes, foreign keys. `handle` is `file:<path>` (opened read-only) or a sandbox handle. |
| GET | `/api/db/rows?handle=&table=&limit=&offset=&sort=&desc=&q=` | A page of rows; `q` matches any column. |
| POST | `/api/db/query` | Body `{handle, sql}`. One read-only statement starting with `SELECT`, `WITH`, `VALUES`, `PRAGMA` or `EXPLAIN`; 8-second limit; first 1000 rows returned. |
| GET | `/api/db/export.csv?handle=&table=` or `&sql=` | CSV of a table or a query result (≤ 1 000 000 rows). |

## Annotations and PDF export

| Method | Path | Description |
|---|---|---|
| GET | `/api/annotations?path=` | Annotations of one file. |
| POST | `/api/annotations` | Body `{path, kind, category, text, quote, locator}`; see [DATA_MODEL.md](DATA_MODEL.md) for kinds and locators. Returns the created annotation. |
| PATCH | `/api/annotations/<ann_id>` | Change any of `kind`, `category`, `text`, `quote`, `locator`. |
| DELETE | `/api/annotations/<ann_id>` | Delete one annotation. |
| GET | `/api/annotations/all?q=&kind=&category=&path=` | Search across files; returns `{items[], categories}` where each item has `file: {path, name, category, exists}`. |
| GET | `/api/pdf/export?path=` | Download a copy of the PDF with highlights, underlines, strike-throughs, notes and drawings embedded as PDF annotations and bookmarks added to the outline. Header `X-Annotations-Embedded` gives the count. The original is not modified. |

## Study data

A generic, validated resource API serves most of the study features. `<name>` is one of `subjects`, `notes`,
`snippets`, `questions`, `todos`, `goals`, `sessions`, `reminders`, `exams`, `checklist`, `collections`
(column lists: [DATA_MODEL.md](DATA_MODEL.md)).

| Method | Path | Description |
|---|---|---|
| GET | `/api/study/<name>` | List items. Optional equality filters on any column (e.g. `?subject_id=`). Notes also accept `q`, `subject`, `tag`. Reminders include the linked `file`. |
| POST | `/api/study/<name>` | Create an item. Unknown fields are ignored; invalid values return 400 with a clear message. |
| GET | `/api/study/<name>/<rid>` | One item. |
| PATCH | `/api/study/<name>/<rid>` | Update fields (todos: `done` also sets `completed_at`). |
| DELETE | `/api/study/<name>/<rid>` | Delete. Deleting a subject detaches its items; deleting an exam removes its checklist. |
| GET | `/api/study/notes/<rid>/links` | Files linked from a note: `[{file, locator, exists}]`. |
| POST | `/api/study/notes/<rid>/links` | Body `{path, locator?}`. |
| DELETE | `/api/study/notes/<rid>/links` | Body `{path, locator?}`. |
| POST | `/api/study/notes/append` | "Send to notes". Body `{path, quote, where, locator?, text?, fence?}`: appends a quote (as a block quote, or a fenced code block when `fence` is a language) with its source to the note titled `Notes: <file name>`, creating it if needed. |
| GET | `/api/study/file-notes?path=` | Notes linked to a file. |
| GET | `/api/study/practice/due?subject=` | Practice questions due today or never reviewed. |
| POST | `/api/study/questions/<rid>/review` | Body `{grade: "again"\|"hard"\|"good"\|"easy"}`; schedules the next review (Leitner boxes). |
| GET | `/api/study/summary` | `{today_minutes, goal_minutes, streak, week[7], due_questions, reminders_due, todos_open, next_exam, total_minutes}`. |
| GET | `/api/study/subject-counts` | Per-subject counts of notes, files, snippets, questions, to-dos and minutes. |
| GET | `/api/study/file?path=` | `{subject_id, tags, pinned, favorite, collections[], notes[]}` for a file. |
| PUT | `/api/study/file` | Body `{path, subject_id?, tags?, pinned?, collection?, member?}`. Sets subject, tags, pin, or adds/removes the file from a collection. |
| GET | `/api/study/files?subject=&tag=&pinned=1` | Known files filtered by subject, tag or pin. |
| GET | `/api/study/collections/<rid>/files` | Files in a collection. |
| GET | `/api/study/collection-counts` | `{collection_id: count}`. |
| GET | `/api/study/tags` | `[{tag, count}]` over files, notes and snippets. |
| GET | `/api/study/modified` | Known files, newest change on disk first (up to 60). |
| GET | `/api/search?q=` | Unified search (≥ 2 characters): `{notes[], snippets[], questions[], tagged[], annotations[]}`. |

## Backup

| Method | Path | Description |
|---|---|---|
| GET | `/api/backup` | Download all study data as JSON (format: [DATA_MODEL.md](DATA_MODEL.md#backup-file-format)). File contents are never included. |
| POST | `/api/backup/restore` | Body: a backup file. Merges it; nothing is deleted and repeating it adds nothing. Returns `{added: {type: count}}`. Refuses files from other apps, from a newer version, or that are damaged. |
