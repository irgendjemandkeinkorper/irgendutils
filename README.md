# adamjroder-utils

A small collection of personal browser-based utilities. Each tool is a
self-contained, single-file web app — no build step, no server, no dependencies.
Open the `index.html` in a browser and go.

## Tools

| Tool | What it does |
|------|--------------|
| [`quick-issue/`](quick-issue/) | File templated GitHub bug reports fast — environment, severity, repro, and image/video attachments, from a leaner form than GitHub's own. |

## Conventions

- **One folder per tool**, each with its own `index.html` and `README.md`.
- **Self-contained**: inline CSS/JS, no external CDNs or package installs.
- Secrets (like GitHub tokens) live only in the browser's `localStorage`;
  nothing is committed and nothing is sent anywhere except the relevant API.
