# CLAUDE.md — Obsidian Vault Forge

## What this app does
Scaffold a well-structured **Obsidian vault** for a project so all its contextual
information — brief, stakeholders, credentials pointers, decisions, meeting notes,
site inventory, links to the other IRgendutils outputs — lives in one linked,
searchable place. Turn a scattered project into a navigable knowledge base in one
command.

## Shared house rules
- **Stack:** Plain files. A small **Node/TypeScript** (or PHP) CLI that writes
  Markdown + folders. No database, no Obsidian plugins required to read the vault —
  it must be useful in vanilla Obsidian and in any Markdown editor.
- **Everything is Markdown + front-matter.** Every note starts with YAML
  front-matter (`type`, `project`, `status`, `tags`, `created`) so Dataview/search
  works. Dates are passed in or read from the system at runtime — never hardcode.
- **Wikilinks over paths.** Cross-references use `[[Note Name]]`, not file paths, so
  the graph view and backlinks work.
- **Idempotent + non-clobbering.** Re-running on an existing vault adds/updates
  scaffolding but never overwrites human-written notes. Diff and merge, or write to
  `*.new.md` and report.
- Templates live in `templates/` and are filled from a project manifest, so the
  structure is consistent across every project.

## Project manifest (input)
`project.yml`:
```yaml
name: Acme Redesign
client: Acme Co
slug: acme-redesign
status: active
site_urls: [https://acme.example.com]
stakeholders:
  - { name: Jane Doe, role: Client PM, email: jane@acme.com }
links:
  staging: https://acme.example.com
  repo: git@...
  drive: https://...
tags: [wordpress, redesign]
```

## Vault structure to generate
```
<Vault>/
  00-Index.md                 # dashboard: links to everything, Dataview queries
  01-Brief/
    Project Brief.md
    Scope & Deliverables.md
  02-Stakeholders/
    <Name>.md                 # one note per person, with role + contact
  03-Sites & Environments/
    Site Inventory.md         # URLs, hosts, DNS, WP mode (multisite/standalone)
    Access & Credentials.md   # POINTERS to a secrets manager — never secrets
  04-Decisions/
    YYYY-MM-DD <decision>.md  # lightweight ADR format
  05-Meetings/
    <date> <topic>.md         # from a meeting-note template
  06-Tasks/
    Tasks.md                  # checkbox list, Dataview-friendly
  07-Assets & References/
  99-Templates/               # Obsidian core-Templates-plugin note templates
  .obsidian/                  # optional: shipped workspace + hotkey config
```

## Workflow
1. Read `project.yml`; validate required fields.
2. Create the folder tree; write `00-Index.md` as a dashboard with Dataview blocks
   (e.g. list all decisions, open tasks, stakeholders) so it stays live as notes
   are added.
3. Generate one note per stakeholder, per site URL, and the brief/scope stubs —
   each pre-filled with front-matter and wikilinks back to the index.
4. Seed `99-Templates/` with meeting-note, decision (ADR), and task templates.
5. **Cross-app glue:** if a QA report, spinup record, or Gutenberg conversion exists
   for this project, link/copy a summary into `03-Sites & Environments/` so the
   vault is the hub for the whole toolkit.
6. Print the vault path and (optionally) open it in Obsidian via the `obsidian://`
   URI.

## Key commands
```
vault forge project.yml -o ~/Vaults/
vault forge project.yml --update            # merge into existing vault, no clobber
vault add-meeting <slug> "Kickoff"          # new meeting note from template
vault add-decision <slug> "Use multisite"   # new ADR
```

## Acceptance criteria (verification step)
- Vault opens in Obsidian with **no broken wikilinks** (run a link-check pass over
  the generated files and assert zero dangling `[[...]]`).
- Every generated note has valid YAML front-matter (parse it and assert required
  keys).
- Dataview queries in `00-Index.md` reference fields that actually exist in the
  front-matter (so they resolve, not error).
- `--update` on an existing vault leaves all human-edited notes byte-identical
  (verify with a hash before/after).
- No secret values written anywhere — grep the output for anything that looks like
  a password/token and fail if found.

## Gotchas
- Filenames with `:` `/` `#` `[` `]` break Obsidian links — sanitize titles.
- Dataview is a community plugin; keep the vault useful without it (the index also
  has plain wikilink lists as a fallback).
- Don't store real credentials in the vault — the Credentials note holds pointers
  ("in 1Password / vault X"), never the secret itself.
- Keep front-matter keys consistent across templates or cross-note queries silently
  return nothing.
