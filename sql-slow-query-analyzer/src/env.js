// Tiny .env loader. Existing process.env values always win — a .env file can
// only fill gaps, never override the real environment.
import fs from 'node:fs';

export function parseDotEnv(text) {
  const out = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let val = m[2].trim();
    if (/^".*"$/.test(val) || /^'.*'$/.test(val)) val = val.slice(1, -1);
    else val = val.replace(/\s+#.*$/, '').trim();
    out[m[1]] = val;
  }
  return out;
}

export function loadDotEnv(path = '.env', env = process.env) {
  if (!fs.existsSync(path)) return env;
  const parsed = parseDotEnv(fs.readFileSync(path, 'utf8'));
  for (const [k, v] of Object.entries(parsed)) {
    if (env[k] === undefined) env[k] = v;
  }
  return env;
}
