// Markdown report rendering — pure string assembly from an analysis object.

const SEV_ORDER = { high: 0, medium: 1, low: 2 };

export function renderReport(analysis, meta = {}) {
  const lines = [];
  const ts = meta.timestamp ?? new Date().toISOString();
  lines.push('# Charset / Collation Consistency Report');
  lines.push('');
  lines.push(`- Generated: ${ts}`);
  if (meta.dbName) lines.push(`- Database: \`${meta.dbName}\``);
  lines.push(`- Target: \`${analysis.target.charset}\` / \`${analysis.target.collation}\``);
  lines.push(
    `- Scope: ${analysis.scope.type === 'all' ? 'all tables' : `tables: ${analysis.scope.tables.join(', ')}`}`
  );
  lines.push('');

  if (meta.wpWarnings?.length) {
    lines.push('## wp-config.php cross-check');
    lines.push('');
    for (const w of meta.wpWarnings) lines.push(`- WARNING: ${w}`);
    lines.push('');
  }

  if (analysis.ok) {
    lines.push('## Result: CLEAN');
    lines.push('');
    lines.push('No charset or collation mismatches found. ');
  } else {
    const c = analysis.counts;
    lines.push(
      `## Result: ${analysis.findings.length} finding(s) — ${c.high ?? 0} high / ${c.medium ?? 0} medium / ${c.low ?? 0} low`
    );
    lines.push('');
    for (const [group, findings] of analysis.byTable) {
      lines.push(`### ${group}`);
      lines.push('');
      lines.push('| Severity | Level | Object | Current | Expected | Note |');
      lines.push('|---|---|---|---|---|---|');
      const sorted = [...findings].sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);
      for (const f of sorted) {
        const cur = [f.current?.charset, f.current?.collation].filter(Boolean).join(' / ');
        const exp = [f.expected?.charset, f.expected?.collation].filter(Boolean).join(' / ');
        lines.push(
          `| ${f.severity.toUpperCase()} | ${f.level} | \`${f.object}\` | ${cur || '-'} | ${exp || '-'} | ${f.message} |`
        );
      }
      lines.push('');
    }
  }

  if (analysis.indexWarnings.length) {
    lines.push('## Index length warnings');
    lines.push('');
    for (const w of analysis.indexWarnings) lines.push(`- WARNING: ${w.message}`);
    lines.push('');
  }

  lines.push('## Connection charset');
  lines.push('');
  const connFindings = analysis.findings.filter((f) => f.level === 'connection');
  if (connFindings.length === 0) {
    lines.push(`Connection variables match \`${analysis.target.charset}\`.`);
  } else {
    for (const f of connFindings) lines.push(`- HIGH: ${f.message}`);
  }
  lines.push('');
  return lines.join('\n');
}
