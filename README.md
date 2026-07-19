# irgendutils

A small collection of personal developer utilities — browser tools and CLI tools.
Each lives in its own folder and stands on its own.

## Tools

| Tool | Kind | What it does |
|------|------|--------------|
| [`quick-issue/`](quick-issue/) | Browser (single HTML file) | File templated GitHub bug reports fast — environment, severity, repro, and image/video attachments, from a leaner form than GitHub's own. |
| [`repo-template/`](repo-template/) | Node CLI | Interactive repository generator — scaffolds a new project with consistent structure, docs, and npm scripts, then git-inits it. |

## Conventions

- **One folder per tool**, each with its own `README.md`.
- **Browser tools** are self-contained single HTML files (inline CSS/JS, no CDNs);
  open the `index.html` and go.
- **CLI tools** are runnable with Node (see each tool's README).
- Secrets (like GitHub tokens) live only where you run the tool — the browser's
  `localStorage` or your shell — never committed, never sent anywhere but the relevant API.
