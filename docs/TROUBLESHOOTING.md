# Troubleshooting and FAQ

**A file will not open.** The viewer shows *Can't open this file* with the reason. *Try again* re-reads it, *Open with
system app* hands it to your operating system, and *Go back* returns to the list.

## Starting the app

**“Address already in use” / Port 8000 is in use.** Another program (often an older copy of this app) holds the port.
Stop it, or choose another port: `PORT=8001 python main.py`. On macOS, port 5000 is used by AirPlay Receiver, which is why
this app does not use it. To find what uses a port: `lsof -i :8000`.

**`ModuleNotFoundError`.** The virtual environment is not active or the packages are missing:
`source .venv/bin/activate && pip install -r requirements.txt`.

**The page shows old content after I edited a template.** Templates are cached; restart the server. For scripts and
styles reload the page (hard reload if the browser cached them).

**“Folder not found” on start.** The folder you passed as the first argument does not exist.

## Opening files

**“This location is outside your home folder or is hidden, so it cannot be opened.”** By design the app only reads from
your home folder, mounted drives (`/Volumes`, `/mnt`, `/media`, Windows drives) and the project folder, never inside
hidden folders (those starting with a dot). Move or copy the file somewhere visible under your home folder.

**“File not found. It may have been moved or deleted.”** The file is no longer at the saved path. Open it from its new
location; annotations, tags and favourites follow it automatically (matched by content).

**A PDF shows “Cannot open this PDF”.** It may be damaged or password protected (you will be asked for the password).
Use **Open with system app** to check whether another program can read it.

**A `.mat` file fails to open.** The message says why. Common causes: the file is not a MATLAB file, or it contains only
structs/cell arrays (only numeric and text arrays are shown). Files saved with `-v7.3` need `h5py` (installed by
`requirements.txt`).

**A `.docx`/`.pptx` looks different from Word/PowerPoint.** These are *reading views*: text, tables and pictures are
shown, not exact layout. Legacy `.doc`, `.ppt`, `.odt`, `.rtf` open in your system app.

**A `.py` file says “looks like a binary file”.** It contains NUL bytes; the code viewer only shows text.

**A large file is slow.** `.mat` files are loaded into memory (about their size). JSON up to 100 MB and source files up
to 2 MB are supported; bigger ones are refused or truncated with a note.

## File dialog and system integration

**“Choose from computer…” does nothing or says no dialog is available.** The native dialog uses `osascript` (macOS),
PowerShell (Windows) or `zenity` (Linux: install it, for example `sudo apt install zenity`). Without it, use the in-app
folder browser. On macOS the first dialog may appear behind the browser window.

**“Open with system app” fails.** It uses `open` (macOS), `start` (Windows) or `xdg-open` (Linux).

## Annotations and notes

**My annotations disappeared.** They are stored in `workspace.db` next to the app. Check that you started the app from
the same folder (or set `WORKSPACE_DB` consistently), and that you did not delete the database. Restore a backup in
Settings → Backup and restore.

**An annotation is on the wrong line after I edited the file.** Code annotations are anchored to line numbers; a
“line text changed” hint appears when the text on that line no longer matches. Replace in the viewer changes only a
working copy and warns when the line count changes.

**Notes are not saving.** The indicator next to the title shows *Saving…* then *Saved*. If it shows *Not saved*, a message
explains the error (for example the server was stopped). Your text stays in the editor; copy it before reloading.

**The exported PDF shows my highlights in one reader but not another.** Markup is written as standard PDF annotations
without custom appearance streams. Most readers draw them; a few ignore them. The in-app viewer always shows your
annotations from the database.

## Planner

**The timer sound does not play.** Browsers block audio until you interact with the page; click anywhere once.
The toast message appears regardless.

**The streak shows 0.** A streak counts consecutive days with at least one logged session, up to today (or yesterday if
you have not studied yet today).

## Printing and PDF export

**“Export PDF” / “PDF” just prints.** These use your browser's print dialog: choose **Save as PDF** as the destination.
Turn on “Background graphics” for highlight colours.

## Backups

**Restore says the file is not a backup.** Only files created by *Download backup* are accepted. A backup made by a newer
app version is refused with a message.

## Resetting

* Forget recent files: Settings → Clear history.
* Delete **all** study data: stop the app and delete `workspace.db`, `workspace.db-wal` and `workspace.db-shm`.
  (Download a backup first if you might want it back.)
* Browser preferences (theme, zoom, ...) can be cleared by clearing site data for `127.0.0.1:8000`; no study data is
  stored there.

## Still stuck?

Run the checks: `python -m unittest discover -s tests`. Include the failing message, your operating system and Python
version (`python --version`), and the steps to reproduce when you report a problem.
