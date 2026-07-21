// Report assembly + rendering (markdown and JSON). Pure builders; only
// writeReport touches the filesystem.
import fs from 'node:fs';
import path from 'node:path';
import { formatBytes } from './wp.js';

/** Assemble the report data object. `offenders` = [{ rank, group, diag }]. */
export function buildReport({ source, totals, offenders, wpAutoload, generatedAt }) {
  return {
    tool: '@irgendutils/sql-slow-query-analyzer',
    generatedAt,
    source,
    totals,
    offenders: offenders.map(({ rank, group, diag }) => ({
      rank,
      digest: group.digest,
      normalized: group.normalized,
      stats: {
        count: group.count,
        totalMs: group.totalMs,
        meanMs: group.meanMs,
        p95Ms: group.p95Ms,
        rowsExamined: group.rowsExamined,
        rowsSent: group.rowsSent,
        examineRatio: group.examineRatio,
      },
      explain: diag.explain,
      flags: diag.flags,
      notes: diag.notes,
      suggestion: diag.suggestion,
      confidence: diag.confidence,
    })),
    wpAutoload: wpAutoload ?? { checked: false },
    disclaimer:
      'All suggestions are advisory. EXPLAIN on sampled literals can differ from the live plan. This tool never executes writes and never applies indexes — a human reviews and applies.',
  };
}

export function renderMarkdown(report) {
  const L = [];
  L.push(`# Slow Query Report — ${report.generatedAt}`);
  L.push('');
  L.push(`- Source: \`${report.source}\``);
  L.push(`- Entries parsed: ${report.totals.entries ?? 'n/a'} · digest groups: ${report.totals.groups} · shown: ${report.offenders.length}`);
  L.push('');

  const high = report.offenders.filter((o) => o.confidence === 'high confidence');
  const investigate = report.offenders.filter((o) => o.suggestion && o.confidence !== 'high confidence');
  L.push('## Suggested fixes');
  L.push('');
  L.push('**High confidence**');
  L.push(high.length ? high.map((o) => `- #${o.rank} \`${o.suggestion.ddl}\``).join('\n') : '- (none)');
  L.push('');
  L.push('**Worth investigating**');
  L.push(investigate.length ? investigate.map((o) => `- #${o.rank} \`${o.suggestion.ddl}\``).join('\n') : '- (none)');
  L.push('');

  L.push('## Offenders (ranked by total time impact)');
  for (const o of report.offenders) {
    L.push('');
    L.push(`### #${o.rank} — digest \`${o.digest}\` — ${o.stats.totalMs} ms total`);
    L.push('');
    L.push('```sql');
    L.push(o.normalized);
    L.push('```');
    L.push('');
    L.push(`| count | total ms | mean ms | p95 ms | rows examined | rows sent | examine ratio |`);
    L.push(`|---|---|---|---|---|---|---|`);
    L.push(
      `| ${o.stats.count} | ${o.stats.totalMs} | ${o.stats.meanMs} | ${o.stats.p95Ms} | ${o.stats.rowsExamined} | ${o.stats.rowsSent} | ${o.stats.examineRatio}:1 |`,
    );
    if (o.flags.length) {
      L.push('');
      L.push(`**EXPLAIN verdict:** ${o.flags.join('; ')}`);
    }
    for (const n of o.notes) L.push(`- _${n}_`);
    if (o.suggestion) {
      L.push('');
      L.push(`**Suggestion (${o.confidence}):**`);
      L.push('```sql');
      L.push(`-- RECOMMENDATION ONLY — review before applying`);
      L.push(o.suggestion.ddl);
      L.push('```');
      L.push(`_${o.suggestion.note}_`);
    }
  }

  L.push('');
  L.push('## WordPress autoload check');
  L.push('');
  if (report.wpAutoload.checked) {
    L.push(report.wpAutoload.message);
    if (report.wpAutoload.bloated && report.wpAutoload.top?.length) {
      L.push('');
      L.push('| option | size |');
      L.push('|---|---|');
      for (const t of report.wpAutoload.top) L.push(`| \`${t.name}\` | ${formatBytes(t.bytes)} |`);
    }
  } else {
    L.push(report.wpAutoload.message ?? 'Skipped.');
  }

  L.push('');
  L.push(`> ${report.disclaimer}`);
  L.push('');
  return L.join('\n');
}

/** Write <outDir>/<timestamp>.md and .json. Returns { mdPath, jsonPath }. */
export function writeReport(outDir, report) {
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = report.generatedAt.replace(/[:.]/g, '-');
  const mdPath = path.join(outDir, `${stamp}.md`);
  const jsonPath = path.join(outDir, `${stamp}.json`);
  fs.writeFileSync(mdPath, renderMarkdown(report));
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2) + '\n');
  return { mdPath, jsonPath };
}
