# Data model

All persistent data lives in one SQLite file, `workspace.db` (created automatically; git-ignored). Set the
`WORKSPACE_DB` environment variable to use another file. The schema is created by the append-only list
`store.MIGRATIONS` (currently **3** migrations; `PRAGMA user_version` stores how many have run).

Identifiers: `files.id` is an integer; every other table uses a 12-character hex string. Timestamps are Unix seconds
(floats); dates are `YYYY-MM-DD` strings in local time.

## Tables

### Library (migration 1, extended in 3)

**`files`** – every file the app has seen (opened, favourited, tagged, annotated or linked).

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `path` | TEXT UNIQUE | absolute path |
| `name`, `ext`, `category` | TEXT | `category` from `catalog.category_for` |
| `size`, `mtime` | INTEGER, REAL | at last open |
| `fingerprint` | TEXT | sha1 of size + first 64 KB; used to follow moved files |
| `first_opened`, `last_opened` | REAL | `last_opened` is NULL after "Clear history" |
| `open_count` | INTEGER | |
| `favorite`, `pinned` | INTEGER 0/1 | |
| `subject_id` | TEXT | → `subjects.id` (no foreign key; cleared when the subject is deleted) |
| `tags` | TEXT | JSON list of lower-case strings |

**`settings`** – `key`, `value` (JSON). Known keys: `start_folder`, `daily_goal_minutes` (60), `pomo_focus` (25),
`pomo_short` (5), `pomo_long` (15). An internal `subjects_seeded` flag prevents re-creating default subjects.

### Annotations (migration 2)

**`annotations`** – `id`, `file_id` → `files` (cascade), `kind`, `category`, `text`, `quote`, `locator` (JSON),
`created`, `updated`.

| `kind` | Meaning |
|---|---|
| `highlight`, `underline`, `strikeout` | text markup (strikeout: PDF only) |
| `comment` | legacy: a highlight that carries a comment (imported from the old code comments) |
| `note` | PDF sticky note at a point |
| `drawing` | PDF pen stroke |
| `bookmark` | a page (PDF) or a line (code) |

`category` is one of `general`, `definition`, `question`, `exam`, `important`, `todo` (see `catalog.ANNOTATION_CATEGORIES`).
Any annotation with `text` counts as a comment in the UI.

Locators:

```jsonc
{"start": 10, "end": 12}                                  // code: lines (1-based, inclusive)
{"page": 3, "rects": [[60, 640, 200, 655]]}               // PDF text markup, PDF user-space units, origin bottom-left
{"page": 2, "rects": [[300, 500, 300, 500]]}              // PDF sticky note (a point)
{"page": 2, "points": [[[100,100],[150,120]]], "width": 2.2}   // PDF drawing: strokes of points, width in PDF units
{"page": 3}                                               // PDF bookmark
```

### Study data (migration 3)

| Table | Columns (besides `id`, `created`, `updated`) |
|---|---|
| `subjects` | `name` (unique, case-insensitive), `color`, `position` |
| `notes` | `title`, `body` (Markdown), `subject_id`, `tags` (JSON), `pinned` |
| `note_links` | `note_id` → notes (cascade), `file_id` → files (cascade), `locator` (JSON); primary key is all three |
| `snippets` | `title`, `language`, `code`, `subject_id`, `tags` |
| `questions` | `question`, `answer`, `subject_id`, `difficulty` (easy/medium/hard), `source`, `box` (0–5), `due`, `last_reviewed` |
| `todos` | `title`, `done`, `due`, `subject_id`, `priority` (1–3), `completed_at` |
| `goals` | `title`, `kind` (`text` or `minutes`), `target`, `period` (`day`/`week`), `subject_id`, `active` (0 = completed) |
| `sessions` | `minutes`, `subject_id`, `kind` (`focus`/`manual`), `note`, `day` |
| `reminders` | `title`, `due`, `subject_id`, `file_id` (a `files.id` as text), `done` |
| `exams` | `name`, `date`, `subject_id` |
| `checklist` | `exam_id` → exams (cascade), `text`, `done`, `position` |
| `collections` | `name` (unique, case-insensitive) |
| `collection_files` | `collection_id` → collections (cascade), `file_id` → files (cascade) |

Notes:

* Deleting a subject sets `subject_id` to NULL everywhere; nothing else is deleted.
* "Clear history" removes only the recent-files marker. A `files` row is deleted only if it has no favourite, pin,
  subject, tag, annotation, note link or collection membership.
* Spaced repetition (Leitner boxes): intervals by box are 0, 1, 3, 7, 14, 30 days. *Again* → box 0 (due today);
  *Hard* → same box (at least 1), half the interval; *Good* → box + 1; *Easy* → box + 2 (maximum 5).
* The streak counts consecutive days with at least one session ending today, or yesterday if today has none yet.

## Backup file format

`GET /api/backup` returns JSON; `POST /api/backup/restore` merges it. References use **file paths and subject names,
never database ids**, so a backup can be restored on a fresh installation.

```jsonc
{
  "app": "NinaPro Study Workspace", "version": 1, "exported": "2026-11-19T22:00:00",
  "subjects":    [{"name": "Operating Systems"}],
  "files":       [{"path": "...", "name": "...", "ext": ".pdf", "category": "pdf", "favorite": true, "pinned": false, "tags": ["exam"], "subject": "Operating Systems"}],
  "annotations": [{"file": "<path>", "kind": "highlight", "category": "definition", "text": "", "quote": "", "locator": {"page": 1, "rects": []}, "created": 0, "updated": 0}],
  "notes":       [{"title": "", "body": "", "subject": null, "tags": [], "pinned": false, "created": 0, "updated": 0, "links": [{"file": "<path>", "locator": {}}]}],
  "snippets": [], "questions": [], "todos": [], "goals": [], "sessions": [], "reminders": [],
  "exams":       [{"name": "", "date": "", "subject": null, "checklist": [{"text": "", "done": false, "position": 0}]}],
  "collections": [{"name": "", "files": ["<path>"]}],
  "settings": {"daily_goal_minutes": 60, "pomo_focus": 25, "pomo_short": 5, "pomo_long": 15}
}
```

Restore rules: subjects and collections are matched by name; duplicates are detected by natural keys
(notes: title + body; annotations: file + kind + locator + text; questions: text; to-dos: title + due; sessions: day +
minutes + note; reminders: title + due; exams: name + date; snippets: title + code). Restoring the same file twice adds
nothing. Version numbers newer than the app understands are refused.

## Browser storage (`localStorage`)

View preferences only: `theme`, `navMin`, `lastDir:<category>`, `pdf:<path>` (page, zoom, rotation), `pdfCat`,
`pdfNavHidden`, `pdfAnnHidden`, `codeCat`, `fs`, `wrap`, `matPanel`, `docFont`, `docToc`, `pptNotes`, `noteMode`,
`vizAlgo`, `vizData`, `dryrun` (draft table), `pomo` (running timer). Clearing it never loses study data.
