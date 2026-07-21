# Obsidian Vault Forge

Node CLI that scaffolds a well-structured Obsidian vault for a project so all its
context — brief, stakeholders, credential *pointers*, decisions, meetings, site
inventory, links to other irgendutils outputs — lives in one linked, searchable place.

## Architecture map

- **Stack:** plain Node ESM (`type: module` per monorepo), no deps, no DB. Output is
  Markdown + folders, useful in vanilla Obsidian and any Markdown editor.
- **Entry / data flow:** `manifest.js` (parse+validate `project.yml`) → `forge.js`
  `buildPlan()` returns a pure data plan `{vaultName, dirs, files:[{path,content,overwrite}]}`
  → `secretscan.js` scans the plan → `write.js` diffs + writes (non-clobbering). A plan
  is scanned/diffed before a single byte hits disk.
- **Core modules:**
  - `src/forge.js` — builds the write-plan from a normalized manifest
  - `src/templates.js` — note renderers (index, brief, scope, stakeholder, site inventory, credentials, tasks, seed templates)
  - `src/frontmatter.js` — YAML front-matter note assembly (`makeNote`)
  - `src/manifest.js` — load + validate `project.yml`
  - `src/write.js` — idempotent, non-clobbering writer (diff/merge or `*.new.md`)
  - `src/verify.js` / `src/linkcheck.js` — acceptance: no dangling `[[wikilinks]]`, valid front-matter
  - `src/secretscan.js` — fails the plan if any value looks like a secret
  - `src/yaml.js`, `src/util.js` (`sanitizeTitle`, `todayISO`)
- **Where NOT to look:** `fixtures/`, `test/`, `templates/` (data, not logic).

## Vault structure it generates
`00-Index.md` (Dataview dashboard) · `01-Brief/` · `02-Stakeholders/<Name>.md` ·
`03-Sites & Environments/` (Site Inventory, Access & Credentials = *pointers only*) ·
`04-Decisions/` (ADRs) · `05-Meetings/` · `06-Tasks/` · `07-Assets & References/` ·
`99-Templates/`. Input manifest is `project.yml` (name, client, slug, status, site_urls,
stakeholders[], links, tags).

## Deeper context lives in the vault
Curated, durable knowledge (design decisions, gotchas) lives in the monorepo Obsidian
vault under `vault/`. Open the matching note before reading source; keep transient notes
there, not in this file.

## Conventions
- **Everything is Markdown + YAML front-matter** (`type`, `project`, `status`, `tags`,
  `created`) so Dataview/search works. Dates read at runtime — never hardcode.
- **Wikilinks over paths** — `[[Note Name]]`, so graph view and backlinks work.
- **Idempotent + non-clobbering** — re-running never overwrites human-written notes;
  diff/merge or write `*.new.md` and report.
- Keep front-matter keys consistent across templates, or cross-note queries silently
  return nothing.
- Vault must stay useful *without* Dataview (plain wikilink lists as fallback).

## Commands
```
vault forge project.yml -o ~/Vaults/          # scaffold
vault forge project.yml --update              # merge into existing, no clobber
vault add-meeting <slug> "Kickoff"            # meeting note from template
vault add-decision <slug> "Use multisite"     # new ADR
node --test                                   # tests
```

## Working agreement (token discipline)
- Use this map before grepping `src/`. When I name a module, start there.
- A note earns its place only if reading it is cheaper than re-deriving from source.
- Prefer signatures over full bodies for supporting modules; read a whole file only
  when editing it. Side investigations go to a subagent.

## Do NOT
- Don't edit this file mid-task (invalidates the prompt cache from here rightward).
- **Never write real credential values** into a vault — the Credentials note holds
  pointers ("in 1Password / vault X") only; `secretscan.js` must fail on secrets.
- Don't emit filenames with `:` `/` `#` `[` `]` — they break Obsidian links; sanitize titles.
- Don't reformat/mass-rename outside the task's scope.
