# Secrets / Env Audit

Node CLI (`secaudit`), two jobs one tool: (1) scan for leaked secrets — keys, passwords,
tokens, private keys committed to a repo or left in web-reachable files; (2) catch env
drift — `.env` keys present in one environment but missing/differently-shaped in another.
Read-only; it reports, and never prints the secret values themselves.

## Architecture map

- **Stack:** Node ESM CLI (`bin: secaudit → src/cli.js`). Static scan of files + git
  history; optional live probe of a URL for exposed config files.
- **Parts / data flow:**
  - **A — secret scan:** `scan.js` walks configured roots (respecting `ignore`) and git
    history via `adapters/git.js`, matches `rules.js` patterns + entropy, filters an
    allowlist, masks hits via `mask.js`.
  - **B — env drift:** `drift.js` loads each env's `.env` (`envfile.js`), computes the key
    union, reports missing keys and (optionally) value-*shape* differences — never values.
  - **C — web exposure:** `webprobe.js` probes URLs for classic exposed paths (`/.env`,
    `/wp-config.php.bak`, `/.git/config`) via `adapters/http.js`.
  - `report.js` emits all three grouped by severity, masked, with remediation notes.
- **Core modules:** `src/cli.js`, `src/scan.js`, `src/drift.js`, `src/webprobe.js`,
  `src/rules.js` (provider + high-entropy patterns), `src/mask.js`, `src/envfile.js`,
  `src/report.js`, `src/adapters/git.js`, `src/adapters/http.js`, `src/yaml.js`.
- **Config:** YAML — `scan{roots,include_git_history,ignore,allowlist_file}`, `rules[]`,
  `web_probe{urls,paths}`, `env_drift{envs[],compare}`. See `config.example.yml`, `.env.example`.
- **Where NOT to look:** `fixtures/`, `test/`.

## Deeper context lives in the vault
Curated, durable knowledge (design decisions, gotchas) lives in the monorepo Obsidian
vault under `vault/`. Open the matching note before reading source; keep transient notes
there, not in this file.

## Conventions
- **Never echo secret values** — findings show file, line, rule name, and a **masked**
  match (`sk-****abcd`). The report is itself sensitive — treat it as need-to-know.
- **Read-only** — no commits, no history rewrite, no deletes; it flags and advises.
- Low false-positive bias: high-signal regexes + entropy + allowlist for known test values.
- The **git-history scan is the important half** — deleting a secret from the current file
  does NOT remove it from history; remediation is rotate-then-purge, not just delete.
- Use `.env.example` (keys, placeholder values) as the canonical key list for drift; don't
  flag its placeholders as secrets.

## Commands
```
secaudit scan                    # secret scan across roots (+ git history)
secaudit drift                   # env-file key/shape comparison
secaudit web-probe               # check for publicly exposed config files
secaudit run                     # all of the above
node --test                      # tests
```
Output: `report/<timestamp>.md` (+ `.json`), masked matches only, remediation notes.
Non-zero exit on any high-severity finding (committed live secret or exposed web file).

## Working agreement (token discipline)
- Use this map before grepping `src/`. When I name a module, start there.
- Prefer signatures over full bodies for supporting modules; read a whole file only when
  editing it. Side investigations go to a subagent.

## Do NOT
- Don't edit this file mid-task (invalidates the prompt cache from here rightward).
- **Never write an unmasked secret** anywhere, including into the report — grep the output
  to prove it. Never commit the report.
- Don't let entropy rules run wild on hashes/minified JS/lockfiles — scope and allowlist
  aggressively or people ignore the report.
- Don't reformat/mass-rename outside the task's scope.
