# CLAUDE.md — DNS / SSL / Uptime Monitor

Watch every site/subdomain in the fleet for the three things that silently break:
an **expiring TLS cert**, **drifted/missing DNS**, and **downtime**. Runs on a
schedule, alerts *before* expiry, renders a simple status page. Non-zero exit on any
breach so a scheduled task surfaces it.

## Architecture map
- **Stack:** Node ESM CLI (`node >=18`), zero-dep read-only network checks. Entry:
  `src/cli.js` (bin `monitor`; `npm start` → `monitor run`).
- **Checks:** `src/checks/uptime.js` (HTTP health + redirects), `tls.js` (handshake,
  days-to-expiry, hostname/chain), `dns.js` (A/AAAA/CNAME/MX/TXT vs expected),
  `domain.js` (RDAP/WHOIS registration expiry).
- **Support:** `src/config.js` + `src/yaml.js` (load `config.example.yml`),
  `src/alerts.js` (channels + dedupe), `src/history.js` (append-only trend/dedup),
  `src/util.js`.
- **Data flow:** load config → run selected checks per target → alerts on new
  breaches → write `status.html` + `results.json` + `history.jsonl`.
- **Where NOT to look:** `node_modules/`, generated `status.html`/`results.json`/`history.jsonl`.

## Deeper context lives in the vault
Durable cross-session knowledge (resolver quirks, alert-tuning decisions) goes in the
Obsidian vault under `vault/`. Open the matching note before reading source.

## Config (`config.example.yml`)
```yaml
targets: [https://acme.example.com]
# or: targets_from: ../wp-subdomain-spinup/sites.yml   # auto-monitor new spinups
checks: [uptime, tls, dns]
tls: { warn_days: [30, 14, 7, 1] }
dns: { expect: { acme.example.com: { type: A, value: 203.0.113.10 } } }
uptime: { timeout_ms: 10000, expect_status: 200 }
alerting: { channels: [email, webhook], dedupe_minutes: 60 }
domain_expiry: { warn_days: [60, 30, 14] }   # optional WHOIS/RDAP
```

## Key commands
```
monitor run                      # one pass over all targets (what the schedule calls)
monitor run --checks tls,dns
monitor status                   # render status page from last results
monitor history <host>           # uptime %, incidents, cert history
npm test                         # node --test
```

## Conventions / house rules
- Built to run **unattended on a schedule**; the app does one pass per invocation,
  the scheduler owns cadence (5–15 min uptime, daily TLS/DNS/domain).
- Stateless between runs except the small history file (trend + alert dedup).
- **Alert before it breaks:** warn at each `warn_days` threshold; dedupe downtime so
  one outage isn't 100 pings. Secrets from env (`.env`), never committed.
- Verify: healthy target is green; a cert-in-5-days fixture fires 7/1-day not 30-day;
  DNS not matching `expect` flags drift; down fixture alerts + exits non-zero and does
  NOT re-alert within `dedupe_minutes`.

## Gotchas
- DNS TTL/caching makes a change look "not propagated" briefly — query multiple
  resolvers; short-lived disagreement is info, not alarm.
- Validate the **full chain**, not just the leaf's dates (a missing intermediate).
- Proxied (Cloudflare) records return the proxy IP — decide edge vs origin explicitly.
- Alert fatigue kills monitors — dedupe and escalate, don't fire every run.

## Do NOT
- Don't edit this file mid-task (breaks the prompt cache). Don't mutate any target —
  every check is read-only. Don't reformat/mass-rename outside the task's scope.
