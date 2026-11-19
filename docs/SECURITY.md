# Security and privacy

NinaPro Study Workspace is a **single-user tool that runs on your own computer**. It is designed so that opening a
document can never send it anywhere, and so that a web page you visit cannot use the app to read or change your files.

## Threat model

| Threat | Protection |
|---|---|
| Another computer reaches the server | It listens on `127.0.0.1` only. Never expose it (no port forwarding, no `0.0.0.0`). |
| A malicious web page talks to `http://127.0.0.1:8000` while you browse | Requests whose `Host` is not `localhost`/`127.0.0.1` are refused (**DNS-rebinding**); state-changing requests (`POST`, `PUT`, `PATCH`, `DELETE`) with a foreign `Origin` are refused (**CSRF**); JSON endpoints also require a JSON body, which browsers will not send cross-site without a refused pre-flight. |
| Reading files you did not intend to open | Reads are limited to your home folder, the project folder and mounted drives, and never inside hidden (dot) folders such as `~/.ssh`. Symlinks are resolved before the check. |
| A document contains scripts | Markdown and Word output is sanitised with `nh3` (no scripts, no `javascript:` or `data:` links; `data:image/` only on `<img>`); source code is escaped; PowerPoint text is escaped client-side. |
| A local HTML/SVG file is opened directly through `/api/asset` | Such responses carry `Content-Security-Policy: sandbox`, so scripts in them cannot run in the app's origin. |
| Cross-site scripting in the app itself | A strict Content-Security-Policy (`default-src 'self'`, no remote scripts, no framing by other sites, `base-uri 'self'`), no inline event attributes, and escaping of all user text before it is inserted into the page. |
| SQL files or databases that try to write | Databases open with `mode=ro` and `PRAGMA query_only`; `ATTACH`/`DETACH` are denied by an SQLite authoriser; the console accepts only `SELECT`/`WITH`/`VALUES`/`PRAGMA`/`EXPLAIN`; sandbox scripts run in memory and may not use `VACUUM`, `ATTACH` or `DETACH`; queries stop after 8 seconds. |
| Accidental data loss | Viewers never modify files. Saving from the code viewer needs an explicit confirmation and keeps a `.bak-<timestamp>` copy. Restoring a backup only merges. Deleting notes, annotations and similar items asks for confirmation. |
| Database injection | Column names come from a code-defined whitelist and every value is a bound parameter; unknown fields in requests are ignored. |
| Oversized input | Upload and request bodies are capped at 64 MB, JSON files at 100 MB, source files at 2 MB, backups at 50 MB; page sizes are capped. |

## Privacy

* No telemetry, no analytics, no external requests. pdf.js is vendored in `static/vendor/pdfjs`.
* Your study data is in `workspace.db` (git-ignored). Your original files are never copied; only their paths, names,
  sizes and a content fingerprint are stored.
* A backup file contains your notes, annotations (including quoted text from your documents), tags and paths. Treat it
  like the documents themselves.
* The optional native file dialog runs the operating system's own chooser (`osascript`, PowerShell or `zenity`) on your
  machine; the app sees only the paths you choose.

## Known limitations

* The server is the Flask development server. It is fine for one local user but is not hardened for hostile networks.
* Anyone who can run code as you on the same computer can use the API; there is no password, by design.
* PDF files are parsed by pdf.js (in the browser) and pypdf (for export). Keep dependencies updated
  (`pip install -U -r requirements.txt`) and open untrusted PDFs with the same care as in any PDF reader.
* Annotated-PDF export writes standard annotations without custom appearance streams; behaviour in third-party readers
  varies.

## Reporting a problem

Open an issue in the project repository, or contact the maintainer, with the steps to reproduce. Please do not include
private documents in a report.
