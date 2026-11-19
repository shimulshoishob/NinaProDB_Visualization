"""API tests for the file library, access rules and persistence.  Run:  python -m unittest discover -s tests"""
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.environ["WORKSPACE_DB"] = str(Path(tempfile.mkdtemp()) / "test.db")

import catalog  # noqa: E402
import store  # noqa: E402
from main import app  # noqa: E402
from viewers import library  # noqa: E402

DATA = ROOT / "data"


class LibraryTests(unittest.TestCase):
    def setUp(self):
        store.reset(Path(tempfile.mkdtemp()) / "t.db")
        self.c = app.test_client()

    def test_categories(self):
        self.assertEqual(catalog.category_for(".PY"), "code")
        self.assertEqual(catalog.category_for(".pdf"), "pdf")
        self.assertEqual(catalog.viewer_for(".mat"), "mat")
        self.assertEqual(catalog.viewer_for(".docx"), "docx")
        self.assertEqual(catalog.viewer_for(".pdf"), "pdf")
        self.assertEqual(catalog.viewer_for(".pptx"), "pptx")
        self.assertEqual(catalog.viewer_for(".png"), "image")
        self.assertEqual(catalog.viewer_for(".doc"), "external")   # no built-in reader for legacy formats
        self.assertEqual(catalog.viewer_for(".c"), "code")

    def test_list_filters_sorts_and_search(self):
        r = self.c.get("/api/fs/list", query_string={"path": "code", "category": "code", "sort": "size", "order": "desc"}).json
        sizes = [f["size"] for f in r["files"]]
        self.assertEqual(sizes, sorted(sizes, reverse=True))
        self.assertTrue(all(f["category"] == "code" for f in r["files"]))
        r = self.c.get("/api/fs/list", query_string={"path": "code", "category": "code", "q": "hello"}).json
        self.assertEqual([f["name"] for f in r["files"]], ["hello.js"])
        r = self.c.get("/api/fs/list", query_string={"path": "code", "category": "images"}).json
        self.assertEqual(r["files"], [])

    def test_access_rules(self):
        for bad in ("/etc", "/System", "~/.ssh", str(Path.home() / ".ssh" / "id_rsa")):
            self.assertEqual(self.c.get("/api/fs/list", query_string={"path": bad}).status_code, 403, bad)
        self.assertEqual(self.c.get("/api/asset", query_string={"path": "/etc/hosts"}).status_code, 403)
        self.assertEqual(self.c.get("/api/code", query_string={"path": "../" * 12 + "etc/hosts"}).status_code, 403)

    def test_host_header_blocked(self):
        self.assertEqual(self.c.get("/", headers={"Host": "evil.example"}).status_code, 403)
        self.assertEqual(self.c.get("/", headers={"Host": "localhost:8000"}).status_code, 200)

    def test_previews(self):
        def prev(rel):
            return self.c.get("/api/fs/preview", query_string={"path": str(DATA / rel)}).json["preview"]
        self.assertEqual(prev("code/example.py")["kind"], "code")
        self.assertEqual(prev("images/sample_gradient.png")["kind"], "image")
        self.assertEqual(prev("mat/S1_A1_E1_sample.mat")["kind"], "list")
        self.assertIn("orders", prev("sql/shop.db")["items"])
        self.assertEqual(prev("pdf/sample.pdf")["kind"], "meta")

    def test_recents_favorites_forget(self):
        p = str(DATA / "code" / "example.py")
        rec = self.c.post("/api/library/open", json={"path": p}).json
        self.assertEqual((rec["category"], rec["viewer"], rec["open_count"]), ("code", "code", 1))
        self.assertEqual(self.c.post("/api/library/open", json={"path": p}).json["open_count"], 2)
        self.assertEqual([r["name"] for r in self.c.get("/api/library/recent").json], ["example.py"])
        # favouriting a never-opened file must not put it in Recent
        q = str(DATA / "json" / "sample_users.json")
        self.assertTrue(self.c.post("/api/library/favorite", json={"path": q, "value": True}).json["favorite"])
        self.assertEqual([r["name"] for r in self.c.get("/api/library/recent").json], ["example.py"])
        self.assertEqual([r["name"] for r in self.c.get("/api/library/favorites").json], ["sample_users.json"])
        self.c.post("/api/library/forget", json={})
        self.assertEqual(self.c.get("/api/library/recent").json, [])
        self.assertEqual(len(self.c.get("/api/library/favorites").json), 1)  # favourites survive

    def test_open_missing_file(self):
        r = self.c.post("/api/library/open", json={"path": str(DATA / "nope.py")})
        self.assertEqual(r.status_code, 404)
        self.assertIn("moved or deleted", r.json["error"])

    def test_summary_counts(self):
        self.c.post("/api/library/open", json={"path": str(DATA / "sql" / "shop.sql")})
        s = self.c.get("/api/library/summary").json
        cats = {c["id"]: c for c in s["categories"]}
        self.assertEqual(cats["code"]["recent"], 1)  # .sql is a Code-category file
        self.assertEqual(cats["recent"]["recent"], 1)
        self.assertEqual(len(s["categories"]), 8)
        self.assertTrue(all(c["available"] for c in cats.values()))

    def test_settings(self):
        self.assertEqual(self.c.put("/api/settings", json={"start_folder": "/definitely/not/here"}).status_code, 400)
        r = self.c.put("/api/settings", json={"start_folder": str(DATA / "code")}).json
        self.assertTrue(r["start_folder"].endswith("code"))
        self.assertTrue(self.c.get("/api/fs/list").json["path"].endswith("code"))

    def test_search_uses_recents_and_folder(self):
        names = [r["name"] for r in self.c.get("/api/library/search", query_string={"q": "shop"}).json]
        self.assertIn("shop.sql", names)
        self.assertEqual(self.c.get("/api/library/search", query_string={"q": "s"}).json, [])

    def test_native_dialog_command_and_cancel(self):
        with mock.patch("platform.system", return_value="Darwin"), mock.patch("subprocess.run") as run:
            run.return_value = mock.Mock(returncode=0, stdout="/a/b.py\n/a/c.py\n", stderr="")
            self.assertEqual(library.run_native_dialog("files", [".py", ".c"]), ["/a/b.py", "/a/c.py"])
            script = run.call_args[0][0][2]
            self.assertIn('of type {"py","c"}', script)
            self.assertIn("multiple selections allowed", script)
            run.return_value = mock.Mock(returncode=1, stdout="", stderr="execution error: User canceled. (-128)")
            self.assertEqual(library.run_native_dialog("file", []), [])

    def test_native_paths_outside_home_are_dropped(self):
        with mock.patch.object(library, "run_native_dialog", return_value=["/etc/hosts", str(DATA / "code" / "hello.js")]):
            r = self.c.post("/api/fs/native", json={"category": "code", "mode": "files"}).json
        self.assertEqual(len(r["paths"]), 1)
        self.assertEqual(r["skipped"], 1)

    def test_migrations_idempotent(self):
        store.conn()
        store.reset()
        self.assertEqual(store.conn().execute("PRAGMA user_version").fetchone()[0], len(store.MIGRATIONS))


class ViewerEndpointTests(unittest.TestCase):
    """The pre-existing viewers must keep working with absolute paths."""

    def setUp(self):
        store.reset(Path(tempfile.mkdtemp()) / "t.db")
        self.c = app.test_client()

    def test_each_viewer_endpoint(self):
        d = str(DATA)
        self.assertEqual(self.c.get("/api/json/text", query_string={"path": f"{d}/json/sample_users.json"}).status_code, 200)
        md = self.c.get("/api/md", query_string={"path": f"{d}/markdown/welcome.md"}).json
        self.assertEqual(md["dir"], f"{d}/markdown")
        self.assertEqual(self.c.get("/api/sql/script", query_string={"path": f"{d}/sql/shop.sql"}).status_code, 200)
        self.assertEqual(self.c.get("/api/db/info", query_string={"handle": f"file:{d}/sql/shop.db"}).status_code, 200)
        self.assertEqual(self.c.get("/api/code", query_string={"path": f"{d}/code/example.py"}).json["language"], "Python")
        self.assertEqual(self.c.get("/api/code", query_string={"path": f"{d}/mat/S1_A1_E1_sample.mat"}).status_code, 415)
        m = self.c.post("/api/mat/open", json={"path": f"{d}/mat/S1_A1_E1_sample.mat"}).json
        self.assertEqual(m["sheets"][0]["name"], "emg")
        self.assertEqual(self.c.get(f"/api/mat/rows/{m['id']}/emg?count=5").status_code, 200)


class Phase3Tests(unittest.TestCase):
    def setUp(self):
        store.reset(Path(tempfile.mkdtemp()) / "t.db")
        self.c = app.test_client()
        self.d = str(DATA)

    def test_pdf_is_served_with_ranges_and_vendor_files_exist(self):
        p = f"{self.d}/pdf/algorithms_notes.pdf"
        r = self.c.get("/api/asset", query_string={"path": p}, headers={"Range": "bytes=0-9"})
        self.assertEqual(r.status_code, 206)
        self.assertEqual(r.data[:5], b"%PDF-")
        for f in ("pdf.min.mjs", "pdf.worker.min.mjs"):
            self.assertEqual(self.c.get(f"/static/vendor/pdfjs/{f}").status_code, 200)
        self.assertEqual(self.c.get("/static/vendor/pdfjs/standard_fonts/FoxitFixed.pfb").status_code, 200)

    def test_docx_reader(self):
        r = self.c.get("/api/docx", query_string={"path": f"{self.d}/docs/sample_notes.docx"}).json
        self.assertEqual([t["text"] for t in r["toc"]][:2], ["Operating Systems: Process Scheduling", "1. Introduction"])
        self.assertIn("<table>", r["html"])
        self.assertNotIn("<script", r["html"])
        self.assertEqual(self.c.get("/api/docx", query_string={"path": f"{self.d}/code/example.py"}).status_code, 404)

    def test_docx_sanitises_script_and_data_links(self):
        from viewers.office_viewer import _attr_filter
        self.assertIsNone(_attr_filter("a", "href", "javascript:alert(1)"))
        self.assertIsNone(_attr_filter("a", "href", "data:text/html;base64,AAAA"))
        self.assertEqual(_attr_filter("img", "src", "data:image/png;base64,AAAA"), "data:image/png;base64,AAAA")
        self.assertIsNone(_attr_filter("img", "src", "data:text/html;base64,AAAA"))

    def test_pptx_reader(self):
        r = self.c.get("/api/pptx", query_string={"path": f"{self.d}/slides/sample_lecture.pptx"}).json
        self.assertEqual([s["title"] for s in r["slides"]], ["Data Structures", "Binary Search Tree", "Diagram"])
        self.assertEqual(r["slides"][1]["notes"], "Mention balanced vs skewed trees.")
        self.assertIn("image", [s["type"] for s in r["slides"][2]["shapes"]])

    def test_code_outline_for_several_languages(self):
        def outline(text, name):
            return [(o["kind"], o["name"]) for o in self.c.post("/api/code/highlight", json={"text": text, "name": name}).json["outline"]]
        self.assertEqual(outline("class A:\n    def f(self):\n        pass\n\ndef g():\n    pass\n", "a.py"), [("class", "A"), ("function", "f"), ("function", "g")])
        self.assertEqual(outline("function hi() {}\nconst add = (a, b) => a + b;\nclass K {}\n", "a.js"), [("function", "hi"), ("function", "add"), ("class", "K")])
        self.assertEqual(outline("func Main() {\n}\ntype S struct {\n}\n", "a.go"), [("function", "Main"), ("class", "S")])
        self.assertEqual(outline("pub fn run() {}\nstruct P {}\n", "a.rs"), [("function", "run"), ("class", "P")])
        self.assertEqual(outline("int add(int a, int b)\n{\n  return a + b;\n}\n", "a.c"), [("function", "add")])

    def test_save_requires_confirmation_and_keeps_a_backup(self):
        f = DATA / "code" / "_save_test.py"
        f.write_text("x = 1\n")
        try:
            r = self.c.post("/api/code/save", json={"path": str(f), "text": "x = 2\n"})
            self.assertEqual(r.status_code, 400)
            self.assertEqual(f.read_text(), "x = 1\n")
            r = self.c.post("/api/code/save", json={"path": str(f), "text": "x = 2\n", "confirm": True}).json
            self.assertEqual(f.read_text(), "x = 2\n")
            backup = Path(r["backup"])
            self.assertEqual(backup.read_text(), "x = 1\n")
            backup.unlink()
        finally:
            f.unlink(missing_ok=True)

    def test_save_refuses_binary_and_outside_files(self):
        r = self.c.post("/api/code/save", json={"path": f"{self.d}/mat/S1_A1_E1_sample.mat", "text": "x", "confirm": True})
        self.assertEqual(r.status_code, 415)
        r = self.c.post("/api/code/save", json={"path": "/etc/hosts", "text": "x", "confirm": True})
        self.assertEqual(r.status_code, 403)

    def test_eol_flag_and_highlight_endpoint(self):
        d = self.c.get("/api/code", query_string={"path": f"{self.d}/code/example.py"}).json
        self.assertTrue(d["eol"])
        h = self.c.post("/api/code/highlight", json={"text": "a = 1\nb = 2", "name": "x.py"}).json
        self.assertEqual(h["raw"], ["a = 1", "b = 2"])


class SecurityTests(unittest.TestCase):
    """Hardening: cross-site requests, response headers, active content and the SQL console."""

    def setUp(self):
        store.reset(Path(tempfile.mkdtemp()) / "t.db")
        self.c = app.test_client()

    def test_cross_site_writes_are_blocked_but_same_origin_works(self):
        body = {"path": str(DATA / "code" / "example.py")}
        evil = self.c.post("/api/library/open", json=body, headers={"Origin": "https://evil.example"})
        self.assertEqual(evil.status_code, 403)
        ok = self.c.post("/api/library/open", json=body, headers={"Origin": "http://localhost"})
        self.assertEqual(ok.status_code, 200)
        self.assertEqual(self.c.post("/api/library/open", json=body).status_code, 200)       # no Origin: scripts, curl
        self.assertEqual(self.c.post("/api/backup/restore", data="{}", headers={"Origin": "https://evil.example"}).status_code, 403)

    def test_security_headers(self):
        r = self.c.get("/")
        self.assertIn("default-src 'self'", r.headers["Content-Security-Policy"])
        self.assertEqual(r.headers["X-Content-Type-Options"], "nosniff")
        self.assertEqual(r.headers["Referrer-Policy"], "no-referrer")

    def test_html_and_svg_assets_are_sandboxed(self):
        for name, content in (("_t.html", "<script>alert(1)</script>"), ("_t.svg", "<svg xmlns='http://www.w3.org/2000/svg'><script>1</script></svg>")):
            f = DATA / "code" / name
            f.write_text(content)
            try:
                r = self.c.get("/api/asset", query_string={"path": str(f)})
                self.assertEqual(r.status_code, 200)
                self.assertTrue(r.headers["Content-Security-Policy"].startswith("sandbox"), name)
            finally:
                f.unlink()
        pdf = self.c.get("/api/asset", query_string={"path": str(DATA / "pdf" / "algorithms_notes.pdf")})
        self.assertNotIn("sandbox", pdf.headers.get("Content-Security-Policy", ""))          # PDFs must stay viewable

    def test_sql_console_allow_list_and_sandbox_guards(self):
        h = "file:" + str(DATA / "sql" / "shop.db")
        q = lambda sql: self.c.post("/api/db/query", json={"handle": h, "sql": sql})
        self.assertEqual(q("select count(*) from orders").status_code, 200)
        self.assertEqual(q("-- note\nWITH x AS (SELECT 1) SELECT * FROM x").status_code, 200)
        self.assertEqual(q("PRAGMA table_info(orders)").status_code, 200)
        for bad in ("VACUUM INTO '/tmp/x.db'", "DELETE FROM orders", "ATTACH '/tmp/x.db' AS x", "/* c */ vacuum"):
            self.assertEqual(q(bad).status_code, 400, bad)
        f = DATA / "sql" / "_evil.sql"
        f.write_text("CREATE TABLE t(a);\nVACUUM INTO '/tmp/should-not-exist.db';\nINSERT INTO t VALUES (1);")
        try:
            r = self.c.post("/api/sql/sandbox", json={"path": str(f)}).json
            self.assertEqual(r["ok"], 2)
            self.assertEqual(len(r["errors"]), 1)
            self.assertIn("not allowed", r["errors"][0]["error"])
            self.assertFalse(Path("/tmp/should-not-exist.db").exists())
        finally:
            f.unlink()


if __name__ == "__main__":
    unittest.main()
