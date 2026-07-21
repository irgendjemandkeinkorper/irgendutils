// Tiny YAML loader — just enough for smoke.yml.
//
// Supported grammar (deliberately small):
//   key: scalar                     top-level scalars (string/number/bool/null)
//   key:                            top-level key introducing a list
//     - { k: v, k2: "v2" }          list items as inline flow maps
//     - scalar                      or plain scalars
//   # comments, full-line and trailing (outside quotes)
//
// Not supported (and not needed here): nested block maps, anchors, multi-line
// strings, multi-document files. Fails loudly on anything it can't parse.

export function parseYaml(text) {
  const root = {};
  let listKey = null;
  const lines = String(text).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = stripComment(lines[i]);
    const t = line.trim();
    if (!t) continue;
    if (t === '---') continue;

    if (t.startsWith('- ') || t === '-') {
      if (!listKey) throw new Error(`smoke.yml line ${i + 1}: list item without a preceding "key:"`);
      root[listKey].push(t === '-' ? null : parseValue(t.slice(2).trim(), i + 1));
      continue;
    }

    const m = t.match(/^([A-Za-z0-9_.-]+):(?:\s+(.*))?$/);
    if (!m) throw new Error(`smoke.yml line ${i + 1}: cannot parse "${t}"`);
    const key = m[1];
    const rest = (m[2] ?? '').trim();
    if (rest === '') {
      root[key] = [];
      listKey = key;
    } else {
      root[key] = parseValue(rest, i + 1);
      listKey = null;
    }
  }
  return root;
}

function stripComment(line) {
  let inQuote = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      if (ch === '\\') i++;
      else if (ch === inQuote) inQuote = null;
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (ch === '#' && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i);
    }
  }
  return line;
}

function parseValue(str, lineNo) {
  if (str.startsWith('{')) return parseFlowMap(str, lineNo);
  if (str.startsWith('[')) return parseFlowList(str, lineNo);
  return parseScalar(str);
}

function parseFlowMap(str, lineNo) {
  if (!str.endsWith('}')) throw new Error(`smoke.yml line ${lineNo}: unterminated { ... }`);
  const inner = str.slice(1, -1).trim();
  const map = {};
  if (!inner) return map;
  for (const part of splitTop(inner)) {
    const idx = indexOfTopColon(part);
    if (idx === -1) throw new Error(`smoke.yml line ${lineNo}: expected "key: value" in "${part}"`);
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    map[key] = parseValue(val, lineNo);
  }
  return map;
}

function parseFlowList(str, lineNo) {
  if (!str.endsWith(']')) throw new Error(`smoke.yml line ${lineNo}: unterminated [ ... ]`);
  const inner = str.slice(1, -1).trim();
  if (!inner) return [];
  return splitTop(inner).map((p) => parseValue(p.trim(), lineNo));
}

// Split on commas at nesting depth 0, respecting quotes.
function splitTop(str) {
  const parts = [];
  let depth = 0;
  let inQuote = null;
  let cur = '';
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (inQuote) {
      cur += ch;
      if (ch === '\\') { cur += str[++i] ?? ''; }
      else if (ch === inQuote) inQuote = null;
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
      cur += ch;
    } else if (ch === '{' || ch === '[') {
      depth++;
      cur += ch;
    } else if (ch === '}' || ch === ']') {
      depth--;
      cur += ch;
    } else if (ch === ',' && depth === 0) {
      parts.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

// First ':' outside quotes that is followed by whitespace/end or starts the value
// (handles values like URLs "https://..." only when key is unquoted before it).
function indexOfTopColon(str) {
  let inQuote = null;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (inQuote) {
      if (ch === '\\') i++;
      else if (ch === inQuote) inQuote = null;
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (ch === ':') {
      return i;
    }
  }
  return -1;
}

function parseScalar(str) {
  const s = str.trim();
  if (s === '' || s === '~' || s === 'null') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    const inner = s.slice(1, -1);
    return s[0] === '"' ? inner.replace(/\\(["\\])/g, '$1') : inner;
  }
  if (/^-?\d+$/.test(s)) return Number.parseInt(s, 10);
  if (/^-?\d+\.\d+$/.test(s)) return Number.parseFloat(s);
  return s;
}

// Tiny .env parser: KEY=value lines, '#' comments, optional surrounding quotes.
export function parseDotEnv(text) {
  const out = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[m[1]] = val;
  }
  return out;
}
