// Report assembly + disk persistence. Pure builders (buildResultsJson,
// renderHtmlReport) are separated from the writer (writeReport) so they can be
// unit-tested without touching the filesystem. Screenshots are written as real
// PNGs (via png.js) and referenced relatively from index.html.

import fs from 'node:fs';
import path from 'node:path';
import { encodePng, decodePng } from './png.js';
import { severityCounts } from './runner.js';

const SEVERITY_ORDER = { error: 0, warn: 1, info: 2 };

/** Machine-readable results for CI gating. Excludes image buffers. */
export function buildResultsJson(run, { generatedAt } = {}) {
  const allFindings = run.results.flatMap((r) => r.findings);
  return {
    tool: '@irgendutils/wp-qa-playwright',
    generated_at: generatedAt ?? new Date().toISOString(),
    template_url: run.template_url ?? null,
    checks: run.checks,
    thresholds: run.thresholds,
    pass: run.pass,
    summary: {
      targets: run.results.length,
      passed: run.results.filter((r) => r.pass).length,
      failed: run.results.filter((r) => !r.pass).length,
      findings: severityCounts(allFindings),
    },
    results: run.results.map((r) => ({
      target: r.target,
      final_url: r.finalUrl,
      pass: r.pass,
      checks_run: r.checksRun,
      findings: r.findings,
      per_check: r.perCheck,
    })),
  };
}

/** Slug for a URL, safe as a directory/file name. */
export function slugifyUrl(url) {
  return String(url)
    .replace(/^https?:\/\//, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'site';
}

/**
 * Write a full report to <outDir>/<timestamp>/: screenshots, results.json,
 * index.html. Returns the report directory path.
 */
export function writeReport(run, { outDir, timestamp, generatedAt } = {}) {
  const dir = path.join(outDir, timestamp);
  fs.mkdirSync(dir, { recursive: true });

  // Write screenshots and stamp each artifact with its relative paths.
  for (const r of run.results) {
    const slug = slugifyUrl(r.target);
    for (const [vp, art] of Object.entries(r.visualArtifacts || {})) {
      const rel = path.join('screenshots', slug);
      fs.mkdirSync(path.join(dir, rel), { recursive: true });
      art.paths = {};
      for (const kind of ['target', 'reference', 'diff']) {
        const img = art[kind];
        if (!img) continue;
        const relPath = path.join(rel, `${vp}-${kind}.png`);
        fs.writeFileSync(path.join(dir, relPath), encodePng(img));
        art.paths[kind] = relPath.split(path.sep).join('/');
      }
    }
  }

  fs.writeFileSync(
    path.join(dir, 'results.json'),
    JSON.stringify(buildResultsJson(run, { generatedAt }), null, 2) + '\n',
  );
  fs.writeFileSync(path.join(dir, 'index.html'), renderHtmlReport(run, { generatedAt }));
  return dir;
}

/** Self-contained HTML report grouped by target, findings sorted by severity. */
export function renderHtmlReport(run, { generatedAt } = {}) {
  const stamp = generatedAt ?? new Date().toISOString();
  const counts = severityCounts(run.results.flatMap((r) => r.findings));
  const verdict = run.pass ? 'PASS' : 'FAIL';

  const sections = run.results.map((r) => {
    const findings = [...r.findings].sort(
      (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9),
    );
    const rows = findings.length
      ? findings
          .map(
            (f) => `<tr class="sev-${f.severity}">
      <td class="sev">${esc(f.severity)}</td>
      <td class="chk">${esc(f.check)}</td>
      <td class="msg">${esc(f.message)}</td>
    </tr>`,
          )
          .join('\n')
      : `<tr><td colspan="3" class="ok">No findings — matches the template.</td></tr>`;

    const shots = Object.entries(r.visualArtifacts || {})
      .filter(([, a]) => a.paths)
      .map(([vp, a]) => {
        const cell = (label, key) =>
          a.paths[key] ? `<figure><figcaption>${esc(label)}</figcaption><img loading="lazy" src="${esc(a.paths[key])}" alt="${esc(label)} ${esc(vp)}"></figure>` : '';
        const pct = a.diffPct == null ? '' : ` — <strong>${a.diffPct.toFixed(2)}%</strong> diff`;
        return `<div class="shots">
      <h4>Viewport ${esc(vp)}px${pct}</h4>
      <div class="shot-row">${cell(a.referenceLabel || 'reference', 'reference')}${cell('target', 'target')}${cell('diff', 'diff')}</div>
    </div>`;
      })
      .join('\n');

    return `<section class="target ${r.pass ? 'pass' : 'fail'}">
    <h2><span class="badge ${r.pass ? 'pass' : 'fail'}">${r.pass ? 'PASS' : 'FAIL'}</span> ${esc(r.target)}</h2>
    <table class="findings">
      <thead><tr><th>severity</th><th>check</th><th>message</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${shots}
  </section>`;
  }).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>WP QA report — ${verdict}</title>
<style>
  :root { color-scheme: light dark; --err:#c0392b; --warn:#b7791f; --info:#4a5568; --ok:#2f855a; }
  body { font: 15px/1.5 system-ui, sans-serif; margin: 0; padding: 2rem; max-width: 1100px; margin-inline: auto; }
  header.top { display:flex; align-items:baseline; gap:1rem; flex-wrap:wrap; border-bottom:2px solid #8884; padding-bottom:1rem; }
  h1 { margin:0; font-size:1.5rem; }
  .verdict { font-weight:700; padding:.15rem .6rem; border-radius:.35rem; color:#fff; }
  .verdict.PASS { background:var(--ok);} .verdict.FAIL { background:var(--err);}
  .meta { color:var(--info); font-size:.9rem; }
  .counts span { margin-right:1rem; }
  section.target { border:1px solid #8884; border-radius:.5rem; padding:1rem 1.25rem; margin:1.25rem 0; }
  section.target h2 { font-size:1.15rem; display:flex; align-items:center; gap:.5rem; word-break:break-all; }
  .badge { font-size:.7rem; padding:.1rem .5rem; border-radius:.3rem; color:#fff; }
  .badge.pass { background:var(--ok);} .badge.fail { background:var(--err);}
  table.findings { width:100%; border-collapse:collapse; margin:.5rem 0; }
  table.findings th, table.findings td { text-align:left; padding:.35rem .5rem; border-bottom:1px solid #8883; vertical-align:top; }
  td.sev { text-transform:uppercase; font-size:.75rem; font-weight:700; white-space:nowrap; }
  tr.sev-error td.sev { color:var(--err);} tr.sev-warn td.sev { color:var(--warn);} tr.sev-info td.sev { color:var(--info);}
  td.chk { font-family:ui-monospace,monospace; font-size:.85rem; white-space:nowrap; }
  td.ok { color:var(--ok); }
  .shots h4 { margin:.75rem 0 .25rem; font-size:.9rem; }
  .shot-row { display:flex; gap:.75rem; flex-wrap:wrap; }
  figure { margin:0; }
  figcaption { font-size:.75rem; color:var(--info); margin-bottom:.2rem; }
  .shot-row img { max-width:320px; height:auto; border:1px solid #8886; border-radius:.25rem; background:#fff; }
</style>
</head>
<body>
<header class="top">
  <h1>WP QA report</h1>
  <span class="verdict ${verdict}">${verdict}</span>
  <span class="meta">${esc(stamp)}${run.template_url ? ` · template ${esc(run.template_url)}` : ''}</span>
</header>
<p class="counts">
  <span>${run.results.length} target(s)</span>
  <span style="color:var(--err)">${counts.error} error</span>
  <span style="color:var(--warn)">${counts.warn} warn</span>
  <span style="color:var(--info)">${counts.info} info</span>
</p>
${sections}
</body>
</html>
`;
}

// ----- baseline persistence (visual regression against a stored baseline) -----

export function baselineDir(cfg, url) {
  return path.join(cfg.baseline_dir, slugifyUrl(url));
}

/** Save per-viewport screenshots as PNGs under baseline_dir/<slug>/. */
export function saveBaseline(cfg, url, screenshots) {
  const dir = baselineDir(cfg, url);
  fs.mkdirSync(dir, { recursive: true });
  const written = [];
  for (const [vp, img] of Object.entries(screenshots)) {
    const file = path.join(dir, `${vp}.png`);
    fs.writeFileSync(file, encodePng(img));
    written.push(file);
  }
  return written;
}

/** Load a stored baseline as { "<vp>": image } or null if none exists. */
export function loadBaseline(cfg, url) {
  const dir = baselineDir(cfg, url);
  let files;
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.png'));
  } catch {
    return null;
  }
  if (!files.length) return null;
  const shots = {};
  for (const f of files) shots[f.replace(/\.png$/, '')] = decodePng(fs.readFileSync(path.join(dir, f)));
  return shots;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
