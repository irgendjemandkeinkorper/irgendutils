# obsidian-vault-forge

Scaffold a linked, searchable **Obsidian vault** for a project from a single
`project.yml` manifest. One command turns scattered project context — brief,
stakeholders, sites, decisions, meetings, tasks — into a navigable knowledge base
that works in vanilla Obsidian and any Markdown editor.

- **Plain files only.** Markdown + YAML front-matter. No database, no plugins
  required to read the vault (Dataview is used where present, with plain-wikilink
  fallbacks).
- **Idempotent + non-clobbering.** Re-running updates scaffolding but never
  overwrites a human-edited note — changed notes are written to a `*.new.md`
  sibling and reported.
- **Never writes secrets.** The plan is scanned before any byte hits disk; the
  Credentials note holds *pointers* to a secrets manager, not values. URL
  credentials in the manifest are stripped on write.
- **Verify, don't assume.** Every run ends with the acceptance checks: valid
  front-matter, zero dangling wikilinks, zero leaked secrets.

## Install

No dependencies — Node ≥ 18.

```bash
cd obsidian-vault-forge
npm link          # optional: exposes the `vault` command
```

## Usage

```bash
# Build a vault from a manifest (vault dir is <out>/<slug>)
vault forge project.yml -o ~/Vaults

# Preview without writing
vault forge project.yml -o ~/Vaults --dry-run

# Reconcile into an existing vault — never clobbers your edits
vault forge project.yml -o ~/Vaults --update

# Add notes to an existing vault
vault add-decision acme-redesign "Use multisite" -o ~/Vaults
vault add-meeting  acme-redesign "Kickoff"       -o ~/Vaults

# Re-run the acceptance checks on a vault
vault verify acme-redesign -o ~/Vaults
```

Use `--date <ISO>` to pin the `created`/`date` stamps (handy for reproducible
output); it defaults to today.

**Exit codes:** `0` ok · `1` runtime or verification failure · `2` usage error.

## Manifest

See [`project.example.yml`](./project.example.yml). Only `name` is required; the
slug is derived from it when omitted.

```yaml
name: Acme Redesign
client: Acme Co
slug: acme-redesign
status: active
site_urls: [https://acme.example.com]
stakeholders:
  - { name: Jane Doe, role: Client PM, email: jane@acme.com }
links:
  staging: https://staging.acme.example.com
  repo: git@github.com:acme/redesign.git
tags: [wordpress, redesign]
```

> Never put credentials in the manifest. The generated **Access & Credentials**
> note records where each secret lives, not the secret itself.

## Vault structure

```
<slug>/
  00-Index.md                 # dashboard: Dataview blocks + wikilink fallbacks
  01-Brief/                   # Project Brief, Scope & Deliverables
  02-Stakeholders/            # one note per person (colliding names de-duped)
  03-Sites & Environments/    # Site Inventory, Access & Credentials (pointers)
  04-Decisions/               # ADRs via `vault add-decision`
  05-Meetings/                # meeting notes via `vault add-meeting`
  06-Tasks/Tasks.md           # Dataview-friendly checkbox list
  07-Assets & References/
  99-Templates/               # Obsidian core Templates-plugin seeds
  .vaultforge.json            # machine metadata (project context for add-*)
```

## How it fits the toolkit

The manifest is the same shape `site-migration-scraper` emits, so a scraped
site's inventory drops straight into `03-Sites & Environments/`. The vault is
meant to be the hub that links QA reports, spinup records, and Gutenberg
conversions from the other irgendutils apps.

## Development

```bash
npm test        # node --test — offline, no installs, temp-dir I/O
```

The hard parts are small, dependency-free modules: `yaml.js` (a YAML subset
parser/serializer), `frontmatter.js`, `linkcheck.js` (wikilink integrity),
`secretscan.js`, and `util.js`. `forge.js` builds a pure write-plan;
`write.js` applies it non-destructively; `verify.js` runs the acceptance checks.
