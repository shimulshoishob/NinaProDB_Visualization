"""MAT viewer API: NinaPro .mat (v5/v7/v7.3) as spreadsheet-like sheets, stats, chart series, CSV."""
import csv
import hashlib
import io
import math
import re
import zipfile
from collections import OrderedDict
from pathlib import Path

import h5py
import numpy as np
from flask import Blueprint, Response, abort, jsonify, request
from scipy.io import loadmat

from common import ws

bp = Blueprint("mat_viewer", __name__)
MAX_ROWS_PER_REQUEST = 1000
MAX_CACHED_FILES = 3  # keep RAM in check: the least recently used file is evicted
LOADED = OrderedDict()  # file id -> {"name", "sheets": {var: 2D ndarray}, "notes", "stats"}


# ------------------------------------------------------------- loading
def to_2d(arr):
    """Convert any array into (rows x cols); returns (array, note)."""
    arr = np.asarray(arr)
    if arr.dtype.kind in "US":
        return (arr.reshape(1, -1) if arr.ndim else arr.reshape(1, 1)), ""
    if arr.ndim == 0:
        return arr.reshape(1, 1), ""
    if arr.ndim == 1:
        return arr.reshape(-1, 1), ""
    if arr.ndim > 2:
        return arr.reshape(arr.shape[0], -1), f"original shape {arr.shape}, flattened to {arr.shape[0]} rows"
    return arr, ""


def load_v5(path):
    """Read a classic (v5 / v7) MAT file into 2-D arrays."""
    sheets, notes = {}, {}
    for key, val in loadmat(path, squeeze_me=False, struct_as_record=False).items():
        if key.startswith("__"):
            continue
        if isinstance(val, np.ndarray) and val.dtype.kind in "biufcUS" and val.size:
            sheets[key], notes[key] = to_2d(val)
    return sheets, notes


def load_v73(path):
    """Read a MATLAB v7.3 (HDF5) file into 2-D arrays."""
    sheets, notes = {}, {}

    def visit(name, obj):
        """Collect one HDF5 dataset as a sheet."""
        if isinstance(obj, h5py.Dataset) and obj.dtype.kind in "biuf" and obj.size:
            key = name.replace("/", ".")
            sheets[key], notes[key] = to_2d(np.asarray(obj[()]).T)  # MATLAB is column-major

    with h5py.File(path, "r") as f:
        f.visititems(visit)
    return sheets, notes


def load_mat(path):
    """Read any MAT file, detecting the format."""
    try:
        return load_v5(path)
    except NotImplementedError:  # MATLAB v7.3 (HDF5)
        return load_v73(path)
    except ValueError:
        if h5py.is_hdf5(path):
            return load_v73(path)
        raise


# ------------------------------------------------------------- helpers
def get_file(fid):
    """A cached loaded file by id (404 if it was evicted)."""
    f = LOADED.get(fid)
    if not f:
        abort(404, f"File is no longer in memory (the last {MAX_CACHED_FILES} opened are kept). Click it in the sidebar to reopen.")
    LOADED.move_to_end(fid)
    return f


def sheet_or_404(fid, var):
    """The 2-D array of one variable, or a 404."""
    f = get_file(fid)
    if var not in f["sheets"]:
        abort(404, "Unknown variable.")
    return f["sheets"][var]


def cell(v):
    """JSON-safe version of one cell value (NaN becomes null)."""
    if isinstance(v, (float, np.floating)):
        return None if not np.isfinite(v) else float(v)
    if isinstance(v, (bytes, np.bytes_)):
        return v.decode(errors="replace")
    if isinstance(v, np.generic):
        return v.item()
    return v


def clean(vals):
    """Replace non-finite floats with None."""
    return [None if not math.isfinite(v) else v for v in vals]


def meta(fid):
    """Sheet list (name, size, dtype) of a loaded file."""
    f = LOADED[fid]
    return {"id": fid, "name": f["name"], "sheets": [
        {"name": k, "rows": int(a.shape[0]), "cols": int(a.shape[1]), "dtype": str(a.dtype),
         "note": f["notes"].get(k, ""), "numeric": a.dtype.kind in "biuf"}
        for k, a in f["sheets"].items()]}


def safe_name(s):
    """File-name-safe version of a string."""
    return re.sub(r"[^\w.-]+", "_", s)


def csv_rows(arr, start=0, stop=None, chunk=20000):
    """Yield CSV text for a row range in chunks (streams large sheets)."""
    stop = arr.shape[0] if stop is None else stop
    buf = io.StringIO()
    csv.writer(buf).writerow([f"col{i + 1}" for i in range(arr.shape[1])])
    yield buf.getvalue()
    numeric = arr.dtype.kind in "iuf"
    for s in range(start, stop, chunk):
        rows = arr[s:min(s + chunk, stop)].tolist()
        if numeric:                               # fast path: no quoting is ever needed for numbers (about 1.5x faster)
            yield "\n".join(",".join(map(repr, r)) for r in rows) + "\n"
        else:
            buf = io.StringIO()
            csv.writer(buf).writerows(rows)
            yield buf.getvalue()


# ------------------------------------------------------------- routes
@bp.post("/api/mat/open")
def open_file():
    """Load a .mat file (cached) and list its variables as sheets."""
    path = ws.resolve((request.get_json(silent=True) or {}).get("path", ""))
    if path.suffix.lower() != ".mat" or not path.is_file():
        abort(404, "File not found.")
    fid = hashlib.md5(f"{path}:{path.stat().st_mtime_ns}".encode()).hexdigest()[:12]
    if fid not in LOADED:
        try:
            sheets, notes = load_mat(str(path))
        except Exception as e:  # corrupt / unsupported file
            return jsonify(error=f"Could not read file: {e}"), 400
        if not sheets:
            return jsonify(error="No numeric variables found in this .mat file."), 400
        LOADED[fid] = {"name": path.name, "sheets": sheets, "notes": notes, "stats": {}}
        while len(LOADED) > MAX_CACHED_FILES:
            LOADED.popitem(last=False)
    LOADED.move_to_end(fid)
    return jsonify(meta(fid))


@bp.get("/api/mat/rows/<fid>/<var>")
def rows(fid, var):
    """A page of rows from a variable (at most 1000)."""
    arr = sheet_or_404(fid, var)
    start = max(0, request.args.get("start", 0, type=int))
    count = min(MAX_ROWS_PER_REQUEST, request.args.get("count", 100, type=int))
    return jsonify(start=start, rows=[[cell(v) for v in r] for r in arr[start:start + count]])


@bp.get("/api/mat/stats/<fid>/<var>")
def stats(fid, var):
    """Per-column min, max, mean, std, RMS, median and NaN count."""
    arr = sheet_or_404(fid, var)
    cache = LOADED[fid]["stats"]
    if var in cache:
        return jsonify(cache[var])
    if arr.dtype.kind not in "biuf":
        return jsonify(error="Statistics are only available for numeric sheets."), 400
    cols = []
    for c in range(arr.shape[1]):
        x = arr[:, c].astype(np.float64)
        ok = np.isfinite(x)
        nan = int((~ok).sum())
        xv = x[ok] if nan else x
        if xv.size:
            cols.append({"col": c, "min": float(xv.min()), "max": float(xv.max()), "mean": float(xv.mean()),
                         "std": float(xv.std()), "median": float(np.median(xv)), "nan": nan,
                         "rms": float(np.sqrt(np.mean(xv ** 2)))})
        else:
            cols.append({"col": c, "min": None, "max": None, "mean": None, "std": None,
                         "median": None, "nan": nan, "rms": None})
    cache[var] = {"rows": int(arr.shape[0]), "cols": cols}
    return jsonify(cache[var])


@bp.get("/api/mat/series/<fid>/<var>")
def series(fid, var):
    """Min/max-decimated series so millions of samples draw in milliseconds."""
    arr = sheet_or_404(fid, var)
    if arr.dtype.kind not in "biuf":
        return jsonify(error="Not numeric."), 400
    n = arr.shape[0]
    s = max(0, min(n - 1, request.args.get("start", 0, type=int)))
    e = max(s + 1, min(n, request.args.get("end", n, type=int)))
    points = max(50, min(4000, request.args.get("points", 1500, type=int)))
    cols = [int(c) for c in request.args.get("cols", "0").split(",") if c.isdigit() and int(c) < arr.shape[1]][:24]
    out = []
    if e - s <= points:
        x = list(range(s, e))
        for c in cols:
            y = clean(arr[s:e, c].astype(np.float64).tolist())
            out.append({"col": c, "min": y, "max": y})
    else:
        edges = np.linspace(s, e, points + 1).astype(np.int64)[:-1]
        x = ((edges + np.append(edges[1:], e)) // 2).tolist()
        for c in cols:
            seg = arr[s:e, c].astype(np.float64)
            out.append({"col": c, "min": clean(np.fmin.reduceat(seg, edges - s).tolist()),
                        "max": clean(np.fmax.reduceat(seg, edges - s).tolist())})
    return jsonify(start=s, end=e, x=x, series=out)


@bp.get("/api/mat/export/<fid>/<var>.csv")
def export_csv(fid, var):
    """Download one variable as CSV, optionally a row range."""
    arr = sheet_or_404(fid, var)
    a = max(1, request.args.get("from", 1, type=int)) - 1
    b = min(arr.shape[0], request.args.get("to", arr.shape[0], type=int))
    rng = f"_rows{a + 1}-{b}" if (a, b) != (0, arr.shape[0]) else ""
    name = f"{safe_name(Path(LOADED[fid]['name']).stem)}_{safe_name(var)}{rng}.csv"
    return Response(csv_rows(arr, a, b), mimetype="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="{name}"'})


@bp.get("/api/mat/export-all/<fid>.zip")
def export_all(fid):
    """Download every variable as a ZIP of CSV files."""
    f = get_file(fid)
    mem = io.BytesIO()
    with zipfile.ZipFile(mem, "w", zipfile.ZIP_DEFLATED) as z:
        for var, arr in f["sheets"].items():
            z.writestr(f"{safe_name(var)}.csv", "".join(csv_rows(arr)))
    return Response(mem.getvalue(), mimetype="application/zip", headers={
        "Content-Disposition": f'attachment; filename="{safe_name(Path(f["name"]).stem)}_csv.zip"'})
