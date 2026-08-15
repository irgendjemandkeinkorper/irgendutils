# CLAUDE.md — Migration Pipeline Orchestrator

Orchestrate the site migration pipeline end-to-end: site-migration-scraper, html-to-gutenberg, obsidian-vault-forge, wp-subdomain-spinup, wp-qa-playwright, and prelaunch-auditor in one unified workflow.

## Architecture Map
- **Stack:** Node ESM CLI (`node >=18`). Entry: `src/cli.js` (bin `pipeline`).
- **Core modules:**
  - `src/yaml.js`: Minimal zero-dependency YAML parser and stringifier.
  - `src/config.js`: Parses unified manifest (`pipeline.yml`) and serializes individual configs to `out/<slug>/configs/`.
  - `src/runlog.js`: Timings, redacted run logging, and state management (`state.json`) for resuming/rerunning.
  - `src/orchestrator.js`: Orchestrates execution sequence and manages artifacts flow.

## Unified Config format
Defined as a single YAML file containing metadata and options for all stages:
```yaml
name: Acme Redesign
client: Acme Co
slug: acme-redesign
status: active
site_urls: [https://old.example.com]
scraper: { ... }
vault_forge: { ... }
subdomain_spinup: { ... }
html_to_gutenberg: { ... }
qa: { ... }
auditor: { ... }
```

## Key Commands
```sh
# Run full pipeline offline
node migration-pipeline/src/cli.js run migration-pipeline/fixtures/pipeline-fixture.yml --offline

# Run with actual mutations (requires live endpoints and --apply)
node migration-pipeline/src/cli.js run pipeline.yml --apply

# Support dry-run (lists all stages and mutations without executing)
node migration-pipeline/src/cli.js run pipeline.yml --dry-run

# Resume from first failed/pending stage
node migration-pipeline/src/cli.js run pipeline.yml --resume

# Rerun from a specific stage
node migration-pipeline/src/cli.js run pipeline.yml --rerun-from-stage spinup
```

## Conventions / House Rules
- **Dry-run by default:** Stateful stages (`spinup`, `convert --push`) require an explicit `--apply` flag to write or mutate state on the server.
- **Resumable and Idempotent:** Failed runs preserve state in `state.json`. Completed stages can be skipped upon resumption.
- **Zero secrets in logs:** Any credentials in the environment are automatically redacted from the logs.
- **Teardown & Recovery:** State failures print clear instructions on how to recover.
- **Testing:** All features checked via Node native tests.
