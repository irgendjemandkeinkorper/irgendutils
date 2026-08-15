# @irgendutils/migration-pipeline

An end-to-end site migration pipeline orchestrator that ties together all individual utility apps into a single, unified, repeatable workflow.

It executes the migration process through 6 major stages:
1. **`scrape`**: Crawls the legacy site and extracts main body content + site manifest.
2. **`convert`**: Converts the scraped HTML pages into valid Gutenberg blocks (page-by-page).
3. **`vault`**: Scaffold an Obsidian knowledge-base vault for project documentation.
4. **`spinup`**: Provision and configure a new WordPress staging subdomain.
5. **`qa`**: Audits the provisioned staging site against visual, console, and link standards.
6. **`audit`**: Performs a launch-readiness scorecard check (SEO, performance, a11y, etc.).

```
                 site-migration-scraper (1. scrape)
                    │ clean HTML          │ manifest
                    ▼                     ▼
            html-to-gutenberg (2. convert)   obsidian-vault-forge (3. vault)
                    │ page                 ▲ links reports in
                    ▼                      │
   wp-subdomain-spinup (4. spinup) ──► wp-qa-playwright (5. qa) ──► prelaunch-auditor (6. audit) ──► LAUNCH
```

## Setup & Install

```sh
cd migration-pipeline
npm install
```

Ensure other monorepo tools are initialized:
```sh
npm install --prefix ../wp-subdomain-spinup
npm install --prefix ../html-to-gutenberg
npm install --prefix ../obsidian-vault-forge
npm install --prefix ../wp-qa-playwright
npm install --prefix ../prelaunch-auditor
```

## Running the Offline Fixture Workflow (End-to-End)

You can run the entire workflow completely offline, without browser or network dependencies, using the offline fixture configuration:

```sh
node src/cli.js run fixtures/pipeline-fixture.yml --offline
```

This runs:
- `scrape` using a mock scraper that generates mock manifest and page files.
- `convert` translating the pages offline using `html-to-gutenberg`.
- `vault` creating an Obsidian vault inside `out/offline-redesign/vaults/`.
- `spinup` executing subdomain checks in dry-run mode.
- `qa` executing visual, responsiveness, and link audits against local pre-recorded JSON captures.
- `audit` verifying readiness against clean offline scorecards.

## Pipeline Command Reference

### Unified Manifest
Configure the entire project via a single unified YAML file. Individual config files are automatically written to `out/<slug>/configs/` dynamically on each run.

### Dry Run / Plan
Preview all execution stages and understand exactly which stages would apply mutations (like provisioning or database writes):
```sh
node src/cli.js run pipeline.yml --dry-run
```

### Apply mutations
To run stateful/destructive stages (like provisioning a subdomain or pushing Gutenberg blocks to WordPress), you must pass `--apply`:
```sh
node src/cli.js run pipeline.yml --apply
```

### Resume After Failure
If any stage fails (e.g. `spinup` hits a network timeout), the pipeline halts and saves its current progress in `out/<slug>/state.json`. You can fix the problem and resume right where you left off:
```sh
node src/cli.js run pipeline.yml --resume
```

### Rerun From Stage
To force re-executing starting from a specific step (such as regenerating the vault after editing the manifest):
```sh
node src/cli.js run pipeline.yml --rerun-from-stage vault
```

### Stage Filtering
Run only a specific subset of stages:
```sh
node src/cli.js run pipeline.yml --stage scrape,convert
```

## Teardown & Recovery Guidance

Stateful operations print clear recovery steps on completion or stage failure:
- **`spinup`**: If subdomain creation fails or needs deletion, clean up the subdomain record cleanly by running:
  ```sh
  node wp-subdomain-spinup/src/cli.js teardown <subdomain> --config out/<slug>/configs/spinup.config.yml --apply
  ```
- **`convert`**: If conversion push errors, check your WordPress admin pages list (`/wp-admin/edit.php?post_type=page`) to delete any partially created draft pages.

## Log Redaction & Security
All log files generated under `out/<slug>/run.log` automatically redact any sensitive credentials matching standard environment keys (e.g. `WP_APP_PASSWORD`, `SECRET_KEY`, etc.), keeping development and audit logs clear of sensitive information.
