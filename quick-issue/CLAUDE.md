# Quick Issue

A single-file browser app for filing templated GitHub issues fast — environment,
severity, reproduction steps, and image/video attachments — without GitHub's heavier
issue form. No build, no server, no dependencies: open `index.html` in a browser.

## Architecture map

- **Stack:** one static file, `index.html` — inline `<style>`, HTML form, and a vanilla
  `<script>`. Talks only to `api.github.com`. State (the PAT, optionally) lives in
  `localStorage`. There is no build step and no backend.
- **Layout inside `index.html`:**
  - `<style>` (top) — all CSS.
  - Markup — `#authCard` (PAT connect / remember / disconnect), `#form` (repo picker
    `#repo`+`#repoList`, `#title`, `#sevGroup`, stage/platform/env, steps/expected/actual,
    attachments `#drop`/`#thumbs`), `#status`.
  - `<script>` (bottom) — the logic:
    - `apiHeaders()` / `ghJSON()` — authed fetch helpers against the GitHub REST API
    - `connect()` — validate PAT, show user; `loadRepos()` — populate the repo picker
    - `buildSeverity()` — severity chips; `addFiles()` / `renderThumbs()` — attachments
    - `uploadFile()` — push a file into `issue-attachments/` in the target repo
    - `buildLabels()` / `updateLabelHint()` — `bug` + `severity:<sev>` + `env:<stage>`,
      reactive to the severity/stage controls; GitHub auto-creates unseen label names
    - `buildBody()` — assemble the issue markdown; `submit()` — create the issue
    - `createIssue()` — posts with labels, retrying once *without* labels if the API
      rejects them (e.g. an org policy blocks new labels) so the report isn't lost
    - `toBase64()` — file → base64 for the Contents API
- **Where NOT to look:** nothing generated here; `README.md` is user docs.

## Deeper context lives in the vault
Curated, durable knowledge (design decisions, gotchas) lives in the monorepo Obsidian
vault under `vault/`. Open the matching note before reading source; keep transient notes
there, not in this file.

## Conventions
- **Client-only.** The PAT is never sent anywhere except `api.github.com`; only stored in
  `localStorage` when "Remember on this device" is ticked.
- Needs a fine-grained PAT with **Issues: R/W** and **Contents: R/W** (attachments upload).
- Attachments upload into an `issue-attachments/` folder in the **target repo** (GitHub's
  native drag-drop endpoint isn't in the public API). Images inline only on **public**
  repos (private raw URLs aren't publicly fetchable → rendered as links). Video always a
  link. Max 25 MB/file.
- Keep it a single self-contained file — that's the whole point; no bundler, no npm deps.

## Working agreement (token discipline)
- Use the layout map above to jump to a function; don't re-scan the whole file to locate one.
- Read the specific `<script>` region you're editing, not the entire 18 KB file each time.
- Side investigations go to a subagent.

## Do NOT
- Don't edit this file mid-task (invalidates the prompt cache from here rightward).
- Don't add a build step, framework, or external dependency — it must stay openable as a
  bare `index.html`.
- Don't send the PAT anywhere but `api.github.com`, or log it.
- Don't reformat/mass-rename outside the task's scope.
