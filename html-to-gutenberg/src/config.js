// Tiny YAML subset parser (nested maps, scalar values, comments) and .env loader.
// Deliberately small — no dependency on js-yaml (see BUILD notes in README).

import { readFileSync, existsSync } from 'node:fs';

export function parseYaml(text) {
  const root = {};
  const stack = [{ indent: -1, obj: root }];
  for (const rawLine of text.split(/\r?\n/)) {
    if (rawLine.trim() === '' || rawLine.trim().startsWith('#')) continue;
    const indent = rawLine.length - rawLine.trimStart().length;
    const m = /^([\w.-]+):\s*(.*)$/.exec(rawLine.trim());
    if (!m) continue;
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].obj;
    let value = m[2].replace(/\s+#.*$/, '').trim();
    if (value === '') {
      const obj = {};
      parent[m[1]] = obj;
      stack.push({ indent, obj });
      continue;
    }
    if (/^".*"$/.test(value) || /^'.*'$/.test(value)) value = value.slice(1, -1);
    else if (value === 'true') value = true;
    else if (value === 'false') value = false;
    else if (value === 'null' || value === '~') value = null;
    else if (/^-?\d+(\.\d+)?$/.test(value)) value = Number(value);
    parent[m[1]] = value;
  }
  return root;
}

export function loadConfig(path) {
  if (!path || !existsSync(path)) return {};
  return parseYaml(readFileSync(path, 'utf8'));
}

export function loadEnvFile(path = '.env') {
  if (!existsSync(path)) return {};
  const loaded = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2].trim();
    if (/^".*"$/.test(value) || /^'.*'$/.test(value)) value = value.slice(1, -1);
    loaded[m[1]] = value;
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
  return loaded;
}
