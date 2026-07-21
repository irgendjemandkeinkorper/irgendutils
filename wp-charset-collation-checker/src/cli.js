#!/usr/bin/env node
// charset — Charset / Collation Consistency Checker CLI.
//
//   charset scan                         report mismatches (read-only)
//   charset scan --scope tables:wp_postmeta
//   charset ddl                          emit conversion SQL, don't run it
//   charset convert                      dry-run: show what --apply would do
//   charset convert --apply              gated: requires backup, converts + re-verifies
//
// Exit codes: 0 clean/success, 1 mismatches found (scan) or remaining after
// convert, 2 --apply refused by the backup gate, 3 usage or runtime error.

import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import process from 'node:process';

import { loadConfig, resolvePassword } from './config.js';
import { analyzeSchema, parseScope } from './inspect.js';
import { generateDdl } from './ddl.js';
import { renderReport } from './report.js';
import { runConvert } from './convert.js';
import { parseWpConfig, checkWpConfigAgainstTarget } from './wpconfig.js';

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (s) => (useColor ? `\u001b[${code}m${s}\u001b[0m` : s);
const red = paint('31');
const green = paint('32');
const yellow = paint('33');
const bold = paint('1');

const HELP = `charset — charset/collation consistency checker (target: utf8mb4)

Usage:
  charset scan     [options]        Report mismatches (read-only). Exits 1 if any.
  charset ddl      [options]        Generate conversion SQL into convert.sql (never runs it).
  charset convert  [options]        Dry-run by default; --apply converts after the backup gate.

Options:
  --config <file>      Config file (default: ./config.yml if present)
  --scope <scope>      all | tables:wp_posts,wp_postmeta (overrides config)
  --fixture <file>     Use the offline fixture adapter with this JSON snapshot
  --wp-config <file>   Cross-check DB_CHARSET/DB_COLLATE from this wp-config.php
  --backup <file>      Backup dump for the --apply gate (overrides config backup.path)
  --apply              convert only: actually run the DDL (requires a fresh backup)
  --out <dir>          Report directory (default: config report_dir, ./report)
  --sql-out <file>     Where `ddl` writes SQL (default: ./convert.sql)
  --json               Print machine-readable JSON to stdout
  --help               Show this help

Secrets: DB passwords come from the env var NAMED by db.pass_env / db.apply_pass_env
(see .env.example). Live DB access needs the optional mysql2 driver (npm i mysql2);
fixtures need nothing.
`;

async function main() {
  const { values: flags, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      config: { type: 'string' },
      scope: { type: 'string' },
      fixture: { type: 'string' },
      'wp-config': { type: 'string' },
      backup: { type: 'string' },
      apply: { type: 'boolean', default: false },
      out: { type: 'string' },
      'sql-out': { type: 'string' },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });

  const command = positionals[0];
  if (flags.help || !command) {
    process.stdout.write(HELP);
    return flags.help ? 0 : 3;
  }
  if (!['scan', 'ddl', 'convert'].includes(command)) {
    process.stderr.write(`unknown command: ${command}\n\n${HELP}`);
    return 3;
  }

  const configPath = flags.config ?? (existsSync('config.yml') ? 'config.yml' : undefined);
  const config = loadConfig(configPath);

  const target = {
    charset: String(config.target_charset ?? 'utf8mb4').toLowerCase(),
    collation: String(config.target_collation ?? 'utf8mb4_unicode_ci').toLowerCase(),
  };
  const scope = parseScope(flags.scope ?? config.scope ?? 'all');

  // wp-config.php cross-check (workflow step 1).
  const wpConfigPath = flags['wp-config'] ?? config.wp_config;
  let wpWarnings = [];
  if (wpConfigPath) {
    const wp = parseWpConfig(readFileSync(wpConfigPath, 'utf8'));
    wpWarnings = checkWpConfigAgainstTarget(wp, target.charset, target.collation);
  }

  const adapter = await createAdapter(config, flags, command === 'convert' && flags.apply);
  try {
    const timestamp = new Date().toISOString();
    const fileStamp = timestamp.replace(/[:.]/g, '-');

    if (command === 'scan') {
      const analysis = analyzeSchema(await adapter.fetchSnapshot(), {
        targetCharset: target.charset, targetCollation: target.collation, scope,
      });
      const snapshot = await adapter.fetchSnapshot();
      const report = renderReport(analysis, {
        timestamp, dbName: snapshot.database?.name, wpWarnings,
      });
      const outDir = resolve(flags.out ?? config.report_dir ?? 'report');
      mkdirSync(outDir, { recursive: true });
      const reportPath = join(outDir, `${fileStamp}.md`);
      writeFileSync(reportPath, report);

      if (flags.json) {
        printJson({ ...serializeAnalysis(analysis), wpWarnings, reportPath });
      } else {
        printScanSummary(analysis, wpWarnings);
        process.stdout.write(`report written: ${reportPath}\n`);
      }
      return analysis.ok ? 0 : 1;
    }

    if (command === 'ddl') {
      const snapshot = await adapter.fetchSnapshot();
      const analysis = analyzeSchema(snapshot, {
        targetCharset: target.charset, targetCollation: target.collation, scope,
      });
      const ddl = generateDdl(snapshot, analysis, { timestamp });
      const sqlPath = resolve(flags['sql-out'] ?? 'convert.sql');
      writeFileSync(sqlPath, ddl.sql);
      if (flags.json) {
        printJson({ statements: ddl.statements, sqlPath, findings: analysis.findings.length });
      } else {
        process.stdout.write(ddl.sql);
        process.stdout.write(`\n${bold('SQL written:')} ${sqlPath} (${ddl.statements.length} statement(s) — NOT executed)\n`);
      }
      return 0;
    }

    // convert
    const result = await runConvert({
      adapter, target, scope,
      apply: flags.apply,
      requireBackup: config.require_backup_before_apply !== false,
      backup: {
        path: flags.backup ?? config.backup?.path,
        maxAgeHours: config.backup?.max_age_hours ?? 24,
      },
      log: (msg) => process.stderr.write(`${msg}\n`),
    });

    if (flags.json) {
      printJson({
        status: result.status, reason: result.reason,
        before: result.before.findings.length,
        after: result.after ? result.after.findings.length : undefined,
        statements: result.ddl?.statements,
      });
    }

    switch (result.status) {
      case 'clean':
        if (!flags.json) process.stdout.write(green('nothing to convert — schema already matches the target.\n'));
        return 0;
      case 'dry-run':
        if (!flags.json) {
          process.stdout.write(result.ddl.sql);
          process.stdout.write(yellow(`\nDRY RUN — ${result.before.findings.length} finding(s). Re-run with --apply (and a fresh backup) to convert.\n`));
        }
        return 0;
      case 'refused':
        process.stderr.write(red(`REFUSED: ${result.reason}\n`));
        return 2;
      case 'converted': {
        if (!flags.json) {
          process.stdout.write(green(`converted ${result.ddl.statements.length} statement(s); post-conversion re-scan is CLEAN.\n`));
        }
        const outDir = resolve(flags.out ?? config.report_dir ?? 'report');
        mkdirSync(outDir, { recursive: true });
        const reportPath = join(outDir, `${fileStamp}-post-convert.md`);
        writeFileSync(reportPath, renderReport(result.after, { timestamp, wpWarnings }));
        if (!flags.json) process.stdout.write(`post-conversion report: ${reportPath}\n`);
        return 0;
      }
      case 'converted-with-remaining':
        process.stderr.write(red(`conversion ran but ${result.after.findings.length} finding(s) remain — inspect manually.\n`));
        return 1;
      default:
        return 3;
    }
  } finally {
    await adapter.close?.();
  }
}

async function createAdapter(config, flags, forApply) {
  const fixturePath = flags.fixture ?? config.db?.fixture;
  if (fixturePath) {
    const { FixtureAdapter } = await import('./adapters/fixture.js');
    return FixtureAdapter.fromFile(resolve(fixturePath));
  }
  if (!config.db?.name) {
    throw new Error('no database configured: set db.* in config.yml or pass --fixture <snapshot.json>');
  }
  // Lazy-load: only touches mysql2 when actually hitting a live DB.
  const { MysqlAdapter } = await import('./adapters/mysql.js');
  return MysqlAdapter.create({
    host: config.db.host,
    port: config.db.port,
    name: config.db.name,
    user: forApply ? config.db.apply_user ?? config.db.user : config.db.user,
    password: resolvePassword(config.db, { forApply }),
  });
}

function printScanSummary(analysis, wpWarnings) {
  for (const w of wpWarnings) process.stdout.write(`${yellow('WARN')} ${w}\n`);
  if (analysis.ok) {
    process.stdout.write(green(`CLEAN — no charset/collation mismatches (target ${analysis.target.charset}/${analysis.target.collation}).\n`));
    return;
  }
  const c = analysis.counts;
  process.stdout.write(bold(
    `${analysis.findings.length} finding(s): ${c.high ?? 0} high, ${c.medium ?? 0} medium, ${c.low ?? 0} low\n`
  ));
  for (const [group, findings] of analysis.byTable) {
    process.stdout.write(`\n${bold(group)}\n`);
    for (const f of findings) {
      const sev = f.severity === 'high' ? red('HIGH  ') : f.severity === 'medium' ? yellow('MEDIUM') : 'LOW   ';
      process.stdout.write(`  ${sev} ${f.message}\n`);
    }
  }
  for (const w of analysis.indexWarnings) process.stdout.write(`\n${yellow('WARN')} ${w.message}\n`);
  process.stdout.write('\n');
}

function serializeAnalysis(analysis) {
  return {
    ok: analysis.ok,
    target: analysis.target,
    counts: analysis.counts,
    findings: analysis.findings,
    indexWarnings: analysis.indexWarnings,
  };
}

function printJson(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(red(`error: ${err.message}\n`));
    process.exit(3);
  }
);
