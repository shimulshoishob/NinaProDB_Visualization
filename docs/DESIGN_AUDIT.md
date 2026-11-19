# Design audit and redesign roadmap

*Phase 1 of the premium-redesign programme. Nothing in the application was changed while writing this document.*

Scope inspected: every stylesheet (`static/css/*.css`, 562 lines), the page shell and nine viewer partials
(`templates/`), the dashboard, navigation, PDF viewer and code viewer scripts, the annotation components, and the theme
implementation. I also ran the app at 1024 × 768 in light and dark mode and measured the real layout.

---

## 1. Current UI assessment

### What is already good (keep)

* **Solid foundations.** CSS custom properties for colour, radius and fonts; a working light/dark theme (`data-theme`);
  a single 66-icon SVG set; scoped viewer stylesheets; reduced-motion support; focus-visible outlines; accessible names
  on every control (verified by the smoke test).
* **One accent colour and neutral greys**, a system font stack (`-apple-system, …`), consistent buttons in three variants.
* **Consistent annotation colour meaning** across viewers; GitHub-style dark syntax colours.
* **Structure that supports a redesign**: every viewer is a scoped pane with its own stylesheet, so restyling does not risk
  logic. Routes, API and data model do not need to change for any item below.

### What holds the product back

| # | Finding | Evidence | Impact |
|---|---|---|---|
| 1 | **Reading surfaces get a minority of the screen.** | At 1024 × 768 the PDF page area is **632 × 627 px (≈ 62 % of the width, 82 % of the height)**; the code area is **508 px wide**. Chrome around them: 216 px navigation + 176 px PDF side panel (or 225 px code panel) + **141 px of stacked bars** (document bar 49 + toolbar rows 92). | The two priority experiences feel cramped, like a tool rather than a reading environment. |
| 2 | **Too many always-visible controls.** | The PDF partial has **25 buttons** in two toolbar rows, the code partial **27**. JSON and Markdown add 10 and 7. Selection, find, replace and "modified" bars appear as extra full-width rows. | Visual noise; violates "minimal contextual toolbars"; rows wrap unpredictably at narrow widths. |
| 3 | **Selection actions are heavy.** | Code selection opens a full-width coloured toolbar row that pushes the code down; PDF's floating toolbar is small but its colour dots live in the permanent toolbar. | Interrupts reading; the code view jumps when you select a line. |
| 4 | **The dashboard is a wall of eight bordered cards.** | Same-weight cards with an icon tile, title, blurb and "No recent files" text; no hero, no hierarchy; "Continue studying" appears below the fold; recents lack subject and progress. | Reads as an admin panel. First impression is generic, not premium. |
| 5 | **Typography is utilitarian.** | One 14 px size for almost everything; 22 distinct `font-size` values (12.5 px used 20×, 13 px 13×, 11 px 10×); no defined scale; headings are only 22–28 px with default letter-spacing. Long-form reading (Markdown/Word) uses 15–16 px without a measure limit tuned for reading. | Weak hierarchy; inconsistent sizes between pages. |
| 6 | **Colour is not yet "warm/premium".** | Light mode uses pure white `#fff` for page *and* chrome with cool grey surfaces (`#f7f7f8`); dark mode `#111214` is near-black. 111 hard-coded colour literals live outside the token block (base 32, sql 14, json 12, office 11, pdf 11, study 6, …): syntax tints, amber/green badges, canvas colours. | Light mode has no document-vs-desk contrast (the "paper on a warm desk" feel); some surfaces ignore theme tokens. |
| 7 | **No spacing or radius system.** | Radii: 10 px ×13, 8 px ×12, `var(--radius)` ×10, plus 2/3/4/5/6/7/50/999 px; 9 different `padding` pairs repeated ad hoc; gaps of 2/4/5/6/8/10/12/16. Shadows: 10 different recipes, mostly hard-coded black. | Subtle misalignment and uneven rhythm; harder to keep consistent as the UI grows. |
| 8 | **Motion is nearly absent.** | Only 3 transitions in the whole app; panels, popovers and toasts appear instantly (toasts use no entry animation after the earlier clean-up). | Feels abrupt rather than refined. |
| 9 | **Navigation is functional, not elegant.** | Flat list of 8 items with a lone "STUDY" label; "Library" mixes Favorites/Collections/Tags; Bookmarks have no entry; Settings pinned at the bottom with theme/collapse icons beside it. | Information architecture differs from the target (Workspace / Study / Tools / Preferences). |
| 10 | **Inconsistent patterns between viewers.** | Each viewer builds its own toolbar rhythm: PDF has two rows and a floating bar; code has three bars; MAT has a formula bar; JSON puts search in the toolbar; Markdown has a progress bar; SQL has sub-toolbars. Segmented controls, chips and tabs exist in 3 visual styles (`.seg`, `.chip`, `.tk-tabs`, `.tab`). | The app feels like several tools joined together, not one product. |
| 11 | **PDF specifics.** | "Fit width 96 %" leaves the page partly clipped at the right edge in the narrow pane (horizontal scrollbar) because page padding and the scrollbar are not subtracted consistently; the side panel is permanently open, shows a three-segment tab bar, and thumbnails use a fixed 110 px width; no reading-progress indicator; no distraction-free mode; the annotations panel is a separate right column that hides below 1100 px. | Poor first impression of the highest-priority feature. |
| 12 | **Code specifics.** | Line numbers, current-line indication and selection colours are functional but plain; no study mode; outline/annotation panel always visible; "Export PDF", "Copy", "Go to line", "Find", fonts and fold buttons all sit in one toolbar with equal weight; long lines scroll horizontally without a minimap or indicator; one fixed light/dark highlight pair. | Does not yet feel like a premium reading/editor surface. |
| 13 | **Overlays are inconsistent.** | Folder dialog removed earlier, but popovers (organize, PDF comment, command palette, toasts) each have their own padding, radius and shadow; no shared menu/dropdown component; native `confirm()`/`prompt()` are used for destructive confirmations and "Go to line". | Breaks the premium feel and cannot be themed. |

### Measured baselines (1024 × 768)

| Viewer | Chrome above the content | Content width |
|---|---|---|
| PDF | 141 px | 632 px (with page thumbnails open) |
| Code | 141 px (+ 49 px when a selection bar is open) | 508 px (with panel open) |
| JSON / Markdown | 142 / 143 px | n/a |
| MAT / Word / Slides / Images | 98–101 px | n/a |
| SQL | 50 px (+ sub-toolbars) | n/a |

Target after the redesign: ≤ 56 px of persistent chrome for PDF and code, panels collapsed or overlaid by default
(content ≥ 75 % of the window width), and a distraction-free mode with **0 px** of chrome.

## 2. Component inventory

| Group | Existing components (file) | Notes |
|---|---|---|
| Tokens | `--bg --bg2 --bg3 --fg --fg2 --line --hover --sel --accent --accent-fg --danger --ok --warn --shadow --radius --font --mono` (`base.css`) | Needs a warm surface scale, text scale, spacing/radius/shadow/motion tokens |
| Controls | `.btn` (+ primary/ghost/danger/active), `.icon-btn`, `.seg`, `.chip`, `.cdot`, `.badge`, inputs/select/textarea, `kbd` | Three tab/segment variants to unify |
| Layout | `#nav`, `#docbar`, `.toolbar`, `.page`, `.vpane`, `.split`, `.panel`, `.rows`, `.row`, `.card`, `.strip` | `.toolbar` is overloaded (title row, tool row, find row, selection row) |
| Overlays | `#toast`, command palette, organize popover, PDF `#pdfPop` + `#pdfSel`, native `confirm/prompt` | No shared popover/menu/dialog |
| Navigation | `.nav-item`, `.nav-sep`, mini timer, document bar (back, name, queue stepper, view-as select, fullscreen, tag, star) | |
| Viewers | nine panes (mat, json, md, sql, code, pdf, image, docx, pptx) + external fallback | Each with its own toolbar markup |
| Reading content | `.markdown-body`, `.reading` (Word), `.codebox`, `.pg` (PDF page), `.bars` etc. | Typography not shared |
| Annotation UI | `Ann.panel`, `.cdot`, `.am` layers, `.cmt` bubbles, `.apin`, `.abm` | Behaviour is good; styling should be harmonised |
| Icons | `icons.js`: 66 stroke icons, `icon()` / `<i data-icon>` | Keep; add a few (sidebar-left/right, minus, more) |

## 3. Design direction

**Calm, editorial, quiet.** Paper on a warm desk; content first; controls appear when needed. Inspired by Apple's
product pages (large confident type, generous whitespace), Apple Books (comfortable reading, sidebars that come and
go) and macOS (predictable, restrained controls). One restrained blue accent. No gradients, no glass.

### 3.1 Colour (CSS custom properties, same names kept for compatibility)

| Role | Light | Dark |
|---|---|---|
| Desk (window background) | `#f5f4f1` warm neutral | `#1c1c1e` deep charcoal |
| Paper (document/content surface) | `#ffffff` | `#26262a` |
| Raised surface (menus, popovers) | `#ffffff` + soft shadow | `#2c2c30` + soft shadow |
| Sidebar | translucent-free `#efeeea` | `#232326` |
| Text | `#1d1d1f` (primary) · `#6e6e73` (secondary) · `#86868b` (tertiary) | `#f5f5f7` · `#a1a1a6` · `#8e8e93` |
| Hairlines | `rgba(0,0,0,.08)` | `rgba(255,255,255,.10)` |
| Accent | `#0a64d6`-family blue (4.5:1 on paper) | `#4d9bff` |
| Semantic | success `#248a3d`, warning `#9a5b00`, danger `#d70015` (dark variants lighter) | |

Rules: never pure black; documents sit on "paper" surfaces; all component colours derive from tokens
(`color-mix` for tints); the 111 stray colour literals move into tokens (syntax themes and annotation palette get their
own named token groups). Contrast is verified for every text/surface pair in both themes.

### 3.2 Typography

System stack `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif`; monospace
`ui-monospace, "SF Mono", Menlo, Consolas`. A fixed scale (11 / 12 / 13 / 14 / 16 / 22 / 28 / 40 px), weights 400/500/600,
tighter tracking on large headings (−0.02 em), line heights 1.45 (UI) / 1.65–1.7 (reading). Reading surfaces cap the line
length (~68 characters) and expose size (and for Word/Markdown, serif/sans) preferences that are remembered.

### 3.3 Space, shape, depth, motion

* **Spacing** on a 4 px grid: 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 (`--s1…--s8`).
* **Radii**: 6 (controls) · 10 (surfaces/popovers) · 14 (large panels) · 999 (pills). Everything else is removed.
* **Shadows**: three elevations only (hairline, popover, dialog), low opacity, no coloured glows.
* **Motion**: 120–180 ms ease-out for hover, popovers, panel slide; 200 ms for page content fade; nothing that animates
  while reading; all of it disabled under `prefers-reduced-motion`.
* **Density**: comfortable by default, with a compact option for toolbars.

### 3.3a Shared components to build in Phase 2

Buttons (primary / secondary / quiet / icon), segmented control, tabs, chips, inputs and selects, **menu/popover**, **dialog**
(replacing `confirm()`/`prompt()`), tooltip, toast (with entry/exit), badge, list row, section header, empty state,
skeleton/loading state.

## 4. Information architecture and navigation

```
WORKSPACE   Home · Recent · Library · Favorites · Collections
STUDY       Subjects · Notes · Annotations · Bookmarks
TOOLS       Planner · Toolkit
            Settings (bottom)
```

All entries map onto existing routes (no URL or API breaks): Favorites → `#/library/favorites`, Collections →
`#/library/collections`, **Bookmarks → the Annotations page pre-filtered to bookmarks** (new route alias
`#/annotations/bookmarks`). Slim 224 px sidebar (collapses to a 56 px icon rail, remembers its state), quiet
active state (tinted pill, accent icon), small-caps section labels, keyboard focus and `aria-current`, theme toggle moves
to Settings and the command palette.

## 5. Page-level plans

### 5.1 Dashboard (Phase 3)

1. **Hero**: “Your space to think, learn, and build.” + supporting line; primary action **Open a document** (opens the
   native dialog, falling back to the category chooser), secondary **Explore your library**. Large type, generous
   whitespace, no card.
2. **Continue studying**: a horizontal row of recent documents as quiet "paper" tiles: file-type glyph, name, subject,
   *last opened* and a **reading-progress** line (PDF only: last page ÷ page count, stored with the reading position;
   other types show none rather than inventing a number).
3. **Explore your materials**: seven calm shortcuts in a single grouped list (icon + name + count), not eight cards.
4. **Your workspace**: Favorites, Pinned, Collections, Subjects and Recent notes as compact lists in two columns.
5. **Study overview**: a single quiet line/strip (today's time, items to revise, next exam, goal), clearly secondary.
6. Search stays (`/`), restyled as a rounded field under the hero. All current dashboard functions (pinned files,
   unified search, category cards) are preserved, just re-presented.

File selection (category browser): same flow and API; restyled breadcrumbs, sticky header, quieter table, larger preview
with metadata, an "Open" button that follows the selection.

### 5.2 PDF reading studio (Phase 4, highest priority)

* **One slim 44–52 px header** (back · title · progress · page box · zoom menu · panel toggles · search · overflow menu).
  The second toolbar row disappears: rotate, print, export, fit modes and reading preferences move to a **View menu** and an
  **Actions menu**; annotation tools live in a **floating, collapsible tool dock** and in the selection popover.
* **Sidebars as Apple-Books panels**: Pages · Contents · Annotations in one left panel (segmented), collapsed or overlaid
  by default on narrow windows, state and width remembered; the separate right annotations column folds into the same panel
  (with colour/kind filters and jump-to).
* **Reading**: thin progress bar, last-read page restoration (already stored; surfaced), fit width/page that correctly
  accounts for scrollbars and padding, search with *n of m* and next/previous in the header, **Distraction-free mode**
  (hides all chrome; hover or `Esc` reveals it), full screen.
* **Annotation experience**: refined floating selection toolbar (highlight, underline, strikethrough, comment, to notes, with a
  colour popover), consistent colours, comment popover in the shared popover style, delete confirmation in the shared dialog.
  All existing behaviour (notes, pen, bookmarks, export) stays.
* Rendering path (lazy pages, text layer, decimation) is not touched.

### 5.3 Code reading studio (Phase 5, highest priority)

* **One slim header** (file · language · find · outline toggle · view menu · study-mode toggle); selection actions become a
  **floating popover next to the selected lines** (style, colour, comment, bookmark, to notes) so the code never jumps.
* **Presentation**: tuned monospace (SF Mono/Menlo, 13 px / 1.65), softer gutter with the current line number emphasised,
  subtle current-line highlight, refined selection colour, indentation guides (CSS only), designed light and dark syntax
  palettes (new token group; Pygments classes remapped), wrap vs horizontal scroll with a visible overflow cue.
* **Navigation**: outline and annotations as a collapsible side panel with search; symbol filter in the outline; `Ctrl/⌘ + P`
  style "go to symbol" using the existing outline; Find/Replace as a compact inline bar; go-to-line as a small popover.
* **Study mode** (optional): hides everything except code, a slim bookmark/annotation rail and a personal explanation panel;
  selected code can be sent to notes. No external service is involved; the "future AI" items remain out of scope.
* Annotation storage is unchanged (line-based).

### 5.4 Remaining viewers (Phase 6)

Apply the shared header pattern, typography, surfaces and menus: Markdown and Word get the reading typography (measure,
size, serif/sans preference), Word and Markdown a quiet contents panel, slides a cleaner filmstrip, JSON/SQL/MAT a unified
data-table style (sticky header, tabular numerals), images a neutral stage with a floating zoom control.

### 5.5 Final polish (Phase 7)

Transitions, loading skeletons, empty states, friendly error copy, keyboard map, responsive passes at 1440 / 1024 / 768 /
375 px, contrast and screen-reader checks, performance re-measurement.

## 6. Roadmap and validation

| Phase | Deliverable | Validation |
|---|---|---|
| **2 Design system** | New tokens (colour, type, spacing, radius, shadow, motion), unified button/segment/tab/input/menu/dialog/tooltip/toast components, warm light and charcoal dark themes, restyled sidebar | Unit tests, lint, JS syntax, smoke test, screenshots of every page in both themes, contrast table |
| **3 Dashboard** | Hero, continue-studying, workspace lists, study overview, refreshed category browser | Smoke test; open files from every entry point |
| **4 PDF studio** | Slim header, menus, collapsible Pages/Contents/Annotations panel, progress, distraction-free mode, floating toolbar polish | Render, search, annotate, export, large-PDF performance (600 pages) re-measured |
| **5 Code studio** | Slim header, selection popover, study mode, new code themes, outline search | Fold, annotate, replace, 25 000-line file performance re-measured |
| **6 Remaining viewers** | Unified headers and typography | Smoke test; each viewer manually |
| **7 Polish** | Motion, loading/empty/error states, responsive and accessibility pass | Full QA list: unit tests, `ruff`, `node --check`, smoke test, manual flows (dashboard, browse, PDF render/search/annotate/export, code fold/annotate, notes autosave, theme, shortcuts, backup/restore) |

### Constraints preserved in every phase

No framework or build step; Flask, SQLite, PDF.js and Pygments stay; no endpoint is removed or changed incompatibly;
existing databases and annotations load unchanged; the file-access security model and CSP stay (no inline event
attributes, no external fonts or scripts); originals are never modified by viewing or annotating.

### Risks and mitigations

| Risk | Mitigation |
|---|---|
| Large CSS refactor regresses a viewer | Tokens first and aliases for old variable names; per-phase screenshot comparison and the smoke test |
| PDF layout changes break fit-to-width or annotation geometry | Annotation coordinates are stored in PDF units and are independent of layout; test at several window sizes |
| Reading progress needs a page count | Store `{page, pages}` with the existing per-file reading position; show progress only when known |
| Dialog/popover rewrite changes keyboard behaviour | Shared components own focus trap, `Esc`, and return-focus; covered by the smoke test |
| Warm light theme lowers contrast | Contrast checked programmatically for every token pair; no pair below 4.5:1 for text |

### Decisions I would like confirmed

1. **Navigation labels**: Favorites, Collections and Bookmarks as separate sidebar entries mapped to the existing pages (as above).
2. **Accent**: a restrained Apple-style blue replacing the current deeper blue.
3. **Hero copy** exactly as in the brief, and **Open a document** launching the native chooser (falling back to the in-app browser).
4. **Reading progress** shown for PDFs only (reliable), other types shown without a progress bar.
5. **Fonts**: system fonts only (no downloaded fonts), which keeps the app offline and CSP-clean.
