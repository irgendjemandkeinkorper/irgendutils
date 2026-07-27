# @irgendutils/dns-ssl-uptime-monitor

Audit and monitor your entire fleet of subdomains and sites for the three things that silently break: **downtime**, **expiring SSL/TLS certificates**, and **drifted or missing DNS records**.

Optimized to run unattended on a schedule (e.g. cron), it warns you of issues before they impact users, deduplicates notifications, and renders a lightweight static status dashboard.

```
                  dns-ssl-uptime-monitor (monitor)
                    ├── uptime check
                    ├── TLS/SSL chain audit
                    ├── DNS record verification
                    └── Registrar domain-expiry check
```

## Install

Requires Node.js ≥ 18 ESM. Built on native, zero-dependency network checks.

```sh
cd dns-ssl-uptime-monitor
npm install
npm link                               # optional: `monitor` on PATH
# or just: node src/cli.js
```

## Quickstart

1. **Configure:** Copy `config.example.yml` to `config.yml` and add your targets and expected DNS mappings.
2. **Set secrets:** Create a `.env` file containing your alerting configuration (e.g., Slack webhook URLs or SMTP keys):
   ```env
   SLACK_WEBHOOK_URL=https://hooks.slack.com/services/xxxx
   ```
3. **Execute Audit:** Perform a full monitoring run over all targets:
   ```sh
   monitor run
   ```
4. **Generate Status Dashboard:** Compile and display the latest fleet status page:
   ```sh
   monitor status
   ```

## Commands

```sh
monitor run                      # execute a full pass over all targets
monitor run --checks tls,dns     # limit checks to the specified modules
monitor status                   # render and print the static status HTML path
monitor history <host>           # show uptime percentages, incidents, and certificate logs
```

Useful flags:
- `-c, --config <file>`: path to config file (default: `config.yml`)
- `--checks <list>`: comma-separated list of check modules to execute

## The Auditing Modules

The monitor carries out four lightweight, non-intrusive operations:

### 1. Uptime Check (`uptime.js`)
- Performs rapid HTTP `GET` health checks on target endpoints.
- Validates redirect chains and confirms the final response matches your `expect_status` (default: `200`).
- Triggers alerts if requests timeout or return `5xx`/`4xx` errors.

### 2. TLS/SSL Audit (`tls.js`)
- Performs a full TLS handshake with target servers.
- Calculates remaining validity days and triggers alerts at your customized `warn_days` intervals (e.g. 30, 14, 7, 1 day prior to expiration).
- Validates the **full trust chain** (detecting missing intermediate certificates) and flags hostname mismatches or weak cipher sets.

### 3. DNS Verification (`dns.js`)
- Queries multiple public resolvers (such as Google and Cloudflare) to verify record propagation.
- Compares active A, AAAA, CNAME, MX, and TXT records against your configured `expect` values.
- Flags record drift instantly, helping catch unintended registrar updates, stale DNS caches, or unauthorized alterations.

### 4. Registrar Domain Expiry (`domain.js`)
- (Optional) Leverages RDAP/WHOIS protocols to fetch top-level domain registration expiry dates.
- Warns before a domain registration lapses and falls back into the redemption period.

## Fleet Integration

For dynamic agency workflows, the monitor can automatically ingest newly provisioned sites. Set `targets_from` in `config.yml` to point to your `wp-subdomain-spinup` site list:

```yaml
# Merge manual targets with the subdomain spinup database
targets:
  - https://main-site.com
targets_from: ../wp-subdomain-spinup/sites.yml
```

## Config (`config.yml`)

```yaml
targets:
  - https://acme.example.com
  - https://beta.example.com

checks: [uptime, tls, dns]

tls:
  warn_days: [30, 14, 7, 1]
  allow_self_signed: false           # true only for staging/dev environments

dns:
  resolvers: [system, 8.8.8.8, 1.1.1.1]
  expect:
    acme.example.com: { type: A, value: 203.0.113.10 }

uptime:
  timeout_ms: 10000
  expect_status: 200

alerting:
  channels: [webhook]                # webhook | email
  dedupe_minutes: 60                 # prevent alert fatigue (no duplicate pings for 60 mins)

output_dir: out                      # status.html, results.json, and history.jsonl land here
```

## Output Dashboard & Alerting

Each pass writes status files inside `output_dir`:
- **`status.html`**: A clean, single-page CSS-styled status board displaying current uptime indicators and warning timelines for the fleet.
- **`results.json`**: Machine-readable payload of the latest run, ideal for writing custom integrations.
- **`history.jsonl`**: Append-only transaction log used to track historical trends, compute uptime percentages, and manage alerts.

### Alert Fatigue Prevention
Outages can result in hundreds of notification requests. The alerting adapter (`alerts.js`) tracks active incidents and **deduplicates alerts** based on your configured `dedupe_minutes` (e.g. 60). It will notify you when a site goes down, and when it returns to a healthy status, but remains silent in between.

## Scheduled Execution (Cron)

Set up a scheduler to trigger the monitor at different cadences:
```sh
# Uptime check (every 5 minutes)
*/5 * * * * cd /path/to/dns-ssl-uptime-monitor && node src/cli.js run --checks uptime >/dev/null 2>&1

# Full TLS/DNS Audit (once a day at midnight)
0 0 * * * cd /path/to/dns-ssl-uptime-monitor && node src/cli.js run --checks tls,dns >/dev/null 2>&1
```

## Gotchas

- **DNS Propagation Noise:** Local DNS cache TTLs can lead to temporary record mismatches. The `dns` adapter queries public name servers directly to bypass local machine cache.
- **Cloudflare Proxies:** Sites behind Cloudflare's CDN return Cloudflare IP addresses. Specify expected values as CNAMES or adjust IP configurations accordingly.
