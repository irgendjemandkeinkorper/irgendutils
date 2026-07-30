// Renders the audit result into scorecard.json (machine-readable) and
// scorecard.html (self-contained, blockers first, each finding with its fix).
import { CATEGORIES } from './audit.js';

const SEV_LABEL = { blocker: 'BLOCKER', warning: 'Warning', info: 'Info' };

export function buildScorecardJson(run, { generatedAt } = {}) {
  return {
    tool: '@irgendutils/prelaunch-auditor',
    generatedAt: generatedAt ?? new Date().toISOString(),
    baseUrl: run.baseUrl,
    environment: run.environment,
    categories: run.categories,
    pagesAudited: run.pagesAudited,
    pass: run.pass,
    summary: run.summary,
    findings: run.findings,
  };
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function findingRow(f) {
  return `<tr class="sev-${f.severity}">
    <td class="sev">${SEV_LABEL[f.severity]}</td>
    <td class="cat">${esc(CATEGORIES[f.category]?.label ?? f.category)}</td>
    <td>
      <div class="msg">${esc(f.message)}</div>
      <div class="fix"><strong>Fix:</strong> ${esc(f.fix)}</div>
      ${f.url ? `<div class="url"><a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.url)}</a></div>` : ''}
    </td>
  </tr>`;
}

export function renderScorecardHtml(run, { generatedAt } = {}) {
  const stamp = generatedAt ?? new Date().toISOString();
  const s = run.summary;
  const verdict = run.pass ? 'READY (no blockers)' : `NOT READY (${s.blocker} blocker${s.blocker === 1 ? '' : 's'})`;
  const sorted = [...run.findings];

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Pre-launch scorecard — ${esc(run.baseUrl)}</title>
<style>
  body { font: 14px/1.5 -apple-system, Segoe UI, Roboto, sans-serif; margin: 0; padding: 2rem; background: #0b0e14; color: #e6e6e6; }
  a { color: #6cb6ff; }
  h1 { font-size: 1.3rem; margin: 0 0 0.25rem; }
  .meta { color: #9aa4b2; margin-bottom: 1.25rem; }
  .verdict { display: inline-block; padding: 0.35rem 0.9rem; border-radius: 6px; font-weight: 700; margin-bottom: 1.5rem; }
  .verdict.pass { background: #123e2a; color: #6fe3a3; }
  .verdict.fail { background: #3e1414; color: #ff8a8a; }
  .counts { margin-bottom: 1.5rem; color: #cfd6e0; }
  .counts b.blocker { color: #ff8a8a; } .counts b.warning { color: #ffd479; } .counts b.info { color: #9aa4b2; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 0.7rem 0.6rem; border-bottom: 1px solid #232a36; vertical-align: top; }
  td.sev { width: 6.5rem; font-weight: 700; white-space: nowrap; }
  td.cat { width: 8rem; color: #9aa4b2; white-space: nowrap; }
  tr.sev-blocker td.sev { color: #ff8a8a; }
  tr.sev-warning td.sev { color: #ffd479; }
  tr.sev-info td.sev { color: #9aa4b2; }
  .msg { margin-bottom: 0.25rem; }
  .fix { color: #b7c0cc; }
  .url { margin-top: 0.25rem; font-size: 0.85em; word-break: break-all; }
  footer { margin-top: 2rem; color: #6b7684; font-size: 0.85em; }
</style></head>
<body>
  <h1>Pre-launch scorecard</h1>
  <div class="meta">${esc(run.baseUrl)} &middot; environment: ${esc(run.environment)} &middot; ${esc(run.pagesAudited.length)} page(s) audited &middot; generated ${esc(stamp)}</div>
  <div class="verdict ${run.pass ? 'pass' : 'fail'}">${verdict}</div>
  <div class="counts"><b class="blocker">${s.blocker}</b> blocker(s) &middot; <b class="warning">${s.warning}</b> warning(s) &middot; <b class="info">${s.info}</b> info</div>
  <table>
    <thead><tr><td>Severity</td><td>Category</td><td>Finding</td></tr></thead>
    <tbody>${sorted.map(findingRow).join('\n')}</tbody>
  </table>
  <footer>Automated checks only — not a substitute for a manual review. @irgendutils/prelaunch-auditor</footer>
</body></html>`;
}
