# NinaProDB_Visualization

NinaPro EMG data visualization and analysis.

A small local web app that opens NinaPro `.mat` files and shows them in an
**Excel-like grid** in your browser, with **CSV export**. Everything runs on
your own machine (`127.0.0.1`); no data leaves your computer.

## Features

- **Spreadsheet view**: column letters (A, B, C…), row numbers, sticky headers,
  cell selection, arrow-key / Tab / PageUp / PageDown navigation, formula bar
  showing the selected cell, "Go to row", `Ctrl/Cmd+C` to copy a cell.
- **One sheet per variable**: `emg`, `glove`, `stimulus`, `restimulus`,
  `repetition`, `acc`, … appear as tabs at the bottom, like Excel sheets.
- **Handles millions of rows**: virtual scrolling loads only the rows on screen,
  so NinaPro recordings (1–2 M+ rows) stay fast.
- **Export CSV**: current sheet as `.csv`, or every sheet as a `.zip` of CSVs.
- Supports both classic MATLAB files (v5/v7) and **v7.3 (HDF5)** files.
- Open a file by dragging it onto the page, the *Open .mat file…* button, or
  by placing it in the `data/` folder and picking it from the dropdown.

## Requirements

- Python 3.9+ (developed on 3.14)

Dependencies are listed in [requirements.txt](requirements.txt):
Flask, NumPy, SciPy, h5py.

## Setup

```bash
python3 -m venv .venv
```
```bash
source .venv/bin/activate        # Windows: .venv\Scripts\activate
```
```bash
pip install -r requirements.txt
```

## Run

```bash
python main.py
```

Then open <http://127.0.0.1:8000>.

To use a different port: `PORT=9000 python main.py`.
(Port 5000 is avoided on purpose: macOS AirPlay Receiver uses it.)

## Usage

1. Open a `.mat` file (drag & drop, button, or the `data/` dropdown).
2. Pick a sheet (variable) from the tabs at the bottom.
3. Scroll or use the keyboard to browse; click a cell to see its value in the
   formula bar.
4. Click **Export sheet as CSV** or **Export all (ZIP)** in the top bar.

CSV columns are named `col1, col2, …` because NinaPro `.mat` files do not store
column names (for `emg`, `col1…colN` are the electrode channels).

## Project structure

```
main.py             Flask server (loading, paging API, CSV export)
templates/index.html  Page layout
static/app.js       Virtual-scrolling grid + UI logic
static/style.css    Excel-like styling
data/               Optional: drop .mat files here to list them in the app
uploads/            Temporary upload location (files are deleted after reading)
requirements.txt    Python dependencies
```

## Notes and limitations

- Files are loaded fully into RAM when opened (a ~500 MB `.mat` file needs a few
  GB of memory). Data is held in memory until the server restarts.
- Only numeric / boolean / text arrays are shown. MATLAB structs and cell arrays
  are skipped. Arrays with more than 2 dimensions are flattened to 2D (a note
  appears in the status bar).
- The grid is read-only (a viewer, not an editor).
- `*.mat` files in `data/` and `uploads/` are git-ignored.

## API (for reference)

| Endpoint | Purpose |
| --- | --- |
| `POST /api/upload` | Upload and parse a `.mat` file |
| `POST /api/open-local` | Parse a file from `data/` |
| `GET /api/rows/<id>/<var>?start=&count=` | Page of rows (max 1000) |
| `GET /api/export/<id>/<var>.csv` | Download one sheet as CSV |
| `GET /api/export-all/<id>.zip` | Download all sheets as CSVs |
