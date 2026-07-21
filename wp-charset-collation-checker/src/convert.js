// Conversion orchestration: scan -> (gate) -> execute DDL -> re-verify.
// Pure w.r.t. I/O except through the injected adapter and backup checker,
// so tests drive it entirely with fixtures.

import { analyzeSchema } from './inspect.js';
import { generateDdl } from './ddl.js';
import { checkBackup } from './backup.js';

/**
 * @param {object} opts
 * @param {object} opts.adapter        fetchSnapshot()/execute() adapter
 * @param {object} opts.target         { charset, collation }
 * @param {string|object} [opts.scope]
 * @param {boolean} [opts.apply]       actually run the DDL (default: dry-run)
 * @param {object} [opts.backup]       { path, maxAgeHours } for the gate
 * @param {boolean} [opts.requireBackup=true]
 * @param {function} [opts.checkBackupFn]  injectable for tests
 * @param {function} [opts.log]
 * @returns {{ status: 'clean'|'dry-run'|'refused'|'converted'|'converted-with-remaining',
 *            before, after?, ddl?, reason? }}
 */
export async function runConvert(opts) {
  const {
    adapter, target, scope = 'all', apply = false,
    backup = {}, requireBackup = true,
    checkBackupFn = checkBackup, log = () => {},
  } = opts;

  const analyzeOpts = {
    targetCharset: target.charset,
    targetCollation: target.collation,
    scope,
  };

  const before = analyzeSchema(await adapter.fetchSnapshot(), analyzeOpts);
  if (before.ok) return { status: 'clean', before };

  const ddl = generateDdl(await adapter.fetchSnapshot(), before, {});

  if (!apply) return { status: 'dry-run', before, ddl };

  if (requireBackup) {
    const gate = checkBackupFn(backup);
    if (!gate.ok) {
      return { status: 'refused', reason: gate.reason, before, ddl };
    }
    log(`backup gate OK: ${backup.path} (${gate.ageHours?.toFixed?.(1) ?? '?'}h old)`);
  } else {
    log('backup gate DISABLED via require_backup_before_apply: false — proceeding at your own risk');
  }

  for (const stmt of ddl.statements) {
    log(`executing: ${stmt}`);
    await adapter.execute(stmt);
  }

  // Verify, don't assume: re-inspect after conversion.
  const after = analyzeSchema(await adapter.fetchSnapshot(), analyzeOpts);
  return {
    status: after.ok ? 'converted' : 'converted-with-remaining',
    before, after, ddl,
  };
}
