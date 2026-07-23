# Repo Template

Interactive CLI (`create-repo` / `repo-template`) that scaffolds a new project with a
consistent directory structure and pre-built documentation. Prompts for name, type,
description, author, and privacy, then writes the tree, docs, config, and initializes git.

## Architecture map

- **Stack:** single-file Node ESM CLI (`bin: create-repo → src/create-repo.js`), no runtime
  deps — uses built-in `fs`, `path`, `child_process` (`execSync` for git init), and
  `readline` for prompts.
- **Everything is in `src/create-repo.js`:**
  - `question()` — promisified `readline` prompt; `print()` / `printHeader()` — colored output
  - `main()` — the whole flow: gather answers → create dirs → `fs.writeFileSync` each
    generated file → `git init` via `execSync` → print next steps
  - Generated files are produced from inline template strings within `main()`:
    `.gitignore`, `.env.example`, `README.md`, `SETUP.md`, `docs/ARCHITECTURE.md`,
    `docs/CONTRIBUTING.md`, `package.json`, `LICENSE`.
- **Generated tree:** `src/ tests/ docs/{ARCHITECTURE,CONTRIBUTING}.md .github/workflows/`
  plus the root docs/config files above.
- **Project types offered:** full-stack (Node/React), frontend, backend API, game dev, other.
- **Where NOT to look:** nothing generated in this repo; `README.md` is user docs.

## Deeper context lives in the vault
Curated, durable knowledge (design decisions, gotchas) lives in the monorepo Obsidian
vault under `vault/`. Open the matching note before reading source; keep transient notes
there, not in this file.

## Conventions
- **Zero runtime dependencies** — keep it built-ins only so it runs anywhere with Node ≥18.
- The generated-file content lives in inline template strings inside `main()`; edit those
  strings to change what a scaffolded project gets. Keep the set of generated files in sync
  with the "Generated Files" list in `README.md`.
- Writes into the **current working directory** — it scaffolds where it's run.

## Commands
```
create-repo          # or: repo-template  — run the interactive generator
node src/create-repo.js   # dev (npm run dev)
```
(No test suite yet — `npm test` is a placeholder.)

## Working agreement (token discipline)
- Use the map above to jump to the right part of `create-repo.js`; don't re-scan the file
  to locate a template string.
- Side investigations go to a subagent.

## Do NOT
- Don't edit this file mid-task (invalidates the prompt cache from here rightward).
- Don't add runtime dependencies — keep it single-file, built-ins only.
- Don't reformat/mass-rename outside the task's scope.
