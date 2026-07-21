// Minimal YAML subset parser — enough for qa.config.yml (nested maps, lists of
// scalars, inline arrays, comments, quoted strings). Intentionally tiny so the
// app has zero runtime dependencies.

export function parseYaml(text) {
  const lines = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const noComment = stripComment(raw);
    if (noComment.trim() === '') continue;
    const indent = noComment.match(/^ */)[0].length;
    lines.push({ indent, content: noComment.trim() });
  }
  if (lines.length === 0) return {};
  const [value] = parseBlock(lines, 0, lines[0].indent);
  return value ?? {};
}

function stripComment(line) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === '#' && !inSingle && !inDouble && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i);
    }
  }
  return line;
}

function isListItem(content) {
  return content === '-' || content.startsWith('- ');
}

function parseBlock(lines, i, indent) {
  if (isListItem(lines[i].content)) return parseList(lines, i, indent);
  return parseMap(lines, i, indent);
}

function parseList(lines, i, indent) {
  const arr = [];
  while (i < lines.length && lines[i].indent === indent && isListItem(lines[i].content)) {
    const item = lines[i].content === '-' ? '' : lines[i].content.slice(2).trim();
    arr.push(parseScalar(item));
    i++;
  }
  return [arr, i];
}

function parseMap(lines, i, indent) {
  const obj = {};
  while (i < lines.length && lines[i].indent === indent && !isListItem(lines[i].content)) {
    const line = lines[i].content;
    const m = line.match(/^("[^"]*"|'[^']*'|[^:]+):\s*(.*)$/);
    if (!m) throw new Error(`yaml: cannot parse line: "${line}"`);
    const key = unquote(m[1].trim());
    const rest = m[2].trim();
    if (rest === '') {
      // nested block: deeper indent, or a list at the same indent
      if (i + 1 < lines.length && lines[i + 1].indent > indent) {
        const [val, next] = parseBlock(lines, i + 1, lines[i + 1].indent);
        obj[key] = val;
        i = next;
      } else if (i + 1 < lines.length && lines[i + 1].indent === indent && isListItem(lines[i + 1].content)) {
        const [val, next] = parseList(lines, i + 1, indent);
        obj[key] = val;
        i = next;
      } else {
        obj[key] = null;
        i++;
      }
    } else {
      obj[key] = parseScalar(rest);
      i++;
    }
  }
  return [obj, i];
}

function splitTop(s) {
  const parts = [];
  let depth = 0;
  let cur = '';
  let quote = null;
  for (const c of s) {
    if (quote) {
      cur += c;
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
      cur += c;
    } else if (c === '[' || c === '{') {
      depth++;
      cur += c;
    } else if (c === ']' || c === '}') {
      depth--;
      cur += c;
    } else if (c === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  if (cur.trim() !== '') parts.push(cur);
  return parts;
}

function unquote(s) {
  if (s.length >= 2 && ((s[0] === '"' && s.at(-1) === '"') || (s[0] === "'" && s.at(-1) === "'"))) {
    return s.slice(1, -1);
  }
  return s;
}

export function parseScalar(s) {
  s = s.trim();
  if (s === '') return null;
  if (s.startsWith('[') && s.endsWith(']')) {
    const inner = s.slice(1, -1).trim();
    if (inner === '') return [];
    return splitTop(inner).map((p) => parseScalar(p));
  }
  const uq = unquote(s);
  if (uq !== s) return uq;
  if (s === 'null' || s === '~') return null;
  if (s === 'true' || s === 'yes') return true;
  if (s === 'false' || s === 'no') return false;
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?(\d+\.\d*|\.\d+)$/.test(s)) return parseFloat(s);
  return s;
}
