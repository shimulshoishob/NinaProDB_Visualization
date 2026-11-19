# User guide

A task-oriented guide to NinaPro Study Workspace. For installation see the [README](../README.md); if something does
not work, see [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

## 1. The big picture

Open the app and you land on the **Dashboard**: *“What would you like to study today?”*

* **Category cards**: Code, PDF, Text, Word, Presentations, Images and Diagrams, Data, Recent Files.
* **Search box**: type two or more letters to search file names, notes, annotations, snippets and practice questions.
* **Study strip**: minutes studied today, streak, questions to review, open to-dos and your next exam.
* **Pinned** and **Recently opened** files.

The left navigation is grouped: **Dashboard**, **Recent**, **Library**, **Favorites**, **Collections**, **Bookmarks**; then
**Subjects**, **Notes**, **Annotations**, **Planner**, **Toolkit**; **Settings** at the bottom. The theme (system / light /
dark) is chosen in Settings, or with the command palette. `Ctrl/⌘ + B` collapses it; `Ctrl/⌘ + K` opens the command palette from anywhere.

### Opening a file

1. Click a category card (for example *Code Files*).
2. Either click **Choose from computer…** (your system's own file dialog) or browse inside the app: folders,
   breadcrumbs, search, file-type chips, sorting by name / date / size.
3. Click a file to see a **preview** (highlighted code, image, the variables inside a `.mat`, the tables inside a
   database). Tick the boxes to select several files where the category allows it.
4. Press **Open File**. Press `[` and `]` inside a document to step through the files you selected.

Files must be inside your home folder (or a mounted drive). The file is never changed by viewing it.

### The document bar

Every open file has a bar with: **Back** (`Esc`), name and category, folder, previous/next, **View as** (switch JSON,
Markdown and SQL files to plain source), **Full screen**, **Organize** (the tag icon) and **Favorite** (the star).

**Organize** sets the file's subject, tags, pin to the dashboard, collections, a revision reminder, and lets you start a
note about it.

## 2. Viewers

### PDF
* Scroll, jump with the page box, **zoom** (`+`, `-`), **fit width** (`0`) or fit page, **rotate** (`r`).
* Side panel: **Pages** (thumbnails), **Outline**, **Results** (search). Search with `Ctrl/⌘ + F`; matches are highlighted.
* Your position, zoom and rotation are remembered per file.
* **Annotate** (see section 3), **print**, **download an annotated copy**.

### Code
* Highlighting for hundreds of languages; change the language in the box if the guess is wrong.
* **Fold** blocks (the arrow next to a line number, or the fold-all buttons), **outline** of functions and classes,
  font size, wrapping, go to line (`Ctrl/⌘ + G`).
* **Find** (`Ctrl/⌘ + F`) and **Replace** (`Ctrl/⌘ + H`). Replace edits a *working copy*: the file on disk stays as it is
  until you press **Save to file…** and confirm; a backup `name.bak-<time>` is created first. You can also download the
  copy or revert.
* **Export PDF** prints the code with your highlights and comments (choose “Save as PDF” in the print dialog).

### Markdown, Word, PowerPoint, images
* **Markdown**: GitHub-style preview, table of contents, a live scratch editor (not saved), export to HTML, print.
* **Word (.docx)**: reading view with contents and find. Older `.doc`, `.odt`, `.rtf` open in your system app.
* **PowerPoint (.pptx)**: slide view, outline mode, speaker notes, present full screen. It shows text, tables and
  pictures, not exact layouts. `.ppt` and `.key` open in your system app.
* **Images**: zoom, fit, 100 %, rotate, dimensions.

### Data files
* **MAT** (`.mat`): a spreadsheet-like grid (column letters, row numbers, formula bar, arrow keys) with one tab per
  variable. Handles millions of rows. **Chart & stats** draws selected columns (click a column letter; Shift/Ctrl-click to
  add more; drag on the chart to zoom, click to jump to a row) and shows min / max / mean / std / RMS / median per column.
  **Export CSV** for a sheet (optionally a row range) or **Export all (ZIP)**.
* **JSON / JSONL**: tree, table (for lists of objects), raw. Search keys and values; click a node to see its path
  (`$.users[0].name`) and copy it.
* **SQL scripts**: highlighted, with an outline; **Formatted** view; **Run in sandbox** executes the script in a
  throw-away in-memory database so you can browse the result. **SQLite databases** (`.db`, `.sqlite`): browse tables
  (sort, filter, pages), see the structure, run read-only queries (`Ctrl/⌘ + Enter`), export CSV.

## 3. Annotating

Annotations work in **PDF** and **code** files and are saved automatically.

**Colours mean the same thing everywhere**: yellow = General, green = Definition, blue = Question, pink = Exam topic,
orange = Important, purple = To do. Pick the colour first (the dots in the toolbar), then mark.

| In a PDF | In code |
|---|---|
| Select text → small toolbar: **highlight**, **underline**, **strikethrough**, **comment** (highlight + your explanation), **send to notes**. | Click a line number (Shift-click for a range) → choose *Highlight* or *Underline*, then click a colour. Click the same colour again to remove it. |
| **Sticky note** tool: click on the page and write. **Pen** tool: draw. | **Comment** adds your explanation under the lines. **To notes** sends the lines to a note. |
| **Bookmark** this page (`b`). | **Bookmark** a line (`b`). |
| Click any annotation to edit, change style/colour, or delete. | Edit/Delete buttons appear on each comment. |

The **annotations panel** at the right of the viewer lists, searches, filters and sorts the notes for that file. The
**Annotations** page (Notes → Annotations) shows everything, grouped by file, category or date, and opens the exact page
or line when you click an item. Export notes as Markdown or JSON.

**Download an annotated PDF** (the download icon in the PDF toolbar): a copy with your marks embedded, readable in other
PDF programs. Your original PDF is untouched.

## 4. Notes, subjects and the library

* **Subjects**: ten CSE subjects are ready (you can add your own). A subject page collects its notes, files, practice
  questions and snippets; **Add files…** attaches files from your computer.
* **Notes**: Markdown with live preview, formatting buttons, checklists, tables, code blocks, tags, pinning, links to
  files (and pages or lines), saved snippets, autosave (see “Saved” at the top). **Export** as `.md` or PDF (print).
* **Library**: **Favorites**, **Collections** (group files from different folders, for example for one exam), **Tags**,
  **Recently modified**.

## 5. Planner

* **Today**: Pomodoro timer (default 25 / 5 / 15 minutes; change in Settings). It keeps running while you use other
  pages, and a small timer appears in the navigation. Finished focus sessions are logged automatically; you can also log
  time by hand. See today's progress against your daily goal, your streak and a 7-day chart. Add **goals**: a checklist
  goal, or a study-time goal per day or week.
* **To-do**: tasks with due date, subject and priority.
* **Revision**: reminders (including ones created from a file's Organize button) and the number of practice questions
  due today.
* **Exams**: name, date, a countdown and a preparation checklist (one click adds a standard list).

## 6. Toolkit

| Tab | What it does |
|---|---|
| **Visualizer** | Watch bubble, selection, insertion, merge and quick sort, binary search, BFS and DFS. Play, step, scrub, change speed and input; the matching pseudocode line is highlighted and comparisons/swaps are counted. |
| **Dry run** | A table where you trace a program by hand: one column per variable, one row per step. Load an example, copy as Markdown, download CSV, or save as a note. (It does not run your code.) |
| **Complexity** | Big-O table for common algorithms and data structures (searchable), a growth chart, and a calculator showing how many operations and roughly how long each class takes for a chosen *n*. |
| **Data structures**, **Concepts** | Short references (operations, use cases, example code; OS, networks, DBMS, OOP, architecture, SE, AI/ML, maths). **Save to notes** copies one into a note. |
| **Snippets** | Your own code snippets plus twelve common patterns (binary search, two pointers, BFS, Dijkstra, DP, union-find, ...). |
| **Practice** | Your own questions with answers, reviewed on a spaced schedule: after each answer choose *Again* (today), *Hard* (tomorrow), *Good* or *Easy* (progressively later: 1, 3, 7, 14, 30 days). *Import starter questions* adds 15 to begin with. |

The built-in reference content is a concise study aid; check it against your course material.

## 7. Settings, backup and shortcuts

* **Settings**: theme (system / light / dark), start folder, daily goal, Pomodoro lengths, clear recent history,
  **Backup and restore**.
* **Backup**: *Download backup* saves a JSON file with your notes, annotations, planner data, questions, tags and
  collections (never your documents). *Restore* merges it back; restoring the same file twice changes nothing.

| Key | Action |
|---|---|
| `Ctrl/⌘ + K` | Command palette: pages, actions, search |
| `/` | Focus the search box |
| `Esc` | Go back from a document; close a dialog |
| `[` `]` | Previous / next file in your selection |
| `Ctrl/⌘ + B` | Collapse the navigation |
| `Ctrl/⌘ + F` | Search in the open file (PDF, Word, JSON, code) |
| `Ctrl/⌘ + H` | Find and replace (code) |
| `Ctrl/⌘ + G` | Go to line (code) |
| `Ctrl/⌘ + Enter` | Run the query (SQL console); save a comment |
| `+` `-` `0` `r` | Zoom, fit width, rotate (PDF, images) |
| `b` | Bookmark the page or line |
| `← →` | Previous / next slide |
| `↑ ↓ Enter Space` | Move, open, tick in the file browser |

## 8. Good to know

* Everything stays on your computer. Notes, annotations and the planner are kept in `workspace.db` next to the app.
* If you move or rename a file, open it once at the new place: annotations, tags and favourites follow it.
* Big files are fine: a 2-million-row `.mat`, a 600-page PDF or a 25 000-line source file open in about a second.
* `.mat` files are loaded into memory when opened (roughly their size); the last three are kept.
