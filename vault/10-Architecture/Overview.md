---
type: architecture
updated: 2026-07-21
---

# Architecture: irgendutils — Fleet System Overview

> **TL;DR:** Monorepo of single-purpose Node ESM CLIs that provision, QA, migrate, and monitor a WordPress site fleet. Default access path is the WP REST API + Application Passwords; idempotent and dry-run by default. Some utils feed each other.

## The shape

```mermaid
flowchart LR
  subgraph U["irgendutils · Node ESM CLIs — dry-run by default"]
    SP["subdomain-spinup"]:::client
    SCR["migration-scraper"]:::client
    H2G["html-to-gutenberg"]:::client
    QA["qa-playwright"]:::client
    MON["dns-ssl-uptime-monitor"]:::client
    MORE["+ backup-verifier · charset<br/>secrets-audit · …"]:::client
  end
  WP["WordPress fleet<br/>REST API + App Passwords"]:::external
  SSH["WP-CLI over SSH<br/>optional"]:::external
  SP -->|provision| WP
  H2G -->|push blocks| WP
  QA -->|audit| WP
  MON -->|watch cert · DNS · uptime| WP
  SCR -.->|manifest feeds| H2G
  SP -.->|new site watched by| MON
  QA -.->|if SSH present| SSH
  classDef client fill:#16324f,stroke:#4a9eff,color:#dbeafe;
  classDef server fill:#16371f,stroke:#4ade80,color:#dcfce7;
  classDef data fill:#3a2f14,stroke:#fbbf24,color:#fef3c7;
  classDef external fill:#3a1630,stroke:#f472b6,color:#fce7f3;
  classDef artifact fill:#2a2440,stroke:#a78bfa,color:#ede9fe;
  classDef planned fill:#1a1f2b,stroke:#64748b,color:#94a3b8,stroke-dasharray:4 3;
```

## Scope & surface
- **Access path:** WP REST API + **Application Passwords** by default; WP-CLI over SSH is an optional optimization (detect at startup, degrade gracefully).
- **Blast radius = the whole fleet** — every util acts on production WordPress sites. Mitigated by: idempotent, reversible, **dry-run by default** (`--apply` to mutate; teardown for every create).
- Secrets from env, never committed (`.env.example` in every app). "Verify, don't assume" — each app ships a verification step.
- Inter-app flow: `migration-scraper` → `html-to-gutenberg`; `subdomain-spinup` → monitored by `dns-ssl-uptime-monitor`.

## Where things live
Each sub-app has its **own `CLAUDE.md`** (the authoritative module-level spec). See the monorepo `CLAUDE.md` for the roster and token-cost working agreement.

## Related
- [[00-Index/Home]]
