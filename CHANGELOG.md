# Changelog

All notable changes. The project was built in phases; each phase is a coherent, tested step.

## Unreleased: design system (Phase 2 of the redesign)

* New token set in `base.css` (warm neutral light, charcoal dark, restrained blue accent, spacing/radius/type/shadow/motion
  scales); old variable names kept as aliases. System font stack only.
* Shared components in `ui.js`: dialogs, menus, tooltips; browser `confirm`/`prompt` replaced everywhere. Toast fade-out.
* Grouped sidebar with Favorites, Collections and Bookmarks entries; theme switch lives in Settings and the palette.
* All viewer stylesheets moved to tokens (hard-coded colours about 111 → a handful). Darker tertiary text for AA contrast.
* No endpoint, data or security change. Tests 56 pass, ruff clean, browser smoke test 70/70.

## Unreleased: review and documentation

* Full code review with static analysis (`ruff`): unused imports and variables removed, exception chaining fixed, dead code
  deleted from five scripts.
* **Security hardening**: cross-site (`Origin`) check on every state-changing request, Content-Security-Policy and
  security headers, sandboxed delivery of local HTML/SVG files, allow-list for the SQL console, `VACUUM`/`ATTACH`/`DETACH`
  refused in the SQL sandbox.
* Docstrings for every endpoint and public function.
* New documentation set in `docs/` (user guide, architecture, API reference, data model, security, development,
  troubleshooting) with tests that keep the API reference and links accurate.
* Tests: 53 → 56.

## Phase 6: testing, performance, accessibility

* Stress-tested with a 2-million-row `.mat`, 600-page PDF, 30 MB JSON, 25 000-line source file, 1-million-row SQLite table,
  a 4 000-file folder, and corrupt/odd files. Fixed JSON search past the first page of huge arrays; faster CSV export.
* Accessibility: every control has an accessible name, rows are keyboard-operable, skip link, focus management, page
  titles, reduced-motion support, contrast fixes (light and dark).
* Small-screen layouts.
* Added the **command palette** (`Ctrl/⌘ + K`) and **backup / restore**.
* Added `tests/e2e_smoke.js` (70 browser checks).

## Phase 5: CSE study features

* Subjects (ten defaults, custom), **Notes** (Markdown, autosave, links to files, send-to-notes), **Planner** (Pomodoro,
  progress and streak, goals, to-dos, revision reminders, exams with checklists), **Toolkit** (algorithm visualizer,
  dry-run tables, complexity / data-structure / concept references, snippet library, spaced-repetition practice),
  **Library** (favourites, collections, tags, pins, recently modified), unified search.
* Database migration 3; validated study storage layer.

## Phase 4: unified annotations

* One annotation store for PDF and code: highlight, underline, strikethrough, comments, sticky notes, pen drawing,
  bookmarks; category colours; annotations panel; global Annotations page.
* **Annotated-PDF export** (pypdf). Import of the old `comments.json`. Files are tracked by content fingerprint so
  annotations follow moved files.

## Phase 3: file viewers

* PDF reader (pdf.js, vendored, offline), Word (`.docx`), PowerPoint (`.pptx`), images.
* Code viewer: folding, function/class outline, find & replace on a working copy with explicit save and backup, export.

## Phase 2: dashboard and file workflow

* Dashboard with eight categories, category file browser with preview, native file dialog, recents, favourites,
  settings, SQLite persistence, design system, host-header protection.

## Phase 1: audit and first merge

* Single Flask application replacing the separate MAT, JSON, Markdown, SQL and code viewers.
