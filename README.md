<h1 align="center">NinaPro Study Workspace</h1>
<p align="center">A private, all-in-one study workspace that runs on your own computer.<br>
Read and annotate PDFs and code, explore <b>.mat</b> / JSON / SQLite data, keep notes, and plan your studying.</p>

<p align="center">
  <img alt="python" src="https://img.shields.io/badge/python-3.9%2B-blue">
  <img alt="flask" src="https://img.shields.io/badge/built%20with-Flask-black">
  <img alt="local" src="https://img.shields.io/badge/runs-100%25%20local-brightgreen">
  <img alt="tests" src="https://img.shields.io/badge/tests-56%20passing-brightgreen">
</p>

---

## What it is

Open the app and it asks **“What would you like to study today?”** Pick a category (code, PDF, text, Word, slides,
images, data), choose a file with your system's file dialog or the built-in browser, and read it in a viewer made for
that file type. Highlight and comment as you go, send quotes to your notes, and track your progress. Nothing leaves your
computer, and your original files are never changed.

Originally built to explore NinaPro EMG datasets (`.mat`), it grew into a general workspace for computer-science students
and researchers.

## Highlights

| Area | What you can do |
|---|---|
| **Viewers** | PDF (zoom, thumbnails, outline, search), code (500+ languages, folding, outline, find & replace), Word, PowerPoint, images, Markdown, JSON, SQL scripts and SQLite databases, **MAT** files with millions of rows (grid, chart, statistics, CSV export) |
| **Annotations** | Highlight, underline, strikethrough, comments, sticky notes, pen, bookmarks in PDFs and code; six consistent category colours; searchable panel and overview page; **export an annotated PDF** |
| **Notes & subjects** | Markdown notes with autosave, linked to files, pages and lines; ten CSE subjects plus your own; “send to notes” from any selection |
| **Planner** | Pomodoro timer, daily goal and streak, goals, to-dos, revision reminders, exams with checklists |
| **Toolkit** | Algorithm visualizer, dry-run tables, complexity / data-structure / concept references, snippet library, spaced-repetition practice questions |
| **Library** | Favorites, collections, tags, pins, recently modified, unified search, command palette (`Ctrl/⌘ + K`) |
| **Safety** | Read-only viewers, loopback-only server, strict security headers, sandboxed SQL, backup & merge-restore |

See the [User guide](docs/USER_GUIDE.md) for a walkthrough of every feature.

## Quick start

```bash
git clone <this repo> && cd NinaProDB_Visualization
python3 -m venv .venv
source .venv/bin/activate            # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python main.py
```

Open **http://127.0.0.1:8000**. The `data/` folder contains sample files for every viewer, so you can try everything
immediately.

| Option | Example |
|---|---|
| Start in another folder | `python main.py ~/Documents/Courses` |
| Different port | `PORT=9000 python main.py` |
| Different database file | `WORKSPACE_DB=~/study.db python main.py` |

> macOS: port 5000 is used by AirPlay Receiver, so the app defaults to 8000.

**Requirements:** Python 3.9+ and the packages in [requirements.txt](requirements.txt) (Flask, Pygments, Markdown,
pymdown-extensions, nh3, sqlparse, NumPy, SciPy, h5py, mammoth, python-pptx, pypdf). pdf.js is bundled, so the PDF reader
works offline.

## Documentation

| | |
|---|---|
| [User guide](docs/USER_GUIDE.md) | every feature, annotation colours, shortcuts |
| [Troubleshooting](docs/TROUBLESHOOTING.md) | common problems and fixes |
| [Architecture](docs/ARCHITECTURE.md) | components, data flow, how to extend |
| [API reference](docs/API.md) | every HTTP endpoint |
| [Data model](docs/DATA_MODEL.md) | database tables, annotation format, backup format |
| [Security & privacy](docs/SECURITY.md) | threat model and protections |
| [Development guide](docs/DEVELOPMENT.md) | setup, tests, conventions, release checklist |
| [Changelog](CHANGELOG.md), [Third-party notices](THIRD_PARTY.md) | |

## Project layout

```
main.py  common.py  catalog.py  store.py  studystore.py   Flask app, access rules, categories, SQLite storage
viewers/                one Flask blueprint per feature
templates/              page shell and one partial per viewer
static/                 front end (plain JavaScript and CSS) and the vendored pdf.js
data/                   sample files            tests/   unit tests and a browser smoke test
docs/                   documentation
```

## Testing

```bash
python -m unittest discover -s tests      # 56 tests: storage, access rules, viewers, annotations, export, study features, backup, security, docs
ruff check .                               # static analysis
```

A browser smoke test (`tests/e2e_smoke.js`, 70 checks) covers every page and file type, keyboard shortcuts and
accessibility basics; see [Development guide](docs/DEVELOPMENT.md#testing). Measured on an Apple-silicon laptop with
generated data: a 2-million-row `.mat` opens in 0.15 s, a 600-page PDF shows its first page in 0.2 s, a 25 000-line
source file renders in 1 s, a 1-million-row SQLite table pages in 0.1 s.

## Limitations

* Single-user, local use. The server is Flask's development server; do not expose it to a network.
* Annotations exist for PDF and code files (code annotations are per line). Markdown, Word, slides and images cannot be annotated yet.
* Word and PowerPoint files are *reading views* (text, tables, pictures), not exact layouts; legacy `.doc` / `.ppt` /
  `.odt` / `.rtf` / `.key` open in your system app.
* `.mat` files are loaded into memory when opened (about their size); only numeric and text arrays are shown.
* The dry-run table is filled in by hand (your code is never executed). Built-in reference content is a study aid, not a
  textbook.
* Not built: AI-assisted code explanations, customisable shortcuts, restoring the last open workspace on start-up.
* Printing, the native file dialog, full screen, sound and real touch/mouse drawing need a manual check on each platform.

## Status and licence

All planned phases are complete (see the [changelog](CHANGELOG.md)). No licence file has been chosen yet: add one before
sharing the project publicly. Dependencies and their licences are listed in [THIRD_PARTY.md](THIRD_PARTY.md).
