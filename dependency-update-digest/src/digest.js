// Digest assembly + rendering. Pure: takes classified rows, returns a digest
// object and a Markdown rendering. No I/O here.

import { classifyRows, SEVERITIES } from './classify.js';
import { diffNewRows } from './history.js';

export const SECTION_TITLES = {
  security: 'Security — update now',
  major: 'Major — needs testing',
  minor: 'Minor — routine',
  patch: 'Patch — routine',
};

export function assembleDigest(
  { rows, projects = [], errors = [] },
  { previous = null, only = null, groupBy = 'severity', now = new Date() } = {},
) {
  const classified = classifyRows(rows);
  const filtered = only ? classified.filter((r) => r.severity === only) : classified;

  const groups = {};
  for (const sev of SEVERITIES) {
    groups[sev] = filtered.filter((r) => r.severity === sev);
  }

  const projectNames = [...new Set([...projects, ...classified.map((r) => r.project)])];
  const perProject = {};
  for (const name of projectNames) {
    const mine = classified.filter((r) => r.project === name);
    perProject[name] = {
      total: mine.length,
      security: mine.filter((r) => r.severity === 'security').length,
      major: mine.filter((r) => r.severity === 'major').length,
      minor: mine.filter((r) => r.severity === 'minor').length,
      patch: mine.filter((r) => r.severity === 'patch').length,
      upToDate: mine.length === 0,
    };
  }

  const newSinceLastRun = previous ? diffNewRows(filtered, previous.rows) : null;

  return {
    generatedAt: now.toISOString(),
    groupBy,
    only,
    projects: projectNames,
    counts: {
      total: classified.length,
      security: classified.filter((r) => r.severity === 'security').length,
      major: classified.filter((r) => r.severity === 'major').length,
      minor: classified.filter((r) => r.severity === 'minor').length,
      patch: classified.filter((r) => r.severity === 'patch').length,
    },
    securityCount: classified.filter((r) => r.severity === 'security').length,
    groups,
    perProject,
    newSinceLastRun,
    previousRunAt: previous?.generatedAt ?? null,
    errors,
  };
}

// ---------------------------------------------------------------------------
// Markdown rendering
// ---------------------------------------------------------------------------

function fmtRow(row, { withProject = true } = {}) {
  const parts = [];
  if (withProject) parts.push(`**${row.project}**`);
  parts.push(`${row.type}:${row.package}`);
  parts.push(`${row.current ?? '?'} → ${row.latest ?? '?'}`);
  if (row.jump && row.jump !== 'none') parts.push(`(${row.jump})`);
  const adv = row.advisories?.map((a) => a.id || a.title).filter(Boolean) ?? [];
  if (adv.length) parts.push(`— ${adv.join('; ')}`);
  return `- ${parts.join(' ')}`;
}

export function renderMarkdown(digest) {
  const out = [];
  out.push('# Dependency Update Digest');
  out.push('');
  out.push(`Generated: ${digest.generatedAt}`);
  out.push(`Projects scanned: ${digest.projects.join(', ') || '(none)'}`);
  if (digest.only) out.push(`Filter: --only ${digest.only}`);
  out.push('');

  if (digest.groupBy === 'project') {
    renderByProject(digest, out);
  } else {
    renderBySeverity(digest, out);
  }

  out.push('## Per-project status');
  out.push('');
  out.push('| Project | Security | Major | Minor | Patch | Behind by |');
  out.push('|---|---:|---:|---:|---:|---:|');
  for (const [name, c] of Object.entries(digest.perProject)) {
    if (c.upToDate) {
      out.push(`| ${name} | – | – | – | – | ✅ up to date |`);
    } else {
      out.push(`| ${name} | ${c.security} | ${c.major} | ${c.minor} | ${c.patch} | ${c.total} |`);
    }
  }
  out.push('');

  out.push('## New since last run');
  out.push('');
  if (digest.newSinceLastRun === null) {
    out.push('First run — no history to compare against yet.');
  } else if (digest.newSinceLastRun.length === 0) {
    out.push(`✅ Nothing new since last run (${digest.previousRunAt}).`);
  } else {
    out.push(`${digest.newSinceLastRun.length} new item(s) since ${digest.previousRunAt}:`);
    out.push('');
    for (const row of digest.newSinceLastRun) out.push(fmtRow(row));
  }
  out.push('');

  if (digest.errors.length) {
    out.push('## Scan warnings');
    out.push('');
    for (const e of digest.errors) {
      out.push(`- ${e.project} (${e.type}): ${e.message}`);
    }
    out.push('');
  }

  return out.join('\n');
}

function renderBySeverity(digest, out) {
  const sections =
    digest.only == null
      ? [
          ['security', SECTION_TITLES.security],
          ['major', SECTION_TITLES.major],
          ['routine', 'Routine — batch when convenient'],
        ]
      : [[digest.only, SECTION_TITLES[digest.only]]];

  for (const [key, title] of sections) {
    const rows =
      key === 'routine' ? [...digest.groups.minor, ...digest.groups.patch] : digest.groups[key];
    out.push(`## ${title} (${rows.length})`);
    out.push('');
    if (rows.length === 0) {
      out.push('✅ All clear — nothing here.');
    } else {
      for (const row of rows) out.push(fmtRow(row));
    }
    out.push('');
  }
}

function renderByProject(digest, out) {
  const all = SEVERITIES.flatMap((sev) => digest.groups[sev]);
  for (const name of digest.projects) {
    const rows = all.filter((r) => r.project === name);
    out.push(`## ${name} (${rows.length})`);
    out.push('');
    if (rows.length === 0) {
      out.push('✅ Up to date.');
    } else {
      for (const row of rows) out.push(`${fmtRow(row, { withProject: false })} [${row.severity}]`);
    }
    out.push('');
  }
}
