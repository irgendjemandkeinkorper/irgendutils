// WP hygiene check (REST-first, no SSH ever). Pure: takes WP info objects the
// adapter fetched for target and template. When the REST API / credentials are
// unavailable, degrades gracefully to a single skip note (info) — never fails
// for lack of access.
//
// wpInfo shape:
//   { restAvailable, note?, theme: {name, version}, plugins: [{name, version,
//     active, updateAvailable}], samplePages: [titles], debugOutput,
//     sitemapStatus, robotsStatus }

export function checkWpHygiene(target, template) {
  if (!target || target.restAvailable === false) {
    return [
      {
        check: 'wp_hygiene',
        severity: 'info',
        message: `WP hygiene checks skipped: ${target?.note || 'REST API not reachable or no credentials'}`,
        skipped: true,
      },
    ];
  }
  const findings = [];
  const push = (severity, message, details) =>
    findings.push({ check: 'wp_hygiene', severity, message, ...(details ? { details } : {}) });

  if (template?.theme?.name && target.theme?.name && target.theme.name !== template.theme.name) {
    push('error', `Active theme "${target.theme.name}" differs from template theme "${template.theme.name}"`, {
      theme: target.theme.name,
      expected: template.theme.name,
    });
  }

  const required = (template?.plugins || []).filter((p) => p.active !== false);
  for (const p of required) {
    const found = (target.plugins || []).find((q) => q.name === p.name);
    if (!found) {
      push('error', `Required plugin "${p.name}" is missing`, { plugin: p.name });
    } else if (found.updateAvailable || (p.version && found.version && compareVersions(found.version, p.version) < 0)) {
      push('warn', `Plugin "${p.name}" is out of date (${found.version ?? '?'} vs template ${p.version ?? '?'}${found.updateAvailable ? ', update available' : ''})`, {
        plugin: p.name,
        version: found.version,
        templateVersion: p.version,
      });
    }
  }

  if (target.debugOutput) {
    push('error', 'Debug output (WP_DEBUG notices/warnings) detected in page HTML');
  }
  for (const title of target.samplePages || []) {
    push('warn', `Default sample content still published: "${title}"`, { title });
  }
  if (target.sitemapStatus != null && target.sitemapStatus !== 200) {
    push('warn', `Sitemap not reachable (HTTP ${target.sitemapStatus})`, { status: target.sitemapStatus });
  }
  if (target.robotsStatus != null && target.robotsStatus !== 200) {
    push('warn', `robots.txt not reachable (HTTP ${target.robotsStatus})`, { status: target.robotsStatus });
  }
  return findings;
}

export function compareVersions(a, b) {
  const pa = String(a).split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}
