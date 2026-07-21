// Normalizers: turn the captured JSON of the native ecosystem tools
// (composer outdated/audit, npm outdated/audit, wp plugin list) into ONE
// row shape:
//   { project, type, package, current, latest, jump, security, advisories }
// where jump = 'major' | 'minor' | 'patch' | 'none' | 'unknown' and
// advisories = [{ source, id, title, severity }].
// Pure functions — no shelling, no I/O.

import { diffType, compareVersions } from './semver.js';

function makeRow(project, type, pkg, current, latest) {
  return {
    project,
    type,
    package: pkg,
    current: current ?? null,
    latest: latest ?? null,
    jump: diffType(current, latest),
    security: false,
    advisories: [],
  };
}

function attachAdvisory(row, advisory) {
  row.security = true;
  row.advisories.push(advisory);
}

// ---------------------------------------------------------------------------
// Composer
// `composer outdated --direct --format=json` -> { installed: [{ name, version, latest, ... }] }
// `composer audit --format=json`             -> { advisories: { "vendor/pkg": [{...}] } }
// ---------------------------------------------------------------------------
export function normalizeComposer(project, outdatedJson, auditJson) {
  const rows = new Map();
  for (const item of outdatedJson?.installed ?? []) {
    if (!item?.name) continue;
    rows.set(item.name, makeRow(project, 'composer', item.name, item.version, item.latest));
  }
  const advisories = auditJson?.advisories ?? {};
  for (const [pkg, list] of Object.entries(advisories)) {
    const entries = Array.isArray(list) ? list : Object.values(list ?? {});
    let row = rows.get(pkg);
    if (!row) {
      // Vulnerable but not (or no longer) listed as outdated — still surface it.
      row = makeRow(project, 'composer', pkg, null, null);
      rows.set(pkg, row);
    }
    for (const a of entries) {
      attachAdvisory(row, {
        source: 'composer-audit',
        id: a.cve || a.advisoryId || null,
        title: a.title || 'Security advisory',
        severity: a.severity || 'unknown',
      });
    }
  }
  return [...rows.values()];
}

// ---------------------------------------------------------------------------
// npm
// `npm outdated --json` -> { "pkg": { current, wanted, latest, ... } }
//   (value can be an array when a package is installed in several places)
// `npm audit --json` (v7+) -> { vulnerabilities: { pkg: { severity, via: [...], isDirect } } }
// ---------------------------------------------------------------------------
export function normalizeNpm(project, outdatedJson, auditJson, { deep = false } = {}) {
  const rows = new Map();
  for (const [pkg, value] of Object.entries(outdatedJson ?? {})) {
    const info = Array.isArray(value) ? value[0] : value;
    if (!info) continue;
    rows.set(pkg, makeRow(project, 'npm', pkg, info.current, info.latest));
  }
  const vulns = auditJson?.vulnerabilities ?? {};
  for (const [pkg, v] of Object.entries(vulns)) {
    if (!deep && v.isDirect === false && !rows.has(pkg)) continue; // keep the digest actionable
    let row = rows.get(pkg);
    if (!row) {
      row = makeRow(project, 'npm', pkg, null, null);
      rows.set(pkg, row);
    }
    const vias = (Array.isArray(v.via) ? v.via : []).filter((x) => typeof x === 'object');
    if (vias.length === 0) {
      attachAdvisory(row, {
        source: 'npm-audit',
        id: null,
        title: `Known vulnerability in ${pkg}`,
        severity: v.severity || 'unknown',
      });
    }
    for (const via of vias) {
      attachAdvisory(row, {
        source: 'npm-audit',
        id: via.url || (via.source != null ? String(via.source) : null),
        title: via.title || `Known vulnerability in ${pkg}`,
        severity: via.severity || v.severity || 'unknown',
      });
    }
  }
  return [...rows.values()];
}

// ---------------------------------------------------------------------------
// WordPress
// `wp plugin list --update=available --format=json`
//   -> [{ name, status, update, version, update_version }]
// Vulnerability feed (wpvulndb-style, optional):
//   [{ slug, title, affected_below, id?, severity? }]
// Update availability alone is NOT marked as security — only a matching
// advisory sets the flag (don't cry wolf).
// ---------------------------------------------------------------------------
export function normalizeWp(project, pluginListJson, vulnFeed = []) {
  const rows = new Map();
  for (const item of pluginListJson ?? []) {
    if (!item?.name) continue;
    const latest = item.update_version || item.latest || null;
    rows.set(item.name, makeRow(project, 'wp', item.name, item.version, latest));
  }
  for (const vuln of vulnFeed ?? []) {
    const slug = vuln.slug || vuln.plugin || vuln.name;
    if (!slug) continue;
    const row = rows.get(slug);
    if (!row) continue; // advisory for a plugin not installed/outdated here
    const affected =
      vuln.affected_below == null ||
      row.current == null ||
      compareVersions(row.current, vuln.affected_below) < 0;
    if (!affected) continue;
    attachAdvisory(row, {
      source: 'wpvulndb',
      id: vuln.id || vuln.cve || null,
      title: vuln.title || `Known vulnerability in ${slug}`,
      severity: vuln.severity || 'unknown',
    });
  }
  return [...rows.values()];
}
