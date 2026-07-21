// Config + .env loading and validation. Secrets never live in the config
// file — the config only NAMES the env var to read (rest.app_password_env).

import { readFileSync, existsSync } from 'node:fs';
import { parseYaml } from './yaml.js';

export class ConfigError extends Error {}

const MODES = ['multisite', 'standalone'];
const DNS_PROVIDERS = ['cloudflare', 'route53', 'manual'];

/** Parse a .env file and set values into `env` for keys not already set. */
export function loadEnvFile(path, env = process.env) {
  if (!existsSync(path)) return env;
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let value = m[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(m[1] in env)) env[m[1]] = value;
  }
  return env;
}

/** Validate and normalize a parsed config object. Throws ConfigError. */
export function validateConfig(raw) {
  const errors = [];
  const config = { template_slug: '_template', ...raw };

  if (!MODES.includes(config.mode)) {
    errors.push(`mode must be one of ${MODES.join(' | ')} (got ${JSON.stringify(config.mode ?? null)})`);
  }
  if (!config.network_url || typeof config.network_url !== 'string') {
    errors.push('network_url is required (e.g. https://example.com)');
  } else if (!/^https?:\/\//.test(config.network_url)) {
    errors.push('network_url must be an http(s) URL');
  }
  if (!config.rest || typeof config.rest !== 'object') {
    errors.push('rest section is required (base_url, user, app_password_env)');
  } else {
    if (!config.rest.base_url || !String(config.rest.base_url).includes('{sub}')) {
      errors.push('rest.base_url must contain the {sub} placeholder (e.g. https://{sub}.example.com)');
    }
    if (!config.rest.user) errors.push('rest.user is required');
    if (!config.rest.app_password_env) {
      errors.push('rest.app_password_env is required (name of the env var holding the app password)');
    }
    if (config.rest.app_password && String(config.rest.app_password).trim() !== '') {
      errors.push('rest.app_password must NOT be set in the config — secrets come from env only');
    }
  }
  if (config.dns != null) {
    if (typeof config.dns !== 'object') {
      errors.push('dns must be a map (provider, zone)');
    } else {
      if (!DNS_PROVIDERS.includes(config.dns.provider)) {
        errors.push(`dns.provider must be one of ${DNS_PROVIDERS.join(' | ')} (got ${JSON.stringify(config.dns.provider ?? null)})`);
      }
      if (!config.dns.zone) errors.push('dns.zone is required when dns is configured');
    }
  }

  if (errors.length > 0) {
    throw new ConfigError(`Invalid config:\n  - ${errors.join('\n  - ')}`);
  }
  return config;
}

/** Load, parse and validate a YAML config file. */
export function loadConfig(path) {
  if (!existsSync(path)) {
    throw new ConfigError(
      `Config file not found: ${path}\n` +
        'Copy config.example.yml to config.yml (or pass --config <path>).'
    );
  }
  let parsed;
  try {
    parsed = parseYaml(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new ConfigError(`Could not parse ${path}: ${err.message}`);
  }
  return validateConfig(parsed);
}

/** Read the app password from the env var the config names. Never logged. */
export function resolveAppPassword(config, env = process.env) {
  const name = config.rest.app_password_env;
  return env[name] || null;
}
