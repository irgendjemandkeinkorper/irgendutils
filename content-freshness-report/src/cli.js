#!/usr/bin/env node

import { parseArgs } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.js';
import { loadSourceData, runAnalysis } from './analyzer.js';
import { compareSnapshots, writeReports } from './report.js';

const HELP = `freshness — content freshness, thin-content, and orphan-page reporter

Usage:
  freshness run <dir-or-manifest>              run analysis against folder/manifest

Options:
  -c, --config <file>     config file (default: load defaults)
  -o, --out <dir>         report output dir (default: report)
      --compare <file>    previous run's report.json snapshot to compare against
      --current-date <d>  override current date (YYYY-MM-DD) for deterministic testing
      --no-color          disable ANSI colors
  -h, --help              show this help

Exit codes: 0 = ran successfully, 1 = error occurred during run, 2 = usage error.`;

const C = { reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', dim: '\x1b[2m', bold: '\x1b[1m', cyan: '\x1b[36m' };
function paint(color, name, s) { return color ? `${C[name] || ''}${s}${C.reset}` : s; }

async function main(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      config: { type: 'string', short: 'c' },
      out: { type: 'string', short: 'o' },
      compare: { type: 'string' },
      'current-date': { type: 'string' },
      'no-color': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  if (values.help) {
    console.log(HELP);
    return 0;
  }

  const command = positionals[0];
  if (!command) {
    console.log(HELP);
    return 2;
  }

  if (command !== 'run') {
    console.error(`Unknown command "${command}". Try: freshness run <dir-or-manifest> (or --help)`);
    return 2;
  }

  const targetPath = positionals[1];
  if (!targetPath) {
    console.error('Usage Error: Must provide a directory or manifest JSON file to analyze.');
    console.error('Try: freshness run <dir-or-manifest>');
    return 2;
  }

  const color = !values['no-color'] && process.stdout.isTTY && !process.env.NO_COLOR;

  // 1. Load config
  let config;
  try {
    config = loadConfig(values.config);
  } catch (err) {
    console.error(paint(color, 'red', `Error: Failed to load config: ${err.message}`));
    return 1;
  }

  // 2. Load source data (crawler/pages/manifest)
  let pages;
  try {
    pages = loadSourceData(targetPath);
  } catch (err) {
    console.error(paint(color, 'red', `Error: Failed to load source data: ${err.message}`));
    return 1;
  }

  if (pages.length === 0) {
    console.warn(paint(color, 'yellow', 'Warning: No pages were discovered in the target path.'));
  }

  // 3. Run analysis
  let analysis;
  try {
    analysis = runAnalysis(pages, config, {
      currentDate: values['current-date'],
    });
  } catch (err) {
    console.error(paint(color, 'red', `Error: Analysis failed: ${err.message}`));
    return 1;
  }

  // 4. Handle snapshot comparisons if --compare is supplied
  let compareResult = null;
  if (values.compare) {
    try {
      if (!fs.existsSync(values.compare)) {
        throw new Error(`Comparison file "${values.compare}" does not exist.`);
      }
      const priorReport = JSON.parse(fs.readFileSync(values.compare, 'utf8'));
      const priorFindings = priorReport.findings || [];
      compareResult = compareSnapshots(analysis.findings, priorFindings);
    } catch (err) {
      console.error(paint(color, 'red', `Error: Failed to perform snapshot comparison: ${err.message}`));
      return 1;
    }
  }

  // 5. Write reports
  const outDir = values.out || 'report';
  let reports;
  try {
    reports = writeReports(analysis, outDir, { compareResult });
  } catch (err) {
    console.error(paint(color, 'red', `Error: Failed to write reports: ${err.message}`));
    return 1;
  }

  // Output terminal summary
  console.log(`\n${paint(color, 'bold', 'Editorial Freshness & Content Audit')} of "${targetPath}"`);
  console.log(`Audited: ${paint(color, 'cyan', analysis.summary.totalPages)} pages — Found: ${paint(color, 'yellow', analysis.summary.totalFindings)} active issues`);
  console.log(`  Critical: ${analysis.summary.criticalCount} | High: ${analysis.summary.highCount} | Medium-High: ${analysis.summary.mediumHighCount} | Medium: ${analysis.summary.mediumCount} | Low: ${analysis.summary.lowCount}`);

  if (compareResult) {
    console.log(`\nSnapshot Comparison:`);
    console.log(`  New findings: ${paint(color, 'red', compareResult.newFindings.length)}`);
    console.log(`  Unchanged: ${compareResult.unchangedFindings.length}`);
    console.log(`  Resolved: ${paint(color, 'green', compareResult.resolvedFindings.length)}`);
  }

  console.log(`\nReports generated successfully in "${outDir}/":`);
  console.log(`  - Dashboard: ${reports.htmlPath}`);
  console.log(`  - Markdown: ${reports.mdPath}`);
  console.log(`  - CSV:      ${reports.csvPath}`);
  console.log(`  - JSON:     ${reports.jsonPath}`);

  return 0;
}

main(process.argv.slice(2))
  .then((code) => { process.exitCode = code; })
  .catch((err) => { console.error(err.stack || err.message); process.exitCode = 1; });
