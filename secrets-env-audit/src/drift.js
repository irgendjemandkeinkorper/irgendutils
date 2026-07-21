// Part B — env drift: key union across env files, missing keys, and value
// SHAPE differences. Actual values are never printed, compared, or stored
// in findings — only presence and shape.

import { readFileSync, existsSync } from 'node:fs';
import { parseEnv } from './envfile.js';
import { expandPath } from './scan.js';

export function classifyShape(value) {
  const v = String(value ?? '').trim();
  if (v === '') return 'empty';
  if (/^(true|false|yes|no|on|off)$/i.test(v)) return 'bool';
  if (/^-?\d+(\.\d+)?$/.test(v)) return 'number';
  if (/^[a-z][a-z0-9+.-]*:\/\/\S+$/i.test(v)) return 'url';
  return 'string';
}

// envs: [{ name, keys: { KEY: value } }]
export function computeDrift(envs, compare = 'keys_and_shape') {
  const findings = [];
  const allKeys = new Set();
  for (const env of envs) for (const k of Object.keys(env.keys)) allKeys.add(k);

  for (const key of [...allKeys].sort()) {
    const presentIn = envs.filter((e) => key in e.keys).map((e) => e.name);
    const missingIn = envs.filter((e) => !(key in e.keys)).map((e) => e.name);
    if (missingIn.length > 0) {
      findings.push({
        part: 'drift',
        rule: 'missing_key',
        severity: 'medium',
        confidence: 'high',
        key,
        presentIn,
        missingIn,
        masked: `key ${key}: present in [${presentIn.join(', ')}], missing in [${missingIn.join(', ')}]`,
        remediation: `Add ${key} to ${missingIn.join(', ')} (or remove it everywhere if obsolete).`,
      });
    }
    if (compare === 'keys_and_shape' && presentIn.length > 1) {
      const shapes = {};
      for (const env of envs) if (key in env.keys) shapes[env.name] = classifyShape(env.keys[key]);
      const distinct = new Set(Object.values(shapes));
      if (distinct.size > 1) {
        const detail = Object.entries(shapes).map(([n, s]) => `${n}=${s}`).join(', ');
        findings.push({
          part: 'drift',
          rule: 'shape_mismatch',
          severity: 'medium',
          confidence: 'medium',
          key,
          shapes,
          masked: `key ${key}: value shape differs (${detail})`,
          remediation: `Check ${key} in each env — same kind of value expected everywhere (values themselves not compared).`,
        });
      }
    }
  }
  return findings;
}

export function runDrift(config, { baseDir = process.cwd() } = {}) {
  const cfg = config.env_drift ?? {};
  const declared = cfg.envs ?? [];
  const warnings = [];
  const envs = [];
  for (const e of declared) {
    const path = expandPath(e.file, baseDir);
    if (!existsSync(path)) {
      warnings.push(`env file not found for "${e.name}": ${path}`);
      continue;
    }
    envs.push({ name: e.name, keys: parseEnv(readFileSync(path, 'utf8')) });
  }
  if (envs.length < 2) {
    warnings.push('env drift needs at least two readable env files; nothing compared');
    return { findings: [], warnings };
  }
  return { findings: computeDrift(envs, cfg.compare ?? 'keys_and_shape'), warnings };
}
