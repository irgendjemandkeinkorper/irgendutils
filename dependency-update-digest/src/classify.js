// Severity classification: security > major > minor > patch.
// Security floats to the top regardless of version jump size.

export const SEVERITIES = ['security', 'major', 'minor', 'patch'];

// Returns 'security' | 'major' | 'minor' | 'patch', or null when the row is
// neither behind nor vulnerable (nothing to report).
export function severityOf(row) {
  if (row.security) return 'security';
  if (row.jump === 'major') return 'major';
  if (row.jump === 'minor') return 'minor';
  if (row.jump === 'patch') return 'patch';
  if (row.jump === 'unknown') return 'minor'; // can't tell — assume it needs a look
  return null; // 'none': up to date
}

export function severityRank(sev) {
  const i = SEVERITIES.indexOf(sev);
  return i === -1 ? SEVERITIES.length : i;
}

// Keep only actionable rows, annotate each with .severity, sort most urgent first.
export function classifyRows(rows) {
  return rows
    .map((row) => ({ ...row, severity: severityOf(row) }))
    .filter((row) => row.severity !== null)
    .sort(
      (a, b) =>
        severityRank(a.severity) - severityRank(b.severity) ||
        a.project.localeCompare(b.project) ||
        a.package.localeCompare(b.package),
    );
}
