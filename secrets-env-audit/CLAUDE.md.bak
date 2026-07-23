# CLAUDE.md — Secrets / Env Audit

## What this app does
Two jobs, one tool: (1) **scan for leaked secrets** — API keys, passwords, tokens,
private keys accidentally committed to a repo or left in web-reachable files; and
(2) **catch env drift** — `.env` keys that exist in one environment but are missing
(or differ in shape) in another, the cause of "prod is missing an API key" outages.
Read-only; it reports, it never prints the secret values themselves.

## Shared house rules
- **Stack:** small **Node/TS** (or Python) CLI. Static scanning of files + git
  history; optional live probe of a URL for exposed `.env`/config files.
- **Never echo secret values.** Findings show the file, line, and a **masked**
  match (`sk-****abcd`) plus the rule name — never the full secret. The report is
  itself sensitive; treat it as such.
- **Read-only.** No commits, no rewriting history, no deleting files — it flags and
  advises (e.g. "rotate this key, then purge from history").
- Low false-positive bias: combine high-signal regexes with entropy checks and an
  allowlist for known test/example values.

## Config
```yaml
scan:
  roots: [~/sites/acme, ~/sites/beta]
  include_git_history: true
  ignore: [node_modules, vendor, .git/objects, "*.min.js"]
  allowlist_file: .secretsallow      # known-safe/test values, hashed
rules: [aws, gcp, stripe, github_pat, private_key, generic_high_entropy, db_url, wp_salts]
web_probe:                            # optional: check for publicly reachable config
  urls: [https://acme.example.com]
  paths: [/.env, /wp-config.php.bak, /.git/config, /config.php~]
env_drift:
  envs:
    - { name: local,   file: .env }
    - { name: staging, file: .env.staging }
    - { name: prod,    file: .env.prod }
  compare: keys_and_shape             # keys only, or keys + value-shape (url/number/bool)
```

## Workflow
### Part A — secret scan
1. Walk the configured roots (respecting `ignore`), and optionally the **git
   history** (`git log -p` / a fast pack scan) — leaked secrets often live in old
   commits even after being "removed."
2. Match against the rule set: provider-specific patterns (AWS/Stripe/GitHub/…),
   private-key headers, DB connection URLs, WP salts, plus a **generic
   high-entropy** catch. Filter with the allowlist.
3. For each hit: file, line, rule, masked preview, and whether it's in the working
   tree, history, or both. Rank by confidence + blast radius.

### Part B — env drift
4. Load each environment's `.env`; compute the **key union**. Report keys present in
   some envs but missing in others, and (if `keys_and_shape`) keys whose value
   *shape* differs (e.g. a URL in staging but empty in prod). Never compare or print
   the actual secret values — only presence and shape.

### Part C — web exposure (optional)
5. Probe the configured URLs for classic exposed-file paths (`/.env`,
   `/wp-config.php.bak`, `/.git/config`). Any 200 with config-looking content is a
   high-severity finding.

6. **Report** all three parts with severity and a remediation note per finding.

## Key commands
```
secaudit scan                    # secret scan across roots (+ git history)
secaudit drift                   # env-file key/shape comparison
secaudit web-probe               # check for publicly exposed config files
secaudit run                     # all of the above
```

## Output
- `report/<timestamp>.md` (+ `.json`) — grouped by severity, masked matches only,
  remediation notes ("rotate + purge from history", "add MISSING_KEY to prod").
- Non-zero exit if any **high-severity** finding (committed live secret or exposed
  web file) is present — so it can gate CI.

## Acceptance criteria (verification step)
- A fixture repo with a planted AWS key (in both working tree and an old commit) is
  flagged in both locations, masked.
- A known test/example value in the allowlist is NOT flagged (false-positive
  control).
- Env drift correctly reports a key present in staging but missing in prod.
- The report contains **no** unmasked secret values (grep the output to prove it).
- Web-probe flags a fixture serving `/.env` and passes a site that 404s it.

## Gotchas
- Deleting a secret from the current file does NOT remove it from git history — the
  history scan is the important half; remediation is rotate-then-purge, not just
  delete.
- Entropy rules false-positive on hashes, minified JS, and lockfiles — scope and
  allowlist aggressively or people ignore the report.
- The report itself lists where secrets live — write it to a secure location, never
  commit it, and consider it need-to-know.
- `.env.example` should have keys but placeholder values — use it as the canonical
  key list for drift, and don't flag its placeholders as secrets.
