import fs from 'node:fs';
import path from 'node:path';
import { parseYaml } from './yaml.js';

export const ALL_CHECKS = ['visual', 'links', 'console', 'structural', 'responsive', 'wp_hygiene'];

const CHECK_ALIASES = {
  headings: 'structural',
  structure: 'structural',
  'wp-hygiene': 'wp_hygiene',
  wphygiene: 'wp_hygiene',
  hygiene: 'wp_hygiene',
};

export function normalizeChecks(list) {
  if (!list || list.length === 0) return [...ALL_CHECKS];
  const out = [];
  for (const c of list) {
    const raw = String(c).trim().toLowerCase();
    if (raw === '') continue;
    const name = CHECK_ALIASES[raw] || raw;
    if (!ALL_CHECKS.includes(name)) {
      throw new Error(`Unknown check "${c}" (known: ${ALL_CHECKS.join(', ')}, alias: headings)`);
    }
    if (!out.includes(name)) out.push(name);
  }
  return out.length ? out : [...ALL_CHECKS];
}

export function loadConfig(file, { cwd = process.cwd() } = {}) {
  const abs = path.resolve(cwd, file);
  let text;
  try {
    text = fs.readFileSync(abs, 'utf8');
  } catch {
    throw new Error(`Config file not found: ${abs}`);
  }
  const raw = parseYaml(text) || {};
  const configDir = path.dirname(abs);

  const cfg = {
    template_url: raw.template_url || null,
    targets: Array.isArray(raw.targets) ? raw.targets : raw.targets ? [raw.targets] : [],
    viewports: Array.isArray(raw.viewports) && raw.viewports.length ? raw.viewports.map(Number) : [360, 768, 1280],
    thresholds: {
      pixel_diff_pct: raw.thresholds?.pixel_diff_pct ?? 0.15,
      max_broken_links: raw.thresholds?.max_broken_links ?? 0,
    },
    checks: normalizeChecks(raw.checks),
    auth: raw.auth && raw.auth.user ? { user: raw.auth.user, app_password_env: raw.auth.app_password_env || 'WP_APP_PASSWORD' } : null,
    mask_selectors: Array.isArray(raw.mask_selectors) ? raw.mask_selectors : [],
    consent_selector: raw.consent_selector || null,
    adapter: raw.adapter || 'playwright',
    fixture: raw.fixture ? path.resolve(configDir, String(raw.fixture)) : null,
    baseline_dir: path.resolve(cwd, String(raw.baseline_dir || 'baseline')),
    report_dir: path.resolve(cwd, String(raw.report_dir || 'report')),
    configPath: abs,
    configDir,
  };
  return cfg;
}

/** Resolve auth credentials from env. Never logs or stores the secret in config. */
export function resolveAuth(cfg, env = process.env) {
  if (!cfg.auth) return null;
  const password = env[cfg.auth.app_password_env];
  if (!password) return null;
  return { user: cfg.auth.user, password };
}

/** Tiny .env loader: KEY=VALUE lines, does not overwrite existing env vars. */
export function loadEnvFile(file, env = process.env) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return {};
  }
  const loaded = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let value = m[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    loaded[m[1]] = value;
    if (!(m[1] in env)) env[m[1]] = value;
  }
  return loaded;
}
