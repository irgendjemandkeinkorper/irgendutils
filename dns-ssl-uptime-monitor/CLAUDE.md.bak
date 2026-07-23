# CLAUDE.md — DNS / SSL / Uptime Monitor

## What this app does
Watch every site/subdomain you manage for the three things that silently break and
embarrass you: an **expiring TLS cert**, a **drifted/missing DNS record**, and
**downtime**. Runs on a schedule, alerts *before* expiry, and renders a simple
status page. Designed to be the recurring-task backstop across the whole fleet.

## Shared house rules
- **Stack:** small **Node/TS** (or PHP) CLI. Read-only network checks — DNS
  lookups, a TLS handshake, and an HTTP request per target. No server access needed.
- **Built to run unattended on a schedule.** Idempotent, stateless between runs
  except for a small history file for trend/alert-dedup. Exit non-zero on any
  breach so a scheduled task surfaces it.
- **Alert before it breaks, not after.** Cert/domain expiry warns at configurable
  lead times (e.g. 30/14/7/1 days). Downtime alerts immediately but de-dupes so one
  outage isn't 100 pings.
- Pairs with the **subdomain-spinup** fleet — ideally reads the same site list so a
  newly spun-up subdomain is monitored automatically.

## Config
```yaml
targets:
  - https://acme.example.com
  - https://beta.example.com
# or: targets_from: ../wp-subdomain-spinup/sites.yml
checks: [uptime, tls, dns]
tls:
  warn_days: [30, 14, 7, 1]
dns:
  expect:                       # optional per-host expected records
    acme.example.com: { type: A, value: 203.0.113.10 }
uptime:
  timeout_ms: 10000
  expect_status: 200
  interval_hint: 5m             # actual schedule set by the scheduled task
alerting:
  channels: [email, webhook]    # wire to your notifier
  dedupe_minutes: 60
domain_expiry:
  warn_days: [60, 30, 14]       # WHOIS/RDAP registration expiry (optional)
```

## Checks
1. **Uptime / health** — HTTP GET each target; assert expected status within
   timeout. Record response time. Follow the http→https redirect and note if a site
   only serves http.
2. **TLS** — open a TLS connection, read the cert: days-to-expiry, hostname match,
   full chain valid, not self-signed on prod, not using a weak/expired protocol.
   Warn at each `warn_days` threshold.
3. **DNS** — resolve A/AAAA/CNAME (and MX/TXT if configured); compare against
   expected values. Flag drift, NXDOMAIN, or a record pointing at an old/dead IP.
   Note propagation differences across a couple of public resolvers.
4. **Domain registration expiry** (optional) — RDAP/WHOIS lookup for the registered
   domain's expiry, warned well ahead (losing the domain is worse than losing a
   cert).

## Key commands
```
monitor run                      # one pass over all targets (what the schedule calls)
monitor run --checks tls,dns
monitor status                   # render/refresh the status page from last results
monitor history <host>           # uptime %, past incidents, cert history
```

## Output
- `status.html` — one-glance fleet status: green/amber/red per site with
  days-to-cert-expiry and last-checked time. (Good candidate to persist as an
  artifact / status page.)
- `results.json` + append-only `history.jsonl` — for trends and alert de-dup.
- Alerts via configured channels on new breaches; non-zero exit when any target is
  red.

## Scheduling
Intended to be driven by a **recurring scheduled task** (e.g. every 5–15 min for
uptime, daily for TLS/DNS/domain). The app itself does one pass per invocation; the
scheduler owns the cadence. Keep a longer cadence for the expensive WHOIS/RDAP
checks.

## Acceptance criteria (verification step)
- A healthy target reports green on all checks.
- A fixture with a cert expiring in 5 days triggers the 7-day and 1-day warnings but
  not the 30-day.
- A host whose DNS doesn't match `expect` is flagged as drift.
- A down/timeout fixture produces a downtime alert and non-zero exit, and a repeated
  run within `dedupe_minutes` does NOT re-alert.

## Gotchas
- DNS caching/TTL means a change looks "not propagated" briefly — query multiple
  resolvers and treat short-lived disagreement as info, not alarm.
- Cert chains: a leaf cert can be valid while an intermediate is missing — validate
  the full chain, not just the leaf's dates.
- Proxied (Cloudflare) records return the proxy IP, not the origin — decide whether
  you're monitoring edge or origin and be explicit.
- Alert fatigue kills monitors — dedupe and escalate rather than firing every run.
