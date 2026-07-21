import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseYaml } from './yaml.js';

export const DEFAULT_CHECKS = ['uptime', 'tls', 'dns'];

// Apply defaults to a raw (parsed) config object. baseDir resolves targets_from.
export function withDefaults(raw = {}, baseDir = process.cwd()) {
  let targets = Array.isArray(raw.targets) ? raw.targets.map(String) : [];
  if (raw.targets_from) {
    targets = targets.concat(loadTargetsFrom(resolve(baseDir, String(raw.targets_from))));
  }
  targets = [...new Set(targets)];

  const domainExpiry = raw.domain_expiry
    ? {
        warn_days: raw.domain_expiry.warn_days ?? [60, 30, 14],
        domains: Array.isArray(raw.domain_expiry.domains)
          ? raw.domain_expiry.domains.map(String)
          : null,
      }
    : null;

  return {
    targets,
    checks: Array.isArray(raw.checks) ? raw.checks.map(String) : null,
    tls: {
      warn_days: raw.tls?.warn_days ?? [30, 14, 7, 1],
      allow_self_signed: raw.tls?.allow_self_signed ?? false,
    },
    dns: {
      expect: raw.dns?.expect ?? {},
      resolvers: raw.dns?.resolvers ?? ['system', '8.8.8.8', '1.1.1.1'],
    },
    uptime: {
      timeout_ms: raw.uptime?.timeout_ms ?? 10000,
      expect_status: raw.uptime?.expect_status ?? 200,
    },
    alerting: {
      channels: raw.alerting?.channels ?? [],
      dedupe_minutes: raw.alerting?.dedupe_minutes ?? 60,
    },
    domain_expiry: domainExpiry,
    output_dir: raw.output_dir ?? 'out',
  };
}

export function loadConfig(path) {
  const abs = resolve(path);
  const raw = parseYaml(readFileSync(abs, 'utf8'));
  return withDefaults(raw, dirname(abs));
}

// Read a site list from another app's YAML file. Accepts:
//   - a top-level `targets:` or `sites:` list
//   - a bare top-level list
//   - list items that are strings or objects with url/host/domain/name
export function loadTargetsFrom(file) {
  const raw = parseYaml(readFileSync(file, 'utf8'));
  const list = Array.isArray(raw) ? raw : raw?.targets ?? raw?.sites ?? [];
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const item of list) {
    if (typeof item === 'string') out.push(item);
    else if (item && typeof item === 'object') {
      const v = item.url ?? item.host ?? item.domain ?? item.name;
      if (v) out.push(String(v));
    }
  }
  return out;
}

// Which checks to run: CLI --checks wins; else config.checks; else defaults.
// The optional "domain" check is auto-enabled when domain_expiry is configured
// (unless the CLI restricted the set explicitly).
export function resolveChecks(config, cliChecks = null) {
  const known = ['uptime', 'tls', 'dns', 'domain'];
  let checks = cliChecks?.length ? cliChecks : config.checks ?? DEFAULT_CHECKS;
  checks = checks.map((c) => String(c).toLowerCase().trim()).filter((c) => known.includes(c));
  if (!cliChecks?.length && config.domain_expiry && !checks.includes('domain')) {
    checks = [...checks, 'domain'];
  }
  return checks;
}
