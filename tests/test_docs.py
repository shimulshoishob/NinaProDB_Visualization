"""Documentation checks: the API reference must list every route, and links between documents must resolve."""
import os
import re
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.environ["WORKSPACE_DB"] = str(Path(tempfile.mkdtemp()) / "docs.db")

from main import app  # noqa: E402


class DocumentationTests(unittest.TestCase):
    def test_every_route_is_documented(self):
        api = (ROOT / "docs" / "API.md").read_text()
        missing = sorted({r.rule for r in app.url_map.iter_rules() if r.endpoint != "static" and r.rule not in api})
        self.assertEqual(missing, [], f"Add these routes to docs/API.md: {missing}")

    def test_relative_markdown_links_resolve(self):
        broken = []
        for md in [ROOT / "README.md", *sorted((ROOT / "docs").glob("*.md"))]:
            text = re.sub(r"```.*?```", "", md.read_text(), flags=re.S)          # ignore code samples
            for target in re.findall(r"\]\(([^)#\s]+)(?:#[^)]*)?\)", text):
                if re.match(r"[a-z]+:", target):
                    continue
                if not (md.parent / target).exists():
                    broken.append(f"{md.name} -> {target}")
        self.assertEqual(broken, [])

    def test_documented_database_version_matches_the_code(self):
        import store
        text = (ROOT / "docs" / "DATA_MODEL.md").read_text()
        self.assertIn(f"currently **{len(store.MIGRATIONS)}** migrations", text)


if __name__ == "__main__":
    unittest.main()
