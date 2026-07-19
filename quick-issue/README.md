# ⚡ Quick Issue

A barebones, single-file web app for filing templated GitHub issues fast —
environment, severity, reproduction steps, and image/video attachments, without
GitHub's heavier issue form.

## Use it

Open `index.html` in a browser (double-click, or host it — see below).

1. **Connect** — paste a GitHub **fine-grained PAT** with these repository permissions:
   - `Issues: Read and write`
   - `Contents: Read and write` — used only to upload attachments
   - `Metadata: Read` (added automatically)

   Tick *Remember on this device* to store it in `localStorage`. The token is
   never sent anywhere except `api.github.com`.
2. **Pick a repo** from the type-to-filter list (public/private is flagged).
3. **Fill the template** — title, severity, stage + platform + note, repro / expected / actual.
4. **Attach** images or video (drag-drop, click, or paste).
5. **Create** — `⌘/Ctrl+Enter` also submits. The new issue opens in a tab.

## How attachments work

GitHub's native drag-and-drop upload is a private endpoint unavailable to the
public API, so this tool uploads files into an `issue-attachments/` folder in
the **target repo** and references them:

- **Images** embed inline in the issue — but only render when the repo is
  **public** (private-repo raw URLs aren't publicly fetchable, so they appear as
  links instead; the repo picker warns you which case applies).
- **Video** always attaches as a clickable link — GitHub markdown can't inline a
  player for API-hosted files.
- Max **25 MB** per file.

## Hosting (optional)

It's a static file, so you can host it on GitHub Pages for a bookmarkable URL.
Pages on a **private** repo requires a paid GitHub plan; on a public repo it's free.
