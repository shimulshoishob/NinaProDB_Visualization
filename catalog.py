"""Study categories and which viewer opens which file type (single source of truth)."""
from pathlib import Path

CODE_EXTS = [
    ".py", ".pyw", ".c", ".h", ".cpp", ".cc", ".hpp", ".java", ".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx",
    ".html", ".htm", ".css", ".scss", ".sass", ".less", ".sql", ".php", ".go", ".rs", ".kt", ".kts", ".xml",
    ".sh", ".bash", ".zsh", ".ps1", ".bat", ".cs", ".rb", ".swift", ".scala", ".r", ".jl", ".lua", ".pl",
    ".m", ".mm", ".dart", ".hs", ".clj", ".ex", ".exs", ".erl", ".vb", ".asm", ".yaml", ".yml", ".toml",
    ".ini", ".cfg", ".conf", ".gradle", ".proto", ".graphql", ".tf", ".vue", ".svelte",
]

# Order = order of the dashboard cards. "available" means a real viewer exists today.
CATEGORIES = [
    {"id": "code", "name": "Code Files", "icon": "code", "multi": True, "available": True,
     "description": "C, Python, Java, JavaScript, SQL and more", "exts": CODE_EXTS},
    {"id": "pdf", "name": "PDF Documents", "icon": "pdf", "multi": True, "available": True,
     "description": "Textbooks, papers and lecture slides", "exts": [".pdf"]},
    {"id": "text", "name": "Text Files", "icon": "text", "multi": True, "available": True,
     "description": "Plain text and Markdown notes", "exts": [".txt", ".md", ".markdown", ".mdown", ".mkd", ".log", ".rst", ".tex"]},
    {"id": "word", "name": "Word Documents", "icon": "word", "multi": True, "available": True,
     "description": "Reports and assignments (.docx opens in-app)", "exts": [".docx", ".doc", ".odt", ".rtf"]},
    {"id": "slides", "name": "Presentations", "icon": "slides", "multi": True, "available": True,
     "description": "Lecture decks (.pptx opens in-app)", "exts": [".pptx", ".ppt", ".odp", ".key"]},
    {"id": "images", "name": "Images and Diagrams", "icon": "image", "multi": True, "available": True,
     "description": "Diagrams, screenshots and figures", "exts": [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp"]},
    {"id": "data", "name": "Data Files", "icon": "data", "multi": False, "available": True,
     "description": "MAT, JSON, CSV and SQLite data", "exts": [".mat", ".json", ".jsonl", ".ndjson", ".geojson", ".csv", ".tsv", ".db", ".sqlite", ".sqlite3", ".db3"]},
]
BY_ID = {c["id"]: c for c in CATEGORIES}
EXT_CATEGORY = {e: c["id"] for c in CATEGORIES for e in c["exts"]}
ALL_EXTS = set(EXT_CATEGORY)

VIEWER_EXTS = {
    "pdf": {".pdf"},
    "docx": {".docx"},
    "pptx": {".pptx"},
    "image": {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp"},
    "mat": {".mat"},
    "json": {".json", ".jsonl", ".ndjson", ".geojson"},
    "md": {".md", ".markdown", ".mdown", ".mkd"},
    "sql": {".sql", ".db", ".sqlite", ".sqlite3", ".db3"},
}
# Formats without a built-in viewer (.doc, .odt, .rtf, .ppt, .odp, .key) are handed to the operating system.
EXTERNAL_CATEGORIES = {"word", "slides"}


def category_for(ext):
    """Study category id ("code", "pdf", ...) for a file extension, or "other"."""
    return EXT_CATEGORY.get(ext.lower(), "other")


def viewer_for(ext):
    """Name of the viewer that opens a file extension ("pdf", "code", "mat", "external", ...)."""
    ext = ext.lower()
    for name, exts in VIEWER_EXTS.items():
        if ext in exts:
            return name
    return "external" if category_for(ext) in EXTERNAL_CATEGORIES else "code"


def describe(path: Path, st=None):
    """Basic facts about a file, used by listings and the library."""
    st = st or path.stat()
    ext = path.suffix.lower()
    return {"name": path.name, "path": str(path), "ext": ext, "size": st.st_size, "mtime": st.st_mtime,
            "category": category_for(ext), "viewer": viewer_for(ext)}


# ---------------------------------------------------------------- annotations (shared by every viewer)
# One small, consistent palette: a colour always means the same thing in every viewer.
ANNOTATION_CATEGORIES = {
    "general": {"name": "General", "color": "#e3b800"},
    "definition": {"name": "Definition", "color": "#2ea043"},
    "question": {"name": "Question", "color": "#388bfd"},
    "exam": {"name": "Exam topic", "color": "#db61a2"},
    "important": {"name": "Important", "color": "#f0883e"},
    "todo": {"name": "To do", "color": "#8957e5"},
}
ANNOTATION_KINDS = {"highlight", "underline", "strikeout", "comment", "note", "bookmark", "drawing"}
