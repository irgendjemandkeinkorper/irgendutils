#!/usr/bin/env node
// audit — pre-launch go/no-go auditor. Read-only: only GETs pages/resources,
// never submits forms or mutates the site. Exits non-zero on any blocker so
// it can gate a launch.

import { parseArgs } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { resolveConfig, loadDotEnv } from './config.js';
import { runAudit, CATEGORIES } from './audit.js';
import { buildScorecardJson, renderScorecardHtml } from './scorecard.js';
import { createFixtureAdapter } from './adapters/fixture.js';
import { createLiveAdapter } from './adapters/live.js';

const CHECK_IDS = Object.keys(CATEGORIES);

const HELP = `audit — pre-launch go/no-go auditor (read-only, exits non-zero on any blocker)

Usage:
  audit run <staging-url>          audit a live site
  audit run <url> --only seo,a11y  only the named checks: ${CHECK_IDS.join(', ')}
  audit run --fixture <dir>        run offline against a fixture (no network)

Options:
  -c, --config <file>   config file (default: audit.config.yml if present)
      --env <env>       staging | production (default: staging, or config)
      --only <list>     comma-separated subset: ${CHECK_IDS.join(', ')}
      --budget <file>   perf budget JSON (default: budgets.json if present)
      --runs <n>        performance samples to aggregate (default: 3)
      --fixture <dir>   run offline against a fixture directory (see adapters/fixture.js)
  -o, --out <dir>       report output dir (default: report)
      --json            print scorecard.json to stdout instead of the table
      --no-color        disable ANSI colors
  -h, --help            show this help

Exit codes: 0 = ready (no blockers), 1 = at least one blocker, 2 = usage/config error.`;

const C = { reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', dim: '\x1b[2m', bold: '\x1b[1m', cyan: '\x1b[36m' };
function paint(color, name, s) { return color ? `${C[name] || ''}${s}${C.reset}` : s; }

async function main(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      config: { type: 'string', short: 'c' },
      env: { type: 'string' },
      only: { type: 'string' },
      budget: { type: 'string' },
      runs: { type: 'string' },
      fixture: { type: 'string' },
      out: { type: 'string', short: 'o' },
      json: { type: 'boolean', default: false },
      'no-color': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  if (values.help) { console.log(HELP); return 0; }

  const command = positionals[0];
  if (!command) { console.log(HELP); return 2; }
  if (command !== 'run') {
    console.error(`Unknown command "${command}". Try: audit run <url> | audit run --fixture <dir> (or --help)`);
    return 2;
  }

  const color = !values['no-color'] && process.stdout.isTTY && !process.env.NO_COLOR;
  loadDotEnv();

  const configFile = values.config ?? (fs.existsSync('audit.config.yml') ? 'audit.config.yml' : null);
  const budgetFile = values.budget ?? (fs.existsSync('budgets.json') ? 'budgets.json' : null);

  // Fixture adapters carry their own default environment (site.json), which
  // sits between the config file and CLI flags in precedence — so it must be
  // resolved before resolveConfig(), not after.
  const target = positionals[1];
  let fixtureAdapter = null;
  try {
    if (values.fixture) {
      fixtureAdapter = await createFixtureAdapter(values.fixture);
    } else if (!target) {
      console.error('Usage: audit run <url>   (or: audit run --fixture <dir>)');
      return 2;
    }
  } catch (err) {
    console.error(paint(color, 'red', `Error: ${err.message}`));
    return 2;
  }

  let config;
  try {
    config = resolveConfig({
      configFile,
      fixtureEnvironment: fixtureAdapter?.environment ?? null,
      flags: {
        env: values.env,
        only: values.only,
        runs: values.runs,
        budget: budgetFile,
      },
    });
  } catch (err) {
    console.error(paint(color, 'red', `Error: ${err.message}`));
    return 2;
  }

  if (config.only.length) {
    const bad = config.only.filter((c) => !CHECK_IDS.includes(c));
    if (bad.length) {
      console.error(paint(color, 'red', `Error: unknown check(s): ${bad.join(', ')}. Valid: ${CHECK_IDS.join(', ')}`));
      return 2;
    }
  }

  const adapter = fixtureAdapter
    ?? createLiveAdapter(target, config, { log: (m) => process.stderr.write(`  ${m}\n`) });

  let run;
  try {
    run = await runAudit(adapter, config);
  } finally {
    await adapter.close?.();
  }

  const generatedAt = new Date().toISOString();
  const outDir = path.resolve(values.out ?? 'report');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'scorecard.json'), JSON.stringify(buildScorecardJson(run, { generatedAt }), null, 2) + '\n');
  fs.writeFileSync(path.join(outDir, 'scorecard.html'), renderScorecardHtml(run, { generatedAt }));

  if (values.json) {
    console.log(fs.readFileSync(path.join(outDir, 'scorecard.json'), 'utf8').trimEnd());
  } else {
    printSummary(run, color);
    console.log(`\nscorecard: ${path.join(outDir, 'scorecard.html')}`);
  }

  return run.pass ? 0 : 1;
}

function printSummary(run, color) {
  const s = run.summary;
  const verdict = run.pass
    ? paint(color, 'green', 'READY (no blockers)')
    : paint(color, 'red', `NOT READY (${s.blocker} blocker${s.blocker === 1 ? '' : 's'})`);
  console.log(`\n${paint(color, 'bold', 'Pre-launch audit')}  ${run.baseUrl}  ${paint(color, 'dim', `(${run.environment})`)}`);
  console.log(verdict);
  console.log(paint(color, 'dim', `${s.blocker} blocker(s), ${s.warning} warning(s), ${s.info} info — ${run.pagesAudited.length} page(s) audited`));
  for (const f of run.findings) {
    if (f.severity === 'info') continue;
    const tag = f.severity === 'blocker' ? paint(color, 'red', '[BLOCKER]') : paint(color, 'yellow', '[warn]');
    console.log(`  ${tag} ${CATEGORIES[f.category]?.label ?? f.category}: ${f.message}${f.url ? paint(color, 'dim', ` (${f.url})`) : ''}`);
  }
}

main(process.argv.slice(2))
  .then((code) => { process.exitCode = code; })
  .catch((err) => { console.error(err.stack || err.message); process.exitCode = 1; });
