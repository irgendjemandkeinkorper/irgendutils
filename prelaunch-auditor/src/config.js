import { readFileSync, existsSync } from 'node:fs';
import { parseYaml, parseDotEnv } from './yaml.js';

export const DEFAULT_BUDGETS = {
  mobile: { lcp_ms: 2500, cls: 0.1, tbt_ms: 300, performance_score: 0.8 },
  desktop: { lcp_ms: 1800, cls: 0.1, tbt_ms: 200, performance_score: 0.9 },
};

export const DEFAULTS = {
  environment: 'staging',
  runs: 3,
  maxPages: 25,
  only: [],
  budgets: DEFAULT_BUDGETS,
  analytics: { waived: false },
  consent: { required: false },
};

const VALID_ENVS = new Set(['staging', 'production']);

/**
 * Merge order (later wins): defaults < config file < fixture default env < CLI flags.
 */
export function resolveConfig({ configFile = null, fixtureEnvironment = null, flags = {} } = {}) {
  const cfg = structuredClone(DEFAULTS);

  if (configFile) {
    if (!existsSync(configFile)) throw new Error(`config file not found: ${configFile}`);
    const y = parseYaml(readFileSync(configFile, 'utf8'));
    if (y.environment != null) cfg.environment = String(y.environment);
    if (y.runs != null) cfg.runs = Number(y.runs);
    if (y.max_pages != null) cfg.maxPages = Number(y.max_pages);
    if (y.analytics?.waived != null) cfg.analytics.waived = y.analytics.waived === true;
    if (y.consent?.required != null) cfg.consent.required = y.consent.required === true;
  }

  if (fixtureEnvironment) cfg.environment = fixtureEnvironment;

  if (flags.budget) {
    if (!existsSync(flags.budget)) throw new Error(`budget file not found: ${flags.budget}`);
    const b = JSON.parse(readFileSync(flags.budget, 'utf8'));
    cfg.budgets = { ...cfg.budgets, ...b };
  }
  if (flags.env) cfg.environment = flags.env;
  if (flags.runs) cfg.runs = Number(flags.runs);
  if (flags.only) {
    cfg.only = String(flags.only).split(',').map((s) => s.trim()).filter(Boolean);
  }

  if (!VALID_ENVS.has(cfg.environment)) {
    throw new Error(`environment must be "staging" or "production", got "${cfg.environment}"`);
  }
  if (!Number.isInteger(cfg.runs) || cfg.runs < 1) {
    throw new Error(`runs must be a positive integer, got "${cfg.runs}"`);
  }
  return cfg;
}

// Load .env from cwd (if present) without overriding real environment vars.
export function loadDotEnv(dir = process.cwd()) {
  const file = `${dir}/.env`;
  if (!existsSync(file)) return;
  for (const [k, v] of Object.entries(parseDotEnv(readFileSync(file, 'utf8')))) {
    if (process.env[k] === undefined) process.env[k] = v;
  }
}
