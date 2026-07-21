// Conversion report assembly + console formatting.

export function buildReport({ counts, fallbacks, dropped, grammarWarnings }) {
  const blockCounts = {};
  let total = 0;
  for (const [name, n] of [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    blockCounts[name] = n;
    total += n;
  }
  return {
    totalBlocks: total,
    blockCounts,
    fallbacks,
    dropped,
    grammarWarnings,
    ok: fallbacks.length === 0 && grammarWarnings.length === 0,
  };
}

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, s) => (useColor ? `[${code}m${s}[0m` : s);
export const green = (s) => paint(32, s);
export const yellow = (s) => paint(33, s);
export const red = (s) => paint(31, s);
export const dim = (s) => paint(2, s);

export function formatReport(report) {
  const lines = [];
  lines.push(`Conversion report — ${report.totalBlocks} block(s)`);
  for (const [name, n] of Object.entries(report.blockCounts)) {
    lines.push(`  ${name.padEnd(18)} ${n}`);
  }
  if (report.fallbacks.length > 0) {
    lines.push(yellow(`core/html fallbacks: ${report.fallbacks.length}`));
    for (const f of report.fallbacks) {
      lines.push(yellow(`  ${f.node}: ${f.reason}`) + dim(` — ${f.excerpt}`));
    }
  } else {
    lines.push(green('core/html fallbacks: 0'));
  }
  if (report.dropped.length > 0) {
    lines.push(`dropped nodes: ${report.dropped.length}`);
    for (const d of report.dropped) lines.push(dim(`  ${d.node}: ${d.reason}`));
  } else {
    lines.push('dropped nodes: 0');
  }
  if (report.grammarWarnings.length > 0) {
    lines.push(red(`grammar warnings: ${report.grammarWarnings.length}`));
    for (const w of report.grammarWarnings) lines.push(red(`  ${w}`));
  } else {
    lines.push(green('grammar warnings: 0'));
  }
  return lines.join('\n');
}
