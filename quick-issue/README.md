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

   Tokens are stored in `sessionStorage` by default and forgotten when the tab
   closes. *Remember on this device* is an explicit opt-in that also writes the
   token in plaintext to persistent `localStorage`; avoid it on shared/public
   machines and disconnect/rotate the token when finished. The token is never
   sent anywhere except `api.github.com`.
2. **Pick a repo** from the type-to-filter list (public/private is flagged).
3. **Fill the template** — title, severity, stage + platform + note, repro / expected / actual.
4. **Attach** images or video (drag-drop, click, or paste).
5. **Create** — `⌘/Ctrl+Enter` also submits. The new issue opens in a tab.

## Labels

With **Apply labels** ticked (default), the issue is created with `bug`,
`severity:<critical|high|medium|low>`, and `env:<production|staging|local|dev>`
— GitHub creates any of these that don't already exist in the repo, no setup
needed. The hint next to the checkbox always shows exactly which labels will
be applied as you change severity/stage. If label creation is ever rejected
(e.g. an org policy blocks new labels), the issue is retried once without
labels rather than losing the report — you'll see a note when that happens.

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

## Token security and scope

This is a client-only static page, so a token is exposed to JavaScript running
in this page and to browser extensions or other code that can inspect browser
storage. A compromised page can use the token for every repository and action
allowed by its fine-grained permissions. Use a narrowly limited repository
selection and rotate the token if you suspect exposure.

`Issues: Read and write` is required to list repositories and create issues.
`Contents: Read and write` is also required because attachments are uploaded
into `issue-attachments/` through GitHub's Contents API. The current attachment
implementation therefore cannot use an Issues-only token.

Security regression check: attach or drop a file named
`<img src=x onerror=alert(1)>.png` and confirm the filename appears as literal
text in the thumbnail; no alert or new element should be created.

## Hosting (optional)

It's a static file, so you can host it on GitHub Pages for a bookmarkable URL.
Pages on a **private** repo requires a paid GitHub plan; on a public repo it's free.
