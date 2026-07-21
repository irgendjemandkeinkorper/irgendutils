// Config loading: config.yml (parsed with the built-in mini YAML parser)
// merged over defaults. Secrets never live in the file — only env var NAMES.

import { readFileSync, existsSync } from 'node:fs';
import { parseYaml } from './yaml.js';

export const DEFAULTS = {
  db: {},
  target_charset: 'utf8mb4',
  target_collation: 'utf8mb4_unicode_ci',
  scope: 'all',
  require_backup_before_apply: true,
  backup: {},
  report_dir: 'report',
};

export function loadConfig(path) {
  let fileConfig = {};
  if (path) {
    if (!existsSync(path)) throw new Error(`config file not found: ${path}`);
    fileConfig = parseYaml(readFileSync(path, 'utf8')) ?? {};
  }
  return {
    ...DEFAULTS,
    ...fileConfig,
    db: { ...DEFAULTS.db, ...(fileConfig.db ?? {}) },
    backup: { ...DEFAULTS.backup, ...(fileConfig.backup ?? {}) },
  };
}

/** Resolve the DB password from the env var NAMED in config (never logged). */
export function resolvePassword(dbConfig, { forApply = false, env = process.env } = {}) {
  const envName = forApply
    ? dbConfig.apply_pass_env ?? dbConfig.pass_env
    : dbConfig.pass_env;
  if (!envName) return undefined;
  const value = env[envName];
  if (value === undefined) {
    throw new Error(`env var ${envName} (named by db.${forApply ? 'apply_pass_env/' : ''}pass_env) is not set`);
  }
  return value;
}
