import fs from 'node:fs';
import path from 'node:path';

/**
 * Generates a deterministic key for a finding to use in comparisons.
 */
export function getFindingKey(finding) {
  const relPath = finding.relativePath || '/';
  const type = finding.type || 'unknown';
  return `${relPath}:${type}`;
}

/**
 * Computes deterministic snapshot comparison between current and previous findings.
 */
export function compareSnapshots(currentFindings, previousFindings) {
  const currentMap = new Map();
  for (const f of currentFindings) {
    currentMap.set(getFindingKey(f), f);
  }

  const previousMap = new Map();
  for (const f of previousFindings) {
    previousMap.set(getFindingKey(f), f);
  }

  const newFindings = [];
  const unchangedFindings = [];
  const resolvedFindings = [];

  // Identify new and unchanged
  for (const [key, f] of currentMap.entries()) {
    if (previousMap.has(key)) {
      unchangedFindings.push(f);
    } else {
      newFindings.push(f);
    }
  }

  // Identify resolved
  for (const [key, f] of previousMap.entries()) {
    if (!currentMap.has(key)) {
      resolvedFindings.push(f);
    }
  }

  return {
    newFindings,
    unchangedFindings,
    resolvedFindings,
  };
}

/**
 * Renders HTML report dashboard
 */
export function renderHtmlReport(analysis, compareResult = null) {
  const { summary, pages } = analysis;

  let compareHtml = '';
  if (compareResult) {
    const { newFindings, resolvedFindings, unchangedFindings } = compareResult;
    compareHtml = `
      <div class="card compare-card">
        <h2>Snapshot Comparison Results</h2>
        <div class="compare-grid">
          <div class="compare-stat new">
            <span class="count">${newFindings.length}</span>
            <span class="label">New Findings</span>
          </div>
          <div class="compare-stat unchanged">
            <span class="count">${unchangedFindings.length}</span>
            <span class="label">Unchanged</span>
          </div>
          <div class="compare-stat resolved">
            <span class="count">${resolvedFindings.length}</span>
            <span class="label">Resolved Findings</span>
          </div>
        </div>

        ${newFindings.length > 0 ? `
          <h3>New Findings Details</h3>
          <table class="findings-table">
            <thead>
              <tr>
                <th>Page</th>
                <th>Issue</th>
                <th>Severity</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              ${newFindings.map(f => `
                <tr>
                  <td><a href="${f.url}" target="_blank">${f.relativePath}</a></td>
                  <td><span class="badge badge-${f.severity.toLowerCase()}">${f.label}</span></td>
                  <td>${f.severity}</td>
                  <td>${f.message}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        ` : ''}

        ${resolvedFindings.length > 0 ? `
          <h3>Resolved Findings Details</h3>
          <table class="findings-table">
            <thead>
              <tr>
                <th>Page</th>
                <th>Issue</th>
                <th>Severity</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              ${resolvedFindings.map(f => `
                <tr>
                  <td><a href="${f.url}" target="_blank">${f.relativePath}</a></td>
                  <td><span class="badge badge-resolved">${f.label}</span></td>
                  <td>${f.severity}</td>
                  <td>${f.message}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        ` : ''}
      </div>
    `;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Editorial Freshness & Content Report</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Open Sans", "Helvetica Neue", sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
      background-color: #f8f9fa;
    }
    h1, h2, h3 { color: #1a202c; }
    h1 { border-bottom: 2px solid #e2e8f0; padding-bottom: 10px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 30px; }
    .card { background: #fff; padding: 20px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.05); border: 1px solid #e2e8f0; }
    .card h2 { margin-top: 0; font-size: 1.25rem; }
    .stat { font-size: 2.5rem; font-weight: bold; color: #2b6cb0; line-height: 1.2; }
    .stat-label { font-size: 0.875rem; color: #718096; text-transform: uppercase; letter-spacing: 0.05em; }

    .priority-legend { background-color: #ebf8ff; border-left: 4px solid #3182ce; padding: 15px; border-radius: 4px; margin-bottom: 30px; }
    .priority-legend h3 { margin-top: 0; margin-bottom: 10px; font-size: 1.1rem; }

    .badge { display: inline-block; padding: 3px 8px; font-size: 0.75rem; font-weight: bold; border-radius: 12px; text-transform: uppercase; }
    .badge-critical { background: #fff5f5; color: #c53030; border: 1px solid #feb2b2; }
    .badge-high { background: #fffaf0; color: #dd6b20; border: 1px solid #fbd38d; }
    .badge-medium-high { background: #faf5ff; color: #805ad5; border: 1px solid #e9d8fd; }
    .badge-medium { background: #ebf8ff; color: #2b6cb0; border: 1px solid #bee3f8; }
    .badge-medium-low { background: #f0fff4; color: #2f855a; border: 1px solid #9ae6b4; }
    .badge-low { background: #edf2f7; color: #4a5568; border: 1px solid #cbd5e0; }
    .badge-resolved { background: #e6fffa; color: #319795; border: 1px solid #81e6d9; }

    table { width: 100%; border-collapse: collapse; margin-top: 20px; background: #fff; }
    th, td { padding: 12px 15px; text-align: left; border-bottom: 1px solid #e2e8f0; }
    th { background-color: #f7fafc; color: #4a5568; text-transform: uppercase; font-size: 0.8rem; letter-spacing: 0.05em; }
    tr:hover { background-color: #fcfcfc; }

    .page-score { font-weight: bold; color: #c53030; }
    .page-findings { padding-left: 20px; margin: 5px 0; font-size: 0.9rem; }
    .page-findings li { margin-bottom: 4px; }

    .compare-card { border-left: 4px solid #805ad5; }
    .compare-grid { display: flex; gap: 30px; margin-bottom: 20px; }
    .compare-stat { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 15px; border-radius: 6px; width: 150px; }
    .compare-stat.new { background: #fff5f5; color: #c53030; border: 1px solid #feb2b2; }
    .compare-stat.unchanged { background: #edf2f7; color: #4a5568; border: 1px solid #cbd5e0; }
    .compare-stat.resolved { background: #e6fffa; color: #319795; border: 1px solid #81e6d9; }
    .compare-stat .count { font-size: 2rem; font-weight: bold; }
    .compare-stat .label { font-size: 0.75rem; text-transform: uppercase; }

    .findings-table { font-size: 0.9rem; }
  </style>
</head>
<body>
  <h1>Editorial Freshness & Content Report</h1>
  <p>This report prioritizes content updates, highlighting stale pages, thin content, heading structure violations, metadata duplication, and orphan pages.</p>

  <div class="grid">
    <div class="card">
      <div class="stat">${summary.totalPages}</div>
      <div class="stat-label">Pages Audited</div>
    </div>
    <div class="card">
      <div class="stat">${summary.totalFindings}</div>
      <div class="stat-label">Active Findings</div>
    </div>
    <div class="card">
      <div class="stat">${summary.criticalCount}</div>
      <div class="stat-label">Critical Issues</div>
    </div>
    <div class="card">
      <div class="stat">${summary.highCount}</div>
      <div class="stat-label">High Issues</div>
    </div>
  </div>

  <div class="priority-legend">
    <h3>Priority Scoring Explanation</h3>
    <p>Each page is scored by summing up the weight of its active findings. The editorial maintenance backlog below is sorted descending by this priority score. Focus on pages at the top of the list.</p>
    <ul>
      <li><strong>Critical (100):</strong> Orphan Page (completely disconnected from internal link structures).</li>
      <li><strong>High (80):</strong> Duplicate Title.</li>
      <li><strong>Medium-High (60):</strong> Duplicate Meta Description.</li>
      <li><strong>Medium (40-50):</strong> Stale Content, Missing H1, Multiple H1s.</li>
      <li><strong>Medium-Low (30):</strong> Thin Substantive Content.</li>
      <li><strong>Low (10-20):</strong> Unknown Date, Non-Sequential Headings, No Headings.</li>
    </ul>
  </div>

  ${compareHtml}

  <h2>Editorial Backlog (Sorted by Priority Score)</h2>
  <table>
    <thead>
      <tr>
        <th style="width: 30%">Page Path / URL</th>
        <th style="width: 10%">Priority Score</th>
        <th style="width: 10%">Word Count</th>
        <th style="width: 50%">Active Issues / Findings</th>
      </tr>
    </thead>
    <tbody>
      ${pages.map(p => `
        <tr>
          <td>
            <strong>${p.title || 'Untitled'}</strong><br>
            <a href="${p.url}" target="_blank" style="color: #4a5568; font-size: 0.85rem;">${p.relativePath}</a>
          </td>
          <td><span class="page-score">${p.priorityScore}</span></td>
          <td>${p.wordCount} words</td>
          <td>
            ${p.findings.length > 0 ? `
              <ul class="page-findings">
                ${p.findings.map(f => `
                  <li>
                    <span class="badge badge-${f.severity.toLowerCase()}">${f.severity}</span>
                    <strong>${f.label}:</strong> ${f.message}
                  </li>
                `).join('')}
              </ul>
            ` : '<em style="color: #48bb78;">No findings. Content is in excellent shape!</em>'}
          </td>
        </tr>
      `).join('')}
    </tbody>
  </table>
</body>
</html>
`;
}

/**
 * Renders Markdown report
 */
export function renderMarkdownReport(analysis, compareResult = null) {
  const { summary, pages } = analysis;

  let compareMd = '';
  if (compareResult) {
    const { newFindings, resolvedFindings, unchangedFindings } = compareResult;
    compareMd = `
### Snapshot Comparison
- **New Findings:** ${newFindings.length}
- **Unchanged Findings:** ${unchangedFindings.length}
- **Resolved Findings:** ${resolvedFindings.length}
`;
    if (newFindings.length > 0) {
      compareMd += `\n#### New Findings Details\n`;
      for (const f of newFindings) {
        compareMd += `- **${f.relativePath}**: [${f.severity}] ${f.label} - ${f.message}\n`;
      }
    }
    if (resolvedFindings.length > 0) {
      compareMd += `\n#### Resolved Findings Details\n`;
      for (const f of resolvedFindings) {
        compareMd += `- **${f.relativePath}**: [RESOLVED] ${f.label} - ${f.message}\n`;
      }
    }
    compareMd += '\n---\n';
  }

  let tableRows = '';
  for (const p of pages) {
    const findingsStr = p.findings.length > 0
      ? p.findings.map(f => `* [${f.severity}] **${f.label}**: ${f.message}`).join('<br>')
      : '_No issues. Content is healthy!_';
    tableRows += `| **${p.title || 'Untitled'}**<br>\`${p.relativePath}\` | **${p.priorityScore}** | ${p.wordCount} | ${findingsStr} |\n`;
  }

  return `# Editorial Freshness & Content Report

## Executive Summary
- **Pages Audited:** ${summary.totalPages}
- **Total Findings:** ${summary.totalFindings}
- **Critical Issues:** ${summary.criticalCount}
- **High Issues:** ${summary.highCount}

${compareMd}

## Editorial Backlog (Sorted by Priority Score)
Each page is scored by summing up the weight of its active findings. Focus resources on pages with the highest score at the top of this list.

| Page Path / URL | Score | Words | Active Issues / Findings |
|:---|:---|:---|:---|
${tableRows}
`;
}

/**
 * Generates CSV string
 */
export function renderCsvReport(pages) {
  const headers = ['URL', 'Relative Path', 'Title', 'Word Count', 'Priority Score', 'Finding Type', 'Severity', 'Finding Score', 'Message'];
  const rows = [headers];

  for (const p of pages) {
    if (p.findings.length === 0) {
      rows.push([
        p.url,
        p.relativePath,
        p.title,
        p.wordCount,
        p.priorityScore,
        'None',
        'None',
        0,
        'Healthy: no active findings'
      ]);
    } else {
      for (const f of p.findings) {
        rows.push([
          p.url,
          p.relativePath,
          p.title,
          p.wordCount,
          p.priorityScore,
          f.type,
          f.severity,
          f.score,
          f.message
        ]);
      }
    }
  }

  // Escape CSV fields
  return rows.map(row =>
    row.map(val => {
      const s = String(val == null ? '' : val).replace(/"/g, '""');
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s}"` : s;
    }).join(',')
  ).join('\n') + '\n';
}

/**
 * Writes all report outputs to disk.
 */
export function writeReports(analysis, outDir, options = {}) {
  fs.mkdirSync(outDir, { recursive: true });

  const { compareResult } = options;

  const html = renderHtmlReport(analysis, compareResult);
  const md = renderMarkdownReport(analysis, compareResult);
  const csv = renderCsvReport(analysis.pages);

  // Snapshot JSON structure contains full analysis, and compare results if any
  const jsonReport = {
    generatedAt: new Date().toISOString(),
    summary: analysis.summary,
    pages: analysis.pages.map(p => ({
      url: p.url,
      relativePath: p.relativePath,
      title: p.title,
      metaDesc: p.metaDesc,
      date: p.date,
      wordCount: p.wordCount,
      priorityScore: p.priorityScore,
      inboundCount: p.inboundCount,
      findings: p.findings.map(f => ({
        type: f.type,
        label: f.label,
        severity: f.severity,
        score: f.score,
        message: f.message,
      })),
    })),
    findings: analysis.findings.map(f => ({
      url: f.url,
      relativePath: f.relativePath,
      pageTitle: f.pageTitle,
      type: f.type,
      label: f.label,
      severity: f.severity,
      score: f.score,
      message: f.message,
    })),
  };

  if (compareResult) {
    jsonReport.comparison = {
      newFindingsCount: compareResult.newFindings.length,
      resolvedFindingsCount: compareResult.resolvedFindings.length,
      unchangedFindingsCount: compareResult.unchangedFindings.length,
    };
  }

  fs.writeFileSync(path.join(outDir, 'report.html'), html, 'utf8');
  fs.writeFileSync(path.join(outDir, 'report.md'), md, 'utf8');
  fs.writeFileSync(path.join(outDir, 'report.csv'), csv, 'utf8');
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(jsonReport, null, 2) + '\n', 'utf8');

  return {
    htmlPath: path.join(outDir, 'report.html'),
    mdPath: path.join(outDir, 'report.md'),
    csvPath: path.join(outDir, 'report.csv'),
    jsonPath: path.join(outDir, 'report.json'),
  };
}
