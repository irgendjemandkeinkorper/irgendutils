// Report assembly: markdown + JSON, grouped by severity, masked matches
// only. The report itself is sensitive (it says WHERE secrets live) —
// write it somewhere private and never commit it.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SEVERITY_RANK } from './rules.js';

const ORDER = ['high', 'medium', 'low', 'info'];

export function hasHighSeverity(findings) {
  return findings.some((f) => f.severity === 'high');
}

export function countBySeverity(findings) {
  const counts = { high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  return counts;
}

function findingLine(f) {
  const where =
    f.part === 'scan'
      ? `\`${f.file}:${f.line}\` (${f.location}${f.commit ? `, commit ${f.commit}` : ''})`
      : f.part === 'web_probe'
        ? `\`${f.url}\``
        : `key \`${f.key}\``;
  return [
    `- **[${f.rule}]** ${where}`,
    `  - match: \`${f.masked}\``,
    ...(f.fingerprint ? [`  - fingerprint (sha256, for allowlisting): \`${f.fingerprint}\``] : []),
    `  - fix: ${f.remediation}`,
  ].join('\n');
}

export function buildMarkdown(findings, { generatedAt, warnings = [] } = {}) {
  const counts = countBySeverity(findings);
  const lines = [
    '# secaudit report',
    '',
    `Generated: ${generatedAt}`,
    '',
    '> This report is sensitive: it lists where secrets live. Do not commit it.',
    '',
    `Summary: ${counts.high} high / ${counts.medium} medium / ${counts.low} low / ${counts.info} info`,
    '',
  ];
  for (const sev of ORDER) {
    const group = findings.filter((f) => f.severity === sev);
    if (group.length === 0) continue;
    lines.push(`## ${sev.toUpperCase()} (${group.length})`, '');
    for (const f of group) lines.push(findingLine(f), '');
  }
  if (findings.length === 0) lines.push('No findings. Clean.', '');
  if (warnings.length > 0) {
    lines.push('## Warnings', '');
    for (const w of warnings) lines.push(`- ${w}`);
    lines.push('');
  }
  return lines.join('\n');
}

export function buildJSON(findings, { generatedAt, warnings = [] } = {}) {
  const sorted = [...findings].sort(
    (a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0)
  );
  return { generatedAt, counts: countBySeverity(findings), findings: sorted, warnings };
}

export function writeReport(findings, { outDir, timestamp = new Date(), warnings = [] } = {}) {
  const generatedAt = timestamp.toISOString();
  const stamp = generatedAt.replace(/[:.]/g, '-');
  mkdirSync(outDir, { recursive: true });
  const mdPath = join(outDir, `${stamp}.md`);
  const jsonPath = join(outDir, `${stamp}.json`);
  writeFileSync(mdPath, buildMarkdown(findings, { generatedAt, warnings }));
  writeFileSync(jsonPath, JSON.stringify(buildJSON(findings, { generatedAt, warnings }), null, 2) + '\n');
  return { mdPath, jsonPath };
}
