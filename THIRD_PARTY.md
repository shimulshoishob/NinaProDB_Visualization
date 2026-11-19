# Third-party software

This project builds on the open-source packages below. Licences are listed as published by each project; check the
package metadata (`pip show <package>`) before redistributing.

| Component | Used for | Licence |
|---|---|---|
| [Flask](https://flask.palletsprojects.com/) | web framework | BSD-3-Clause |
| [Pygments](https://pygments.org/) | syntax highlighting | BSD-2-Clause |
| [Markdown](https://python-markdown.github.io/) + [pymdown-extensions](https://facelessuser.github.io/pymdown-extensions/) | Markdown rendering | BSD-3-Clause / MIT |
| [nh3](https://github.com/messense/nh3) | HTML sanitising | MIT |
| [sqlparse](https://github.com/andialbrecht/sqlparse) | SQL splitting and formatting | BSD-3-Clause |
| [NumPy](https://numpy.org/), [SciPy](https://scipy.org/), [h5py](https://www.h5py.org/) | MATLAB file reading, statistics | BSD-3-Clause |
| [mammoth](https://github.com/mwilliamson/python-mammoth) | Word to HTML | BSD-2-Clause |
| [python-pptx](https://github.com/scanny/python-pptx) | PowerPoint reading | MIT |
| [pypdf](https://github.com/py-pdf/pypdf) | writing annotations into exported PDFs | BSD-3-Clause |
| [pdf.js](https://mozilla.github.io/pdf.js/) 4.10.38 (vendored in `static/vendor/pdfjs/`) | PDF rendering in the browser | Apache-2.0 (licence file included) |
| [ruff](https://docs.astral.sh/ruff/) (development only) | static analysis | MIT |

Icons in `static/js/icons.js` are simple stroke paths drawn for this project.
