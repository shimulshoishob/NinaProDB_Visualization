"""Tests for the unified annotation store, its API, legacy import, file relinking and annotated-PDF export."""
import io
import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.environ["WORKSPACE_DB"] = str(Path(tempfile.mkdtemp()) / "boot.db")

import store  # noqa: E402
from main import app  # noqa: E402
from pypdf import PdfReader  # noqa: E402

DATA = ROOT / "data"
PDF = str(DATA / "pdf" / "algorithms_notes.pdf")
CODE = str(DATA / "code" / "example.py")


class AnnotationTests(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        store.reset(self.dir / "t.db")
        self.c = app.test_client()

    def mk(self, path=PDF, **kw):
        body = {"path": path, "kind": "highlight", "category": "general", "text": "", "quote": "", **kw}
        r = self.c.post("/api/annotations", json=body)
        self.assertEqual(r.status_code, 200, r.json)
        return r.json

    def test_create_list_update_delete(self):
        a = self.mk(kind="highlight", category="definition", quote="queue", text="BFS", locator={"page": 3, "rects": [[60, 640, 200, 655]]})
        self.assertEqual(self.c.get("/api/annotations", query_string={"path": PDF}).json[0]["id"], a["id"])
        u = self.c.patch(f"/api/annotations/{a['id']}", json={"text": "edited", "category": "exam", "kind": "underline"}).json
        self.assertEqual((u["text"], u["category"], u["kind"]), ("edited", "exam", "underline"))
        self.assertEqual(u["locator"]["page"], 3)            # untouched fields survive a patch
        self.assertEqual(self.c.delete(f"/api/annotations/{a['id']}").json, {"ok": True})
        self.assertEqual(self.c.get("/api/annotations", query_string={"path": PDF}).json, [])
        self.assertEqual(self.c.delete(f"/api/annotations/{a['id']}").status_code, 404)

    def test_validation(self):
        bad = lambda **kw: self.c.post("/api/annotations", json={"path": PDF, "locator": {"page": 1}, **kw}).status_code
        self.assertEqual(bad(kind="nonsense"), 400)
        self.assertEqual(bad(kind="highlight", category="nonsense"), 400)
        self.assertEqual(self.c.post("/api/annotations", json={"path": PDF, "kind": "highlight", "locator": "x"}).status_code, 400)
        self.assertEqual(self.c.post("/api/annotations", json={"path": "/etc/hosts", "kind": "highlight", "locator": {}}).status_code, 403)
        self.assertEqual(self.c.post("/api/annotations", json={"path": str(DATA / "nope.pdf"), "kind": "highlight", "locator": {}}).status_code, 404)

    def test_persist_across_connection_restart(self):
        self.mk(kind="bookmark", text="Graphs", locator={"page": 3})
        store.reset()                                          # simulates closing and re-opening the app
        got = self.c.get("/api/annotations", query_string={"path": PDF}).json
        self.assertEqual([(a["kind"], a["text"]) for a in got], [("bookmark", "Graphs")])

    def test_search_filter_and_grouping_data(self):
        self.mk(kind="highlight", category="definition", text="BFS uses a queue", locator={"page": 3, "rects": []})
        self.mk(path=CODE, kind="highlight", category="exam", text="rms formula", quote="return x", locator={"start": 12, "end": 12})
        self.mk(path=CODE, kind="bookmark", locator={"start": 15, "end": 15})
        q = lambda **kw: self.c.get("/api/annotations/all", query_string=kw).json["items"]
        self.assertEqual(len(q()), 3)
        self.assertEqual([a["text"] for a in q(q="queue")], ["BFS uses a queue"])
        self.assertEqual(len(q(q="algorithms_notes")), 1)      # file names are searchable
        self.assertEqual(len(q(kind="bookmark")), 1)
        self.assertEqual(len(q(category="exam")), 1)
        self.assertEqual(len(q(path=CODE)), 2)
        self.assertEqual(q(kind="bookmark")[0]["file"]["name"], "example.py")

    def test_clearing_history_keeps_annotations(self):
        self.c.post("/api/library/open", json={"path": PDF})
        self.mk(kind="bookmark", locator={"page": 1})
        self.c.post("/api/library/forget", json={})
        self.assertEqual(len(self.c.get("/api/annotations", query_string={"path": PDF}).json), 1)
        self.assertEqual(self.c.get("/api/library/recent").json, [])

    def test_annotations_follow_a_moved_file(self):
        tmp = DATA / "pdf" / "_moved_a.pdf"
        shutil.copy(PDF, tmp)
        try:
            self.c.post("/api/library/open", json={"path": str(tmp)})
            self.mk(path=str(tmp), kind="bookmark", text="keep me", locator={"page": 2})
            moved = DATA / "pdf" / "_moved_b.pdf"
            tmp.rename(moved)
            try:
                self.c.post("/api/library/open", json={"path": str(moved)})
                got = self.c.get("/api/annotations", query_string={"path": str(moved)}).json
                self.assertEqual([a["text"] for a in got], ["keep me"])
            finally:
                moved.unlink(missing_ok=True)
        finally:
            tmp.unlink(missing_ok=True)

    def test_legacy_comments_json_is_imported_once(self):
        legacy = {CODE: [{"id": "old1", "start": 10, "end": 12, "text": "RMS note", "color": "green", "snippet": "def rms", "created": 1.0, "updated": 2.0},
                         {"id": "old2", "start": 15, "end": 15, "text": "", "color": "pink", "snippet": "def main"}]}
        (self.dir / "comments.json").write_text(json.dumps(legacy))
        store.reset(self.dir / "t2.db")
        got = self.c.get("/api/annotations", query_string={"path": CODE}).json
        self.assertEqual(sorted((a["kind"], a["category"], a["locator"]["start"]) for a in got), [("comment", "definition", 10), ("highlight", "exam", 15)])
        self.assertTrue((self.dir / "comments.json.migrated").exists())
        self.assertFalse((self.dir / "comments.json").exists())

    def test_annotated_pdf_export(self):
        self.mk(kind="highlight", category="definition", text="BFS uses a queue", quote="queue", locator={"page": 3, "rects": [[60, 640, 200, 655]]})
        self.mk(kind="underline", category="exam", locator={"page": 1, "rects": [[60, 700, 150, 715], [60, 680, 150, 695]]})
        self.mk(kind="strikeout", locator={"page": 1, "rects": [[60, 600, 150, 615]]})
        self.mk(kind="note", text="check this", locator={"page": 2, "rects": [[300, 500, 300, 500]]})
        self.mk(kind="drawing", category="important", locator={"page": 2, "points": [[[100, 100], [150, 120], [200, 100]]], "width": 2})
        self.mk(kind="bookmark", text="Graphs start", locator={"page": 3})
        before = Path(PDF).read_bytes()
        r = self.c.get("/api/pdf/export", query_string={"path": PDF})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.headers["X-Annotations-Embedded"], "5")
        self.assertIn("annotated.pdf", r.headers["Content-Disposition"])
        self.assertEqual(Path(PDF).read_bytes(), before)       # the original is never modified
        reader = PdfReader(io.BytesIO(r.data))
        subtypes = sorted(str(a.get_object()["/Subtype"]) for p in reader.pages for a in p.get("/Annots", []))
        self.assertEqual(subtypes, ["/Highlight", "/Ink", "/StrikeOut", "/Text", "/Underline"])
        contents = [str(a.get_object().get("/Contents")) for a in reader.pages[2]["/Annots"]]
        self.assertIn("BFS uses a queue", contents)
        titles = []
        def walk(o):
            for x in o:
                titles.extend([x.title] if hasattr(x, "title") else []) if not isinstance(x, list) else walk(x)
        walk(reader.outline)
        self.assertIn("Graphs start", titles)
        self.assertIn("1. Sorting", titles)                    # the PDF's own outline is preserved

    def test_export_without_annotations_and_non_pdf(self):
        self.assertEqual(self.c.get("/api/pdf/export", query_string={"path": PDF}).status_code, 200)
        self.assertEqual(self.c.get("/api/pdf/export", query_string={"path": CODE}).status_code, 404)


if __name__ == "__main__":
    unittest.main()
