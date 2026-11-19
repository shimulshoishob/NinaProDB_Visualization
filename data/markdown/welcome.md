# Welcome to Markdown Viewer

A **GitHub-style** preview with ~~strikethrough~~, ==highlights==, `inline code` and [links](https://example.com).

## Features

- [x] Tables
- [x] Task lists
- [ ] Your next idea

| Feature | Supported | Notes |
|---------|:---------:|-------|
| Code highlighting | ✅ | via Pygments |
| Admonitions | ✅ | see below |
| Footnotes | ✅ | at the bottom[^1] |

!!! tip "Pro tip"
    Press `[` and `]` to jump between files, `Ctrl+B` hides the sidebar.

### Code

```python
def fib(n: int) -> int:
    """Return the n-th Fibonacci number."""
    a, b = 0, 1
    for _ in range(n):
        a, b = b, a + b
    return a
```

> Blockquotes work too.

See the [second document](notes/second.md).

[^1]: Footnotes render at the end of the page.
