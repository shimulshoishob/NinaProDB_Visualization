"""One blueprint per viewer plus the file library; main.py registers them all on a single Flask app."""
from . import (annotations, backup, code_viewer, json_viewer, library, markdown_viewer, mat_viewer, office_viewer, sql_viewer, study)

BLUEPRINTS = [library.bp, annotations.bp, study.bp, backup.bp, mat_viewer.bp, json_viewer.bp, markdown_viewer.bp, sql_viewer.bp,
              code_viewer.bp, office_viewer.bp]
