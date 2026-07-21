#!/usr/bin/env node
// qa — QA a live WordPress site against a template/reference. Read-only: it only
// navigates and reads, never submits forms or mutates the site. Exits non-zero
// when any target fails a threshold, so it can gate a deploy.

import { parseArgs } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { loadConfig, loadEnvFile, normalizeChecks, resolveAuth } from './config.js';
import { runQa, severityCounts } from './runner.js';
import { writeReport, saveBaseline, loadBaseline } from './report.js';
import { preflight, formatPreflight } from './preflight.js';

const HELP = `qa — WordPress QA vs. a template (read-only, exits non-zero on failure)

Usage:
  qa run                          run every target in the config, all checks
  qa run <url>                    run a single target (added to config targets)
  qa run --checks visual,links    only the named checks
  qa baseline <url>               capture/refresh a visual baseline for <url>
  qa preflight                    connectivity check only (reachability + auth)
  qa report [--open]              show (and optionally open) the latest report

Options:
  -c, --config <file>   config file (default: qa.config.yml)
      --checks <list>   comma-separated subset: ${normalizeChecks([]).join(', ')}
      --skip-preflight  skip the connectivity check before a live run
      --fixture <file>  run offline against a capture.json (uses the fake adapter)
      --adapter <file>  advanced: a module exporting createAdapter(cfg)
  -o, --out <dir>       report output dir (default: from config or ./report)
      --json            print results.json to stdout instead of the table
      --open            (report) open the latest report in a browser
      --no-color        disable ANSI colors
  -h, --help            show this help

Before a live run, a preflight checks every target (and the template) is
reachable and that any configured Application Password works — so DNS/TLS/URL
and credential problems fail fast. Unreachable targets abort the run (exit 2).

Exit codes: 0 = all targets passed, 1 = at least one failure, 2 = usage/config error.`;

async function main(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      config: { type: 'string', short: 'c', default: 'qa.config.yml' },
      checks: { type: 'string' },
      'skip-preflight': { type: 'boolean', default: false },
      fixture: { type: 'string' },
      adapter: { type: 'string' },
      out: { type: 'string', short: 'o' },
      json: { type: 'boolean', default: false },
      open: { type: 'boolean', default: false },
      'no-color': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  const command = positionals[0];
  if (values.help) {
    console.log(HELP);
    return 0;
  }
  if (!command) {
    console.log(HELP);
    return 2;
  }
  if (!['run', 'baseline', 'report', 'preflight'].includes(command)) {
    console.error(`Unknown command "${command}". Try: qa run | qa baseline <url> | qa preflight | qa report  (or --help)`);
    return 2;
  }

  const color = !values['no-color'] && process.stdout.isTTY && !process.env.NO_COLOR;

  let cfg;
  try {
    cfg = loadConfig(values.config);
  } catch (err) {
    console.error(err.message);
    return 2;
  }
  if (values.out) cfg.report_dir = path.resolve(values.out);
  if (values.checks) {
    try {
      cfg.checks = normalizeChecks(values.checks.split(','));
    } catch (err) {
      console.error(err.message);
      return 2;
    }
  }

  // Load .env from cwd (never overwrites the real environment); secrets only
  // ever come from env, never from the config file.
  const dotenv = path.resolve('.env');
  if (fs.existsSync(dotenv)) loadEnvFile(dotenv);

  if (command === 'report') return cmdReport(cfg, values);
  if (command === 'preflight') return cmdPreflight(cfg, values, color);
  if (command === 'baseline') return cmdBaseline(cfg, values, positionals[1], color);
  return cmdRun(cfg, values, positionals[1], color);
}

async function cmdRun(cfg, values, singleTarget, color) {
  if (singleTarget) cfg.targets = [singleTarget];
  if (!cfg.targets.length) {
    console.error('No targets to check. Add `targets:` to the config or pass one: qa run <url>');
    return 2;
  }

  const adapter = await makeAdapter(cfg, values, (msg) => process.stderr.write(`  ${msg}\n`));

  // Connectivity preflight before a live browser run: reachability + auth, so
  // DNS/TLS/URL/credential problems fail fast. Only for the live adapter (the
  // fake/fixture adapter has nothing to reach); --skip-preflight opts out.
  if (adapter.name === 'playwright' && !values['skip-preflight']) {
    const pf = await preflight(adapter, cfg, {
      auth: resolveAuth(cfg, process.env),
      log: (m) => process.stderr.write(`${m}\n`),
    });
    console.log(formatPreflight(pf, { color }));
    console.log('');
    if (!pf.ok) {
      await adapter.close?.();
      return 2;
    }
  }

  // Pre-load any stored baselines (used as the visual reference when there is
  // no template_url). Disk I/O stays out of the runner.
  const baselines = {};
  if (!cfg.template_url && cfg.checks.includes('visual')) {
    for (const t of cfg.targets) {
      const b = loadBaseline(cfg, t);
      if (b) baselines[t] = b;
    }
  }

  let run;
  try {
    run = await runQa(cfg, adapter, { baselines, log: (m) => process.stderr.write(`${m}\n`) });
  } finally {
    await adapter.close?.();
  }

  const timestamp = nowStamp();
  const generatedAt = new Date().toISOString();
  const reportDir = writeReport(run, { outDir: cfg.report_dir, timestamp, generatedAt });

  if (values.json) {
    console.log(fs.readFileSync(path.join(reportDir, 'results.json'), 'utf8').trimEnd());
  } else {
    console.log(formatSummary(run, { color }));
    console.log(`\nreport: ${path.join(reportDir, 'index.html')}`);
  }
  return run.pass ? 0 : 1;
}

async function cmdBaseline(cfg, values, url, color) {
  if (!url) {
    console.error('Usage: qa baseline <url>');
    return 2;
  }
  const adapter = await makeAdapter(cfg, values, (msg) => process.stderr.write(`  ${msg}\n`));
  try {
    const cap = await adapter.capturePage(url, {
      viewports: cfg.viewports,
      maskSelectors: cfg.mask_selectors,
      consentSelector: cfg.consent_selector,
    });
    const written = saveBaseline(cfg, url, cap.screenshots);
    console.log(paint(color, 'green', `✓ baseline captured for ${url}`));
    for (const f of written) console.log(`  ${f}`);
    return 0;
  } finally {
    await adapter.close?.();
  }
}

async function cmdPreflight(cfg, values, color) {
  if (!cfg.targets.length && !cfg.template_url) {
    console.error('Nothing to preflight: set template_url and/or targets in the config.');
    return 2;
  }
  const adapter = await makeAdapter(cfg, values, (msg) => process.stderr.write(`  ${msg}\n`));
  try {
    const pf = await preflight(adapter, cfg, {
      auth: resolveAuth(cfg, process.env),
      log: (m) => process.stderr.write(`${m}\n`),
    });
    console.log(formatPreflight(pf, { color }));
    return pf.ok ? 0 : 2;
  } finally {
    await adapter.close?.();
  }
}

function cmdReport(cfg, values) {
  const latest = latestReport(cfg.report_dir);
  if (!latest) {
    console.error(`No reports found under ${cfg.report_dir}. Run \`qa run\` first.`);
    return 2;
  }
  const index = path.join(latest, 'index.html');
  console.log(index);
  if (values.open) openInBrowser(index);
  return 0;
}

// ----- adapter wiring -----

async function makeAdapter(cfg, values, log) {
  if (values.adapter) {
    const mod = await import(pathToFileURL(path.resolve(values.adapter)).href);
    const create = mod.createAdapter ?? mod.default;
    if (typeof create !== 'function') throw new Error(`--adapter ${values.adapter} must export createAdapter(cfg)`);
    return create(cfg, { log });
  }
  const fixture = values.fixture || cfg.fixture;
  if (fixture || cfg.adapter === 'fake') {
    const { createFakeAdapter } = await import('./adapters/fake.js');
    return createFakeAdapter(fixture);
  }
  const { createPlaywrightAdapter } = await import('./adapters/playwright.js');
  return createPlaywrightAdapter({ log });
}

// ----- console summary -----

function formatSummary(run, { color }) {
  const lines = [];
  for (const r of run.results) {
    const counts = severityCounts(r.findings);
    const mark = r.pass ? paint(color, 'green', '✓') : paint(color, 'red', '✗');
    lines.push(`${mark} ${r.target}  ${paint(color, 'dim', `(${counts.error} error, ${counts.warn} warn, ${counts.info} info)`)}`);
    const shown = [...r.findings]
      .filter((f) => f.severity === 'error' || f.severity === 'warn')
      .sort((a, b) => (a.severity === 'error' ? -1 : 1) - (b.severity === 'error' ? -1 : 1));
    for (const f of shown) {
      const c = f.severity === 'error' ? 'red' : 'yellow';
      lines.push(`    ${paint(color, c, f.severity.toUpperCase())} [${f.check}] ${f.message}`);
    }
  }
  const s = run.results;
  const verdict = run.pass ? paint(color, 'green', 'PASS') : paint(color, 'red', 'FAIL');
  lines.push('');
  lines.push(`${verdict}  ${s.filter((r) => r.pass).length}/${s.length} target(s) passed`);
  return lines.join('\n');
}

const ANSI = { green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', dim: '\x1b[2m', reset: '\x1b[0m' };
function paint(on, code, s) {
  return on ? ANSI[code] + s + ANSI.reset : s;
}

// ----- report discovery / open -----

function latestReport(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
  } catch {
    return null;
  }
  const withIndex = entries
    .map((e) => path.join(dir, e.name))
    .filter((p) => fs.existsSync(path.join(p, 'index.html')))
    .sort();
  return withIndex.length ? withIndex[withIndex.length - 1] : null;
}

function openInBrowser(file) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try {
    spawn(cmd, [file], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).unref();
  } catch {
    /* best effort */
  }
}

// Filesystem-safe timestamp, sortable. Avoids ':' (invalid on Windows).
function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '');
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error(`qa: ${err.message}`);
    process.exitCode = 2;
  });
