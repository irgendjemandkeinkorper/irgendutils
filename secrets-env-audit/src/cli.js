#!/usr/bin/env node
// secaudit — secrets scan, env drift, web exposure probe. Read-only:
// it reports and advises, never mutates. Exits 1 on any HIGH finding.

import { parseArgs } from 'node:util';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseYAML } from './yaml.js';
import { runScan } from './scan.js';
import { runDrift } from './drift.js';
import { runWebProbe } from './webprobe.js';
import { writeReport, hasHighSeverity, countBySeverity } from './report.js';

const HELP = `secaudit — secrets / env audit (read-only)

Usage: secaudit <command> [options]

Commands:
  scan        secret scan across configured roots (+ git history)
  drift       .env key/shape comparison across environments
  web-probe   check for publicly exposed config files
  run         all of the above

Options:
  -c, --config <file>   config file (default: $SECAUDIT_CONFIG, config.yml, config.example.yml)
  -o, --out <dir>       report output dir (default: $SECAUDIT_OUT_DIR or ./report)
      --no-report       do not write report files, console output only
      --json            print the JSON report to stdout
  -h, --help            show this help

Exit codes: 0 clean, 1 at least one HIGH-severity finding, 2 usage/config error.
Findings are always masked — secret values are never printed.`;

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const red = paint('31');
const yellow = paint('33');
const green = paint('32');
const dim = paint('2');
const bold = paint('1');

function fail(msg) {
  console.error(red(`secaudit: ${msg}`));
  process.exit(2);
}

function loadConfig(explicitPath) {
  const candidates = explicitPath
    ? [explicitPath]
    : [process.env.SECAUDIT_CONFIG, 'config.yml', 'config.example.yml'].filter(Boolean);
  for (const p of candidates) {
    const abs = resolve(p);
    if (existsSync(abs)) {
      try {
        return { config: parseYAML(readFileSync(abs, 'utf8')) ?? {}, baseDir: dirname(abs), path: abs };
      } catch (err) {
        fail(`could not parse ${abs}: ${err.message}`);
      }
    }
  }
  fail(`no config file found (tried: ${candidates.join(', ')})`);
}

function sevColor(sev) {
  return sev === 'high' ? red : sev === 'medium' ? yellow : dim;
}

function printFindings(findings, warnings) {
  for (const f of findings) {
    const where =
      f.part === 'scan'
        ? `${f.file}:${f.line} [${f.location}${f.commit ? ` @ ${f.commit}` : ''}]`
        : f.part === 'web_probe'
          ? f.url
          : `key ${f.key}`;
    console.log(`${sevColor(f.severity)(f.severity.toUpperCase().padEnd(6))} ${bold(f.rule)}  ${where}`);
    console.log(`       ${f.masked}`);
    console.log(dim(`       fix: ${f.remediation}`));
  }
  for (const w of warnings) console.log(yellow(`warn: ${w}`));
}

async function main() {
  let args;
  try {
    args = parseArgs({
      allowPositionals: true,
      options: {
        config: { type: 'string', short: 'c' },
        out: { type: 'string', short: 'o' },
        'no-report': { type: 'boolean', default: false },
        json: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    });
  } catch (err) {
    fail(err.message);
  }
  const command = args.positionals[0];
  if (args.values.help || !command) {
    console.log(HELP);
    process.exit(command ? 0 : args.values.help ? 0 : 2);
  }
  if (!['scan', 'drift', 'web-probe', 'run'].includes(command)) {
    fail(`unknown command "${command}" — see --help`);
  }

  const { config, baseDir } = loadConfig(args.values.config);
  const findings = [];
  const warnings = [];

  if (command === 'scan' || command === 'run') {
    let gitAdapter = null;
    if (config.scan?.include_git_history) {
      // lazy: the git adapter (child_process) only loads when history is on
      const mod = await import('./adapters/git.js');
      gitAdapter = mod.createGitAdapter();
    }
    const res = runScan(config, { gitAdapter, baseDir });
    findings.push(...res.findings);
    warnings.push(...res.warnings);
  }
  if (command === 'drift' || command === 'run') {
    const res = runDrift(config, { baseDir });
    findings.push(...res.findings);
    warnings.push(...res.warnings);
  }
  if (command === 'web-probe' || command === 'run') {
    if ((config.web_probe?.urls ?? []).length === 0) {
      if (command === 'web-probe') warnings.push('web_probe.urls is empty — nothing to probe');
    } else {
      // lazy: the live HTTP adapter only loads when there are URLs to hit
      const mod = await import('./adapters/http.js');
      const res = await runWebProbe(config, { httpAdapter: mod.createHttpAdapter() });
      findings.push(...res.findings);
      warnings.push(...res.warnings);
      for (const c of res.checked) console.log(dim(`probe: ${c.url} -> ${c.status}`));
    }
  }

  printFindings(findings, warnings);

  const counts = countBySeverity(findings);
  const summary = `${counts.high} high / ${counts.medium} medium / ${counts.low} low / ${counts.info} info`;
  console.log(findings.length === 0 ? green(`clean — no findings (${summary})`) : bold(`findings: ${summary}`));

  if (!args.values['no-report']) {
    const outDir = resolve(args.values.out ?? process.env.SECAUDIT_OUT_DIR ?? 'report');
    const { mdPath, jsonPath } = writeReport(findings, { outDir, warnings });
    console.log(dim(`report: ${mdPath}`));
    console.log(dim(`report: ${jsonPath}`));
  }
  if (args.values.json) {
    const { buildJSON } = await import('./report.js');
    console.log(JSON.stringify(buildJSON(findings, { generatedAt: new Date().toISOString(), warnings }), null, 2));
  }

  process.exit(hasHighSeverity(findings) ? 1 : 0);
}

main().catch((err) => fail(err.stack ?? String(err)));
