"""NinaPro .mat viewer: a local, Excel-like web viewer with CSV export.

Run:  python main.py   then open http://127.0.0.1:5000
"""
import csv
import io
import os
import re
import uuid
import zipfile
from pathlib import Path

import h5py
import numpy as np
from flask import Flask, Response, abort, jsonify, render_template, request
from scipy.io import loadmat

BASE = Path(__file__).resolve().parent
DATA_DIR = BASE / "data"
UPLOAD_DIR = BASE / "uploads"
MAX_ROWS_PER_REQUEST = 1000

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 4 * 1024**3  # 4 GB uploads

# file_id -> {"name": str, "sheets": {var_name: 2D ndarray}, "notes": {var: str}}
LOADED = {}


# ---------------------------------------------------------------- loading
def to_2d(arr):
    """Convert any array into an (rows x cols) array; return (array, note)."""
    arr = np.asarray(arr)
    note = ""
    if arr.dtype.kind in "US":  # strings
        return arr.reshape(1, -1) if arr.ndim else arr.reshape(1, 1), note
    if arr.ndim == 0:
        return arr.reshape(1, 1), note
    if arr.ndim == 1:
        return arr.reshape(-1, 1), note
    if arr.ndim > 2:
        note = f"original shape {arr.shape}, flattened to {arr.shape[0]} rows"
        return arr.reshape(arr.shape[0], -1), note
    return arr, note


def usable(arr):
    return isinstance(arr, np.ndarray) and arr.dtype.kind in "biufcUS" and arr.size > 0


def load_v5(path):
    raw = loadmat(path, squeeze_me=False, struct_as_record=False)
    sheets, notes = {}, {}
    for key, val in raw.items():
        if key.startswith("__"):
            continue
        if usable(val):
            sheets[key], notes[key] = to_2d(val)
    return sheets, notes


def load_v73(path):
    sheets, notes = {}, {}

    def visit(name, obj):
        if isinstance(obj, h5py.Dataset) and obj.dtype.kind in "biuf" and obj.size:
            arr = obj[()]
            # MATLAB stores column-major; h5py reverses dims
            arr = np.asarray(arr).T
            sheets[name.replace("/", ".")], notes[name.replace("/", ".")] = to_2d(arr)

    with h5py.File(path, "r") as f:
        f.visititems(visit)
    return sheets, notes


def load_mat(path):
    try:
        return load_v5(path)
    except NotImplementedError:  # MATLAB v7.3 (HDF5)
        return load_v73(path)
    except ValueError:
        if h5py.is_hdf5(path):
            return load_v73(path)
        raise


def register(path, display_name):
    sheets, notes = load_mat(str(path))
    if not sheets:
        raise ValueError("No numeric variables found in this .mat file.")
    fid = uuid.uuid4().hex[:12]
    LOADED[fid] = {"name": display_name, "sheets": sheets, "notes": notes}
    return fid


# ---------------------------------------------------------------- helpers
def sheet_or_404(fid, var):
    f = LOADED.get(fid)
    if not f or var not in f["sheets"]:
        abort(404, "Unknown file or variable (server may have restarted; re-open the file).")
    return f["sheets"][var]


def cell(v):
    if isinstance(v, (float, np.floating)):
        return None if not np.isfinite(v) else float(v)
    if isinstance(v, (bytes, np.bytes_)):
        return v.decode(errors="replace")
    if isinstance(v, np.generic):
        return v.item()
    return v


def meta(fid):
    f = LOADED[fid]
    return {
        "id": fid,
        "name": f["name"],
        "sheets": [
            {"name": k, "rows": int(a.shape[0]), "cols": int(a.shape[1]),
             "dtype": str(a.dtype), "note": f["notes"].get(k, "")}
            for k, a in f["sheets"].items()
        ],
    }


def safe_name(s):
    return re.sub(r"[^\w.-]+", "_", s)


def csv_rows(arr, chunk=20000):
    """Yield CSV text for the array in chunks (memory friendly)."""
    ncols = arr.shape[1]
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow([f"col{i + 1}" for i in range(ncols)])
    yield buf.getvalue()
    for start in range(0, arr.shape[0], chunk):
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerows(arr[start:start + chunk].tolist())
        yield buf.getvalue()


# ---------------------------------------------------------------- routes
@app.get("/")
def index():
    return render_template("index.html")


@app.get("/api/local-files")
def local_files():
    files = sorted(p.name for p in DATA_DIR.glob("*.mat"))
    return jsonify(files)


@app.post("/api/open-local")
def open_local():
    name = (request.get_json(silent=True) or {}).get("name", "")
    path = (DATA_DIR / Path(name).name)
    if path.suffix.lower() != ".mat" or not path.is_file():
        abort(404, "File not found in data/ folder.")
    try:
        fid = register(path, path.name)
    except Exception as e:
        return jsonify(error=f"Could not read file: {e}"), 400
    return jsonify(meta(fid))


@app.post("/api/upload")
def upload():
    up = request.files.get("file")
    if not up or not up.filename.lower().endswith(".mat"):
        return jsonify(error="Please choose a .mat file."), 400
    dest = UPLOAD_DIR / f"{uuid.uuid4().hex}.mat"
    up.save(dest)
    try:
        fid = register(dest, Path(up.filename).name)
    except Exception as e:
        return jsonify(error=f"Could not read file: {e}"), 400
    finally:
        dest.unlink(missing_ok=True)  # data is in memory now
    return jsonify(meta(fid))


@app.get("/api/rows/<fid>/<var>")
def rows(fid, var):
    arr = sheet_or_404(fid, var)
    start = max(0, request.args.get("start", 0, type=int))
    count = min(MAX_ROWS_PER_REQUEST, request.args.get("count", 100, type=int))
    block = arr[start:start + count]
    return jsonify(start=start, rows=[[cell(v) for v in r] for r in block])


@app.get("/api/export/<fid>/<var>.csv")
def export_csv(fid, var):
    arr = sheet_or_404(fid, var)
    name = f"{safe_name(Path(LOADED[fid]['name']).stem)}_{safe_name(var)}.csv"
    return Response(csv_rows(arr), mimetype="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="{name}"'})


@app.get("/api/export-all/<fid>.zip")
def export_all(fid):
    f = LOADED.get(fid) or abort(404)
    mem = io.BytesIO()
    with zipfile.ZipFile(mem, "w", zipfile.ZIP_DEFLATED) as z:
        for var, arr in f["sheets"].items():
            z.writestr(f"{safe_name(var)}.csv", "".join(csv_rows(arr)))
    mem.seek(0)
    return Response(mem.getvalue(), mimetype="application/zip", headers={
        "Content-Disposition": f'attachment; filename="{safe_name(Path(f["name"]).stem)}_csv.zip"'})


@app.errorhandler(404)
def nf(e):
    return jsonify(error=getattr(e, "description", "Not found")), 404


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    app.run(host="127.0.0.1", port=port, debug=False)
