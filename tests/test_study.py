"""Tests for the study features: subjects, notes, planner data, practice scheduling, organisation and search."""
import os
import sqlite3
import sys
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.environ["WORKSPACE_DB"] = str(Path(tempfile.mkdtemp()) / "boot.db")

import store  # noqa: E402
import studystore as S  # noqa: E402
from main import app  # noqa: E402

DATA = ROOT / "data"
PDF = str(DATA / "pdf" / "algorithms_notes.pdf")
CODE = str(DATA / "code" / "example.py")


class StudyTests(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        store.reset(self.dir / "t.db")
        self.c = app.test_client()

    def post(self, res, **body):
        r = self.c.post(f"/api/study/{res}", json=body)
        self.assertEqual(r.status_code, 200, r.json)
        return r.json

    # ---------------------------------------------------------------- subjects
    def test_default_subjects_seeded_once_and_custom_allowed(self):
        names = [s["name"] for s in self.c.get("/api/study/subjects").json]
        self.assertEqual(len(names), 10)
        self.assertIn("Operating Systems", names)
        custom = self.post("subjects", name="Compiler Design")
        self.assertEqual(self.c.post("/api/study/subjects", json={"name": "compiler design"}).status_code, 400)   # unique, case-insensitive
        self.c.delete(f"/api/study/subjects/{custom['id']}")
        store.reset()                                                    # re-open: deleted subjects are not re-seeded
        self.assertEqual(len(self.c.get("/api/study/subjects").json), 10)

    def test_deleting_a_subject_keeps_its_items(self):
        sub = self.post("subjects", name="Temp")
        note = self.post("notes", title="n", subject_id=sub["id"])
        self.c.delete(f"/api/study/subjects/{sub['id']}")
        self.assertIsNone(self.c.get(f"/api/study/notes/{note['id']}").json["subject_id"])

    # ---------------------------------------------------------------- validation
    def test_validation_errors_are_clear(self):
        self.assertEqual(self.c.post("/api/study/todos", json={}).json["error"], "“title” is required.")
        self.assertIn("Dates must", self.c.post("/api/study/todos", json={"title": "x", "due": "tomorrow"}).json["error"])
        self.assertEqual(self.c.post("/api/study/sessions", json={"minutes": 0}).status_code, 400)
        self.assertEqual(self.c.post("/api/study/sessions", json={"minutes": 5000}).status_code, 400)
        self.assertEqual(self.c.get("/api/study/nonsense").status_code, 404)
        self.assertEqual(self.c.patch("/api/study/todos/missing", json={"done": True}).status_code, 404)

    def test_unknown_columns_are_ignored_not_executed(self):
        note = self.post("notes", title="t", **{"id": "hack", "created": 1, "evil'); DROP TABLE notes;--": "x"})
        self.assertNotEqual(note["id"], "hack")
        self.assertEqual(len(self.c.get("/api/study/notes").json), 1)

    # ---------------------------------------------------------------- notes
    def test_notes_search_tags_and_links(self):
        sub = self.c.get("/api/study/subjects").json[0]
        n = self.post("notes", title="Merge sort", body="divide and conquer", subject_id=sub["id"], tags=["Sorting", "sorting", " Exam "])
        self.assertEqual(n["tags"], ["sorting", "exam"])
        self.post("notes", title="Other", body="nothing")
        find = lambda **kw: [x["title"] for x in self.c.get("/api/study/notes", query_string=kw).json]
        self.assertEqual(find(q="conquer"), ["Merge sort"])
        self.assertEqual(find(tag="exam"), ["Merge sort"])
        self.assertEqual(find(subject=sub["id"]), ["Merge sort"])
        self.assertEqual(self.c.post(f"/api/study/notes/{n['id']}/links", json={"path": PDF, "locator": {"page": 2}}).status_code, 200)
        links = self.c.get(f"/api/study/notes/{n['id']}/links").json
        self.assertEqual((links[0]["file"]["name"], links[0]["locator"]["page"], links[0]["exists"]), ("algorithms_notes.pdf", 2, True))
        self.c.delete(f"/api/study/notes/{n['id']}/links", json={"path": PDF, "locator": {"page": 2}})
        self.assertEqual(self.c.get(f"/api/study/notes/{n['id']}/links").json, [])

    def test_send_to_notes_appends_and_fences_code(self):
        a = self.c.post("/api/study/notes/append", json={"path": PDF, "quote": "Merge sort", "where": "p. 1", "locator": {"page": 1}}).json
        b = self.c.post("/api/study/notes/append", json={"path": PDF, "quote": "Quick sort", "where": "p. 1"}).json
        self.assertEqual(a["id"], b["id"])                               # same file -> same note
        self.assertEqual(b["body"].count("> "), 2)
        c = self.c.post("/api/study/notes/append", json={"path": CODE, "quote": "def f():\n    pass", "where": "line 3", "fence": "python"}).json
        self.assertIn("```python\ndef f():\n    pass\n```", c["body"])
        self.assertEqual(c["title"], "Notes: example.py")

    # ---------------------------------------------------------------- practice
    def test_spaced_repetition_schedule(self):
        q = self.post("questions", question="Q?", answer="A")
        self.assertEqual(len(self.c.get("/api/study/practice/due").json), 1)          # new questions are due
        today = date.today()
        rev = lambda g: self.c.post(f"/api/study/questions/{q['id']}/review", json={"grade": g}).json
        r = rev("good")
        self.assertEqual((r["box"], r["due"]), (1, (today + timedelta(days=1)).isoformat()))
        self.assertEqual(self.c.get("/api/study/practice/due").json, [])             # not due again today
        self.assertEqual(rev("easy")["box"], 3)
        self.assertEqual(rev("easy")["box"], 5)                                      # boxes are capped at 5 (30 days)
        r = rev("again")
        self.assertEqual((r["box"], r["due"]), (0, today.isoformat()))               # failed: due today again
        self.assertEqual(self.c.post(f"/api/study/questions/{q['id']}/review", json={"grade": "meh"}).status_code, 400)

    # ---------------------------------------------------------------- planner
    def test_summary_progress_and_streak(self):
        today, yday = date.today(), date.today() - timedelta(days=1)
        self.post("sessions", minutes=25, day=today.isoformat())
        self.post("sessions", minutes=30, day=yday.isoformat())
        self.post("sessions", minutes=10, day=(today - timedelta(days=3)).isoformat())     # gap: not part of the streak
        s = self.c.get("/api/study/summary").json
        self.assertEqual((s["today_minutes"], s["streak"], s["total_minutes"]), (25, 2, 65))
        self.assertEqual(len(s["week"]), 7)
        self.assertEqual(s["week"][-1]["minutes"], 25)

    def test_streak_survives_an_empty_today(self):
        self.post("sessions", minutes=20, day=(date.today() - timedelta(days=1)).isoformat())
        self.assertEqual(self.c.get("/api/study/summary").json["streak"], 1)

    def test_todos_reminders_and_exam_checklist(self):
        t = self.post("todos", title="Problem set", due=date.today().isoformat(), priority=3)
        done = self.c.patch(f"/api/study/todos/{t['id']}", json={"done": True}).json
        self.assertTrue(done["done"] and done["completed_at"])
        self.assertFalse(self.c.patch(f"/api/study/todos/{t['id']}", json={"done": False}).json["completed_at"])
        r = self.post("reminders", title="Revise", due=(date.today() - timedelta(days=1)).isoformat())
        self.assertEqual(self.c.get("/api/study/summary").json["reminders_due"], 1)
        self.c.patch(f"/api/study/reminders/{r['id']}", json={"done": True})
        self.assertEqual(self.c.get("/api/study/summary").json["reminders_due"], 0)
        ex = self.post("exams", name="OS midterm", date=(date.today() + timedelta(days=4)).isoformat())
        self.post("checklist", exam_id=ex["id"], text="Past papers")
        self.assertEqual(self.c.get("/api/study/summary").json["next_exam"]["name"], "OS midterm")
        self.c.delete(f"/api/study/exams/{ex['id']}")                  # deleting an exam removes its checklist
        self.assertEqual(self.c.get("/api/study/checklist").json, [])

    def test_settings_numbers_validated(self):
        self.assertEqual(self.c.put("/api/settings", json={"pomo_focus": 0}).status_code, 400)
        self.assertEqual(self.c.put("/api/settings", json={"daily_goal_minutes": "abc"}).status_code, 400)
        self.assertEqual(self.c.put("/api/settings", json={"daily_goal_minutes": 90, "pomo_focus": 30}).json["pomo_focus"], 30)
        self.assertNotIn("subjects_seeded", self.c.get("/api/settings").json)

    # ---------------------------------------------------------------- organising files
    def test_file_subject_tags_pin_collections_and_clearing_history(self):
        sub = self.c.get("/api/study/subjects").json[3]
        col = self.post("collections", name="Exam week")
        self.c.post("/api/library/open", json={"path": PDF})
        r = self.c.put("/api/study/file", json={"path": PDF, "subject_id": sub["id"], "tags": ["Graphs", "exam"], "pinned": True, "collection": col["id"], "member": True}).json
        self.assertEqual((r["subject_id"], r["tags"], r["pinned"], r["collections"]), (sub["id"], ["graphs", "exam"], True, [col["id"]]))
        self.assertEqual([f["name"] for f in self.c.get("/api/study/files", query_string={"tag": "graphs"}).json], ["algorithms_notes.pdf"])
        self.assertEqual(len(self.c.get("/api/study/files", query_string={"subject": sub["id"]}).json), 1)
        self.assertEqual([f["name"] for f in self.c.get(f"/api/study/collections/{col['id']}/files").json], ["algorithms_notes.pdf"])
        self.assertEqual(self.c.get("/api/library/summary").json["pinned"][0]["name"], "algorithms_notes.pdf")
        self.c.post("/api/library/forget", json={})                       # clearing history keeps your organisation
        self.assertEqual(self.c.get("/api/library/recent").json, [])
        self.assertEqual(len(self.c.get("/api/study/files", query_string={"tag": "graphs"}).json), 1)
        self.assertEqual({t["tag"]: t["count"] for t in self.c.get("/api/study/tags").json}, {"graphs": 1, "exam": 1})

    def test_reminder_shows_its_file(self):
        rec = self.c.post("/api/library/open", json={"path": CODE}).json
        self.post("reminders", title="Revise example", due=date.today().isoformat(), file_id=str(rec["id"]))
        got = self.c.get("/api/study/reminders").json[0]
        self.assertEqual(got["file"]["name"], "example.py")

    # ---------------------------------------------------------------- search
    def test_unified_search(self):
        self.post("notes", title="Deadlock notes", body="four conditions")
        self.post("snippets", title="Two pointers", code="while i < j: pass")
        self.post("questions", question="What is a deadlock?", answer="circular wait")
        self.c.post("/api/annotations", json={"path": PDF, "kind": "highlight", "text": "deadlock-free ordering", "locator": {"page": 1}})
        self.c.put("/api/study/file", json={"path": CODE, "tags": ["deadlock"]})
        res = self.c.get("/api/search", query_string={"q": "deadlock"}).json
        self.assertEqual([len(res[k]) for k in ("notes", "questions", "annotations", "tagged")], [1, 1, 1, 1])
        self.assertEqual(len(self.c.get("/api/search", query_string={"q": "pointers"}).json["snippets"]), 1)
        self.assertEqual(self.c.get("/api/search", query_string={"q": "d"}).json, {})

    # ---------------------------------------------------------------- migration
    def test_upgrade_from_an_older_database_keeps_data(self):
        old = self.dir / "old.db"
        db = sqlite3.connect(old)
        for script in store.MIGRATIONS[:2]:
            db.executescript(script)
        db.execute("PRAGMA user_version=2")
        db.execute("INSERT INTO files (path,name,ext,category,size,mtime,favorite) VALUES ('/x/a.py','a.py','.py','code',1,1,1)")
        db.execute("INSERT INTO annotations VALUES ('a1',1,'highlight','general','kept','', '{\"start\":1,\"end\":1}',1,1)")
        db.commit()
        db.close()
        store.reset(old)
        self.assertEqual(store.conn().execute("PRAGMA user_version").fetchone()[0], len(store.MIGRATIONS))
        self.assertEqual(store.favorites()[0]["name"], "a.py")
        self.assertEqual(store.favorites()[0]["tags"], [])
        self.assertEqual(store.ann_get("a1")["text"], "kept")
        self.assertEqual(len(S.list_("subjects")), 10)


if __name__ == "__main__":
    unittest.main()


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        store.reset(self.dir / "a.db")
        self.c = app.test_client()

    def fill(self):
        c, sub = self.c, self.c.get("/api/study/subjects").json[0]
        n = c.post("/api/study/notes", json={"title": "N", "body": "b", "subject_id": sub["id"], "tags": ["x"]}).json
        c.post(f"/api/study/notes/{n['id']}/links", json={"path": PDF, "locator": {"page": 2}})
        c.post("/api/annotations", json={"path": PDF, "kind": "highlight", "text": "hi", "locator": {"page": 1, "rects": [[1, 2, 3, 4]]}})
        c.put("/api/study/file", json={"path": CODE, "tags": ["t1"], "pinned": True, "subject_id": sub["id"]})
        col = c.post("/api/study/collections", json={"name": "C1"}).json
        c.put("/api/study/file", json={"path": CODE, "collection": col["id"], "member": True})
        c.post("/api/study/sessions", json={"minutes": 30})
        ex = c.post("/api/study/exams", json={"name": "E", "date": "2030-01-01"}).json
        c.post("/api/study/checklist", json={"exam_id": ex["id"], "text": "item"})
        c.post("/api/study/questions", json={"question": "Q", "answer": "A"})
        rec = c.post("/api/library/open", json={"path": CODE}).json
        c.post("/api/study/reminders", json={"title": "R", "due": "2030-01-02", "file_id": str(rec["id"])})

    def test_round_trip_into_a_fresh_database_and_idempotent_merge(self):
        import json
        self.fill()
        data = self.c.get("/api/backup").json
        self.assertEqual((data["app"], data["version"]), ("NinaPro Study Workspace", 1))
        store.reset(self.dir / "b.db")                                       # a brand-new installation
        post = lambda d: self.c.post("/api/backup/restore", data=json.dumps(d), content_type="application/json")
        first = post(data).json["added"]
        self.assertEqual({k: first[k] for k in ("notes", "annotations", "collections", "exams", "questions", "reminders", "sessions")}, dict.fromkeys(("notes", "annotations", "collections", "exams", "questions", "reminders", "sessions"), 1))
        self.assertEqual(post(data).json["added"], {})                       # restoring again adds nothing
        self.assertEqual(len(self.c.get("/api/study/notes").json), 1)
        self.assertEqual(self.c.get("/api/study/files", query_string={"tag": "t1"}).json[0]["name"], "example.py")
        self.assertEqual(self.c.get("/api/study/reminders").json[0]["file"]["name"], "example.py")
        self.assertEqual(len(self.c.get("/api/annotations", query_string={"path": PDF}).json), 1)
        link = self.c.get(f"/api/study/notes/{self.c.get('/api/study/notes').json[0]['id']}/links").json
        self.assertEqual(link[0]["locator"]["page"], 2)
        self.assertEqual(len(self.c.get("/api/study/subjects").json), 10)    # subject matched by name, not duplicated

    def test_rejects_bad_files(self):
        post = lambda body: self.c.post("/api/backup/restore", data=body, content_type="application/json")
        self.assertEqual(post("not json").status_code, 400)
        self.assertEqual(post('{"app": "other"}').status_code, 400)
        self.assertIn("newer", post('{"app": "NinaPro Study Workspace", "version": 99}').json["error"])
        self.assertEqual(post('{"app": "NinaPro Study Workspace", "version": 1, "notes": [{"nope": 1}]}').status_code, 400)

    def test_backup_never_includes_file_contents(self):
        self.fill()
        text = self.c.get("/api/backup").get_data(as_text=True)
        self.assertNotIn("%PDF", text)
