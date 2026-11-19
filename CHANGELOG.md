# Changelog

All notable changes. The project was built in phases; each phase is a coherent, tested step.

## Unreleased: final polish (Phase 7 of the redesign)

* **States**: every viewer now shares one loading overlay ("Opening …", only after 250 ms) and one error state (reason,
  Try again, Open with system app, Go back); code and Markdown no longer show a bare red line. Unhandled errors surface
  as a toast instead of failing silently.
* **Motion**: pages and viewers fade in; reduced-motion settings switch all of it off.
* **Keyboard**: `?` (or the command palette) shows every shortcut in a dialog; the Settings list uses the same source.
* **Responsive**: Library tabs scroll instead of clipping; the file browser header stacks on phones; PDF and code toolbars wrap
  so the ⋯ menu stays reachable at 375 px; the PDF panel starts closed on phones.
* **Accessibility**: tertiary text darkened to pass 4.5:1 on every surface; MAT series chips no longer use low-contrast
  text; the Pygments operator-word colour is slightly darker. Programmatic contrast audit of all pages and viewers is clean.
* Smoke test: 71 → 74 checks (admonition in flow, `?` sheet opens and closes). No endpoint or data change.

## Unreleased: unified viewers (Phase 6 of the redesign)

* Markdown, Word, image, JSON and MAT viewers now share the PDF/code pattern: one compact toolbar row, a **⋯ menu** for
  secondary actions (copy source / export HTML / print, text size, rotate and actual size, expand / collapse / copy / download,
  Export CSV or ZIP), and previous/next-match buttons shown only while searching. Shared toolbar is shorter (40 px).
* **Fixed**: the Markdown "Pro tip" admonition was drawn as a fixed floating box, because the Phase 2 tooltip class `.tip`
  clashed with the admonition class of the same name. The tooltip class is now `.ui-tip`.
* `+` / `-` change text size in the Word viewer, like the code viewer. No endpoint or data change.

## Unreleased: code reading studio (Phase 5 of the redesign)

* **Fixed**: syntax colours were not applied in the code viewer (the `hl` class the highlighter stylesheet needs was missing
  from the code box). New smoke-test check guards it.
* One slim toolbar with a **⋯ menu** (text size, wrap, theme, fold, go to line, copy, export) instead of a row of ten controls.
* Floating selection popover by the selected lines; dragging over code now selects its lines like a line-number click.
* Colour themes (Solarized Light/Dark, One Dark, Dracula, Nord) served by `/pygments.css`, scoped to the viewer, remembered.
* **Study mode** (`S`): navigation and toolbars hidden, roomier line spacing.
* Outline filter and current-symbol highlight; Find/Replace is a compact floating panel (Replace row on demand, pre-filled
  from the selection); Go to line accepts `120`, `line 120`, `:120`; side panel and tab remembered.
* `Esc` now closes the innermost thing first in the code viewer too. No endpoint or storage change.

## Unreleased: PDF reading studio (Phase 4 of the redesign)

* One slim toolbar (page, zoom, tools, bookmark, search, ⋯ menu) instead of two wrapping rows; reading-progress line under it.
* One collapsible side panel with **Pages / Contents / Annotations** (plus a Results tab while searching); open state, last tab
  and annotation visibility are remembered. The separate right-hand annotations column is gone.
* Floating selection toolbar centred above the selection (flips below near the top edge).
* **Focus mode** (`f`) hides the app navigation, header and toolbar; `Esc` unwinds focus mode, then the pen/note tool,
  then the document (fixes `Esc` leaving the document while a tool was active).
* Show/hide annotations on the pages without touching them. Colour dots appear only with the pen and note tools.
* Front-end only; annotation storage, export and the original PDF are untouched.

## Unreleased: dashboard (Phase 3 of the redesign)

* New dashboard: hero ("Your space to think, learn, and build."), **Open a document** (native chooser, in-app browser as
  fallback) and **Explore your library**; Continue studying with PDF reading progress; Explore your materials; Your workspace;
  a quieter Study overview.
* PDF viewer now remembers the page count (browser-side, same `pdf:<path>` key) so progress can be shown.
* File browser: category description, a Recent row, clearer message for folders that only hold sub-folders.
* Front-end only; no endpoint or data change.

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
