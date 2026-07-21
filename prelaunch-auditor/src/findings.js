// Finding model shared by all check modules.
// Every finding has a severity (blocker | warning | info) and an actionable fix.

export const SEVERITIES = ['blocker', 'warning', 'info'];
export const CATEGORY_ORDER = ['seo', 'a11y', 'perf', 'security', 'content', 'analytics'];

export function finding(category, id, severity, message, fix, url = null) {
  if (!SEVERITIES.includes(severity)) {
    throw new Error(`invalid severity: ${severity}`);
  }
  return { category, id, severity, message, fix, url };
}

const sevRank = (s) => SEVERITIES.indexOf(s);
const catRank = (c) => {
  const i = CATEGORY_ORDER.indexOf(c);
  return i === -1 ? CATEGORY_ORDER.length : i;
};

// Deterministic ordering: blockers first, then by category, id, url, message.
export function sortFindings(findings) {
  return [...findings].sort((a, b) =>
    sevRank(a.severity) - sevRank(b.severity) ||
    catRank(a.category) - catRank(b.category) ||
    a.id.localeCompare(b.id) ||
    String(a.url ?? '').localeCompare(String(b.url ?? '')) ||
    a.message.localeCompare(b.message)
  );
}

export function summarize(findings) {
  const summary = { blocker: 0, warning: 0, info: 0, byCategory: {} };
  for (const f of findings) {
    summary[f.severity] += 1;
    const cat = (summary.byCategory[f.category] ??= { blocker: 0, warning: 0, info: 0 });
    cat[f.severity] += 1;
  }
  return summary;
}
