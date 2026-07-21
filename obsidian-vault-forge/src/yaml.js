// A small YAML subset parser + serializer, sufficient for project manifests and
// note front-matter. Supports: nested maps (indentation), block lists, lists of
// maps ("- key: val" and "- { inline }"), inline lists/maps, quoted strings,
// comments, booleans, null, numbers. Not supported: anchors, multi-line block
// scalars, multi-document streams.

export class YAMLError extends Error {}

export function parseYAML(text) {
  const lines = [];
  for (const raw of String(text).split(/\r?\n/)) {
    let line = raw.replace(/\t/g, '  ');
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    if (trimmed === '---' || trimmed === '...') continue;
    line = stripComment(line);
    if (line.trim() === '') continue;
    const indent = line.match(/^ */)[0].length;
    lines.push({ indent, text: line.trim() });
  }
  if (lines.length === 0) return {};
  const [value] = parseNode(lines, 0, lines[0].indent);
  return value;
}

function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '#' && (i === 0 || line[i - 1] === ' ')) {
      return line.slice(0, i).replace(/\s+$/, '');
    }
  }
  return line;
}

function parseNode(lines, i, indent) {
  const t = lines[i].text;
  if (t === '-' || t.startsWith('- ')) return parseList(lines, i, indent);
  return parseMap(lines, i, indent);
}

function parseMap(lines, i, indent) {
  const obj = {};
  while (
    i < lines.length &&
    lines[i].indent === indent &&
    lines[i].text !== '-' &&
    !lines[i].text.startsWith('- ')
  ) {
    const { key, rest } = splitKey(lines[i].text);
    if (rest !== null) {
      obj[key] = parseScalar(rest);
      i++;
    } else {
      i++;
      const next = lines[i];
      const nested =
        next &&
        (next.indent > indent ||
          (next.indent === indent && (next.text === '-' || next.text.startsWith('- '))));
      if (nested) {
        const [val, ni] = parseNode(lines, i, next.indent);
        obj[key] = val;
        i = ni;
      } else {
        obj[key] = null;
      }
    }
  }
  return [obj, i];
}

function parseList(lines, i, indent) {
  const arr = [];
  while (
    i < lines.length &&
    lines[i].indent === indent &&
    (lines[i].text === '-' || lines[i].text.startsWith('- '))
  ) {
    const item = lines[i].text === '-' ? '' : lines[i].text.slice(2).trim();
    if (item === '') {
      i++;
      if (i < lines.length && lines[i].indent > indent) {
        const [val, ni] = parseNode(lines, i, lines[i].indent);
        arr.push(val);
        i = ni;
      } else {
        arr.push(null);
      }
    } else if (isKeyLine(item)) {
      // Map whose first entry sits on the dash line; following keys are
      // indented past the dash.
      const childIndent =
        i + 1 < lines.length && lines[i + 1].indent > indent ? lines[i + 1].indent : indent + 2;
      const sub = [{ indent: childIndent, text: item }];
      let j = i + 1;
      while (j < lines.length && lines[j].indent > indent) {
        sub.push(lines[j]);
        j++;
      }
      const [val] = parseMap(sub, 0, childIndent);
      arr.push(val);
      i = j;
    } else {
      arr.push(parseScalar(item));
      i++;
    }
  }
  return [arr, i];
}

function isKeyLine(text) {
  if (/^["'[{]/.test(text)) return false;
  return findKeyColon(text) !== -1;
}

function findKeyColon(text) {
  for (let j = 0; j < text.length; j++) {
    if (text[j] === ':' && (j === text.length - 1 || text[j + 1] === ' ')) return j;
  }
  return -1;
}

function splitKey(text) {
  const q = text.match(/^"([^"]*)"\s*:\s*(.*)$/) || text.match(/^'([^']*)'\s*:\s*(.*)$/);
  if (q) return { key: q[1], rest: q[2] === '' ? null : q[2] };
  const idx = findKeyColon(text);
  if (idx === -1) throw new YAMLError(`Expected "key: value", got: ${text}`);
  const key = text.slice(0, idx).trim();
  const rest = text.slice(idx + 1).trim();
  return { key, rest: rest === '' ? null : rest };
}

export function parseScalar(s) {
  s = String(s).trim();
  if (s === '') return '';
  const dq = s.match(/^"((?:[^"\\]|\\.)*)"$/);
  if (dq) return dq[1].replace(/\\(.)/g, (m, c) => (c === 'n' ? '\n' : c === 't' ? '\t' : c));
  const sq = s.match(/^'(.*)'$/s);
  if (sq) return sq[1].replace(/''/g, "'");
  if (s.startsWith('[') && s.endsWith(']')) {
    try {
      const inner = s.slice(1, -1).trim();
      if (inner === '') return [];
      return splitTop(inner).map(parseScalar);
    } catch {
      return s;
    }
  }
  if (s.startsWith('{') && s.endsWith('}')) {
    try {
      const inner = s.slice(1, -1).trim();
      const obj = {};
      if (inner === '') return obj;
      for (const part of splitTop(inner)) {
        const { key, rest } = splitKey(part.trim());
        obj[key] = rest === null ? null : parseScalar(rest);
      }
      return obj;
    } catch {
      return s;
    }
  }
  if (s === 'true' || s === 'True') return true;
  if (s === 'false' || s === 'False') return false;
  if (s === 'null' || s === '~' || s === 'Null') return null;
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s);
  return s;
}

function splitTop(s) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let cur = '';
  for (const ch of s) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === '[' || ch === '{') depth++;
    if (ch === ']' || ch === '}') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim() !== '') parts.push(cur);
  return parts;
}

// ---------- serialization (used for front-matter) ----------

const PLAIN_SCALAR = /^[A-Za-z0-9][A-Za-z0-9 ._@/-]*$/;

export function scalarToYAML(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  const s = String(v);
  if (s !== '' && PLAIN_SCALAR.test(s) && !/^(true|false|null|~|-?\d+(\.\d+)?)$/i.test(s) && !/\s$/.test(s)) {
    return s;
  }
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function toYAML(value, indent = 0) {
  const pad = ' '.repeat(indent);
  let out = '';
  for (const [key, v] of Object.entries(value)) {
    if (Array.isArray(v)) {
      if (v.length === 0) {
        out += `${pad}${key}: []\n`;
      } else if (v.every((x) => typeof x !== 'object' || x === null)) {
        out += `${pad}${key}: [${v.map(scalarToYAML).join(', ')}]\n`;
      } else {
        out += `${pad}${key}:\n`;
        for (const item of v) {
          out += `${pad}  - { ${Object.entries(item)
            .map(([k, x]) => `${k}: ${scalarToYAML(x)}`)
            .join(', ')} }\n`;
        }
      }
    } else if (v !== null && typeof v === 'object') {
      out += `${pad}${key}:\n${toYAML(v, indent + 2)}`;
    } else {
      out += `${pad}${key}: ${scalarToYAML(v)}\n`;
    }
  }
  return out;
}
