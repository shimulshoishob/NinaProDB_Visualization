"""NinaPro Study Workspace: one local web app to read, annotate and organise study files.

Run:  python main.py [START_FOLDER]     then open http://127.0.0.1:8000
"""
from flask import Flask, render_template

from catalog import ANNOTATION_CATEGORIES
from common import register_common, ws
from viewers import BLUEPRINTS

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 64 * 1024 * 1024   # also caps backup uploads
for blueprint in BLUEPRINTS:
    app.register_blueprint(blueprint)


@app.get("/")
def index():
    """The single-page application shell."""
    return render_template("index.html", ann_cats=ANNOTATION_CATEGORIES)


run = register_common(app, ws, default_port=8000)

if __name__ == "__main__":
    run()
