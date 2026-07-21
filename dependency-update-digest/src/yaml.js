// Minimal YAML loader — supports the small, flat config shapes this app uses:
// nested maps by indentation, block lists ("- item"), inline flow maps
// `{ a: b, c: [x, y] }`, inline flow lists `[a, b]`, quoted strings, comments,
// and scalar coercion (bool / null / number). Intentionally NOT a full YAML
// implementation (no anchors, multi-line strings, multi-doc, etc.).

export function parseYaml(text) {
  const lines = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const stripped = stripComment(raw);
    if (stripped.trim() === '') continue;
    lines.push({
      indent: raw.length - raw.trimStart().length,
      text: stripped.trim(),
    });
  }
  if (lines.length === 0) return {};

  let pos = 0;

  function parseBlock(indent) {
    if (pos >= lines.length) return null;
    return isListItem(lines[pos].text) ? parseList(indent) : parseMap(indent);
  }

  function parseMap(indent) {
    const obj = {};
    while (pos < lines.length && lines[pos].indent === indent && !isListItem(lines[pos].text)) {
      const { text } = lines[pos];
      const idx = keyColonIndex(text);
      if (idx === -1) throw new Error(`Invalid YAML mapping line: "${text}"`);
      const key = unquote(text.slice(0, idx).trim());
      const rest = text.slice(idx + 1).trim();
      pos++;
      if (rest === '') {
        if (pos < lines.length && lines[pos].indent > indent) {
          obj[key] = parseBlock(lines[pos].indent);
        } else {
          obj[key] = null;
        }
      } else {
        obj[key] = parseInline(rest);
      }
    }
    return obj;
  }

  function parseList(indent) {
    const arr = [];
    while (pos < lines.length && lines[pos].indent === indent && isListItem(lines[pos].text)) {
      const rest = lines[pos].text.replace(/^-\s*/, '');
      pos++;
      if (rest === '') {
        if (pos < lines.length && lines[pos].indent > indent) {
          arr.push(parseBlock(lines[pos].indent));
        } else {
          arr.push(null);
        }
      } else if (opensBlockMap(rest)) {
        // "- key: value" opens a map; following keys sit at a deeper indent.
        const childIndent =
          pos < lines.length && lines[pos].indent > indent ? lines[pos].indent : indent + 2;
        lines.splice(pos, 0, { indent: childIndent, text: rest });
        arr.push(parseMap(childIndent));
      } else {
        arr.push(parseInline(rest));
      }
    }
    return arr;
  }

  const doc = parseBlock(lines[0].indent);
  if (pos < lines.length) {
    throw new Error(`Unexpected YAML at line: "${lines[pos].text}" (check indentation)`);
  }
  return doc;
}

function isListItem(text) {
  return text === '-' || text.startsWith('- ');
}

function opensBlockMap(rest) {
  if (rest.startsWith('{') || rest.startsWith('[') || rest.startsWith('"') || rest.startsWith("'")) {
    return false;
  }
  // "key:" followed by whitespace or end-of-line ("https://x" must not match).
  return /^[^\s:{}[\],]+:(\s|$)/.test(rest);
}

function keyColonIndex(text) {
  let inS = false;
  let inD = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "'" && !inD) inS = !inS;
    else if (c === '"' && !inS) inD = !inD;
    else if (c === ':' && !inS && !inD) {
      const next = text[i + 1];
      if (next === undefined || next === ' ' || next === '\t') return i;
    }
  }
  return -1;
}

export function parseInline(s) {
  s = s.trim();
  if (s.startsWith('{')) {
    if (!s.endsWith('}')) throw new Error(`Unterminated flow map: "${s}"`);
    const obj = {};
    for (const part of splitTop(s.slice(1, -1))) {
      if (part.trim() === '') continue;
      const idx = flowColonIndex(part);
      if (idx === -1) throw new Error(`Invalid flow map entry: "${part}"`);
      obj[unquote(part.slice(0, idx).trim())] = parseInline(part.slice(idx + 1));
    }
    return obj;
  }
  if (s.startsWith('[')) {
    if (!s.endsWith(']')) throw new Error(`Unterminated flow list: "${s}"`);
    return splitTop(s.slice(1, -1))
      .filter((p) => p.trim() !== '')
      .map((p) => parseInline(p));
  }
  return coerceScalar(s);
}

function flowColonIndex(part) {
  let depth = 0;
  let inS = false;
  let inD = false;
  for (let i = 0; i < part.length; i++) {
    const c = part[i];
    if (c === "'" && !inD) inS = !inS;
    else if (c === '"' && !inS) inD = !inD;
    else if (!inS && !inD) {
      if (c === '{' || c === '[') depth++;
      else if (c === '}' || c === ']') depth--;
      else if (c === ':' && depth === 0) {
        const next = part[i + 1];
        if (next === undefined || next === ' ' || next === '\t') return i;
      }
    }
  }
  return -1;
}

function splitTop(s) {
  const parts = [];
  let depth = 0;
  let inS = false;
  let inD = false;
  let cur = '';
  for (const c of s) {
    if (c === "'" && !inD) inS = !inS;
    if (c === '"' && !inS) inD = !inD;
    if (!inS && !inD) {
      if (c === '{' || c === '[') depth++;
      if (c === '}' || c === ']') depth--;
      if (c === ',' && depth === 0) {
        parts.push(cur);
        cur = '';
        continue;
      }
    }
    cur += c;
  }
  if (cur.trim() !== '' || parts.length > 0) parts.push(cur);
  return parts;
}

function stripComment(line) {
  let inS = false;
  let inD = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "'" && !inD) inS = !inS;
    else if (c === '"' && !inS) inD = !inD;
    else if (c === '#' && !inS && !inD && (i === 0 || line[i - 1] === ' ' || line[i - 1] === '\t')) {
      return line.slice(0, i);
    }
  }
  return line;
}

function unquote(s) {
  if (
    (s.startsWith('"') && s.endsWith('"') && s.length >= 2) ||
    (s.startsWith("'") && s.endsWith("'") && s.length >= 2)
  ) {
    return s.slice(1, -1);
  }
  return s;
}

function coerceScalar(s) {
  const u = unquote(s);
  if (u !== s) return u; // was quoted: always a string
  if (s === 'true' || s === 'True') return true;
  if (s === 'false' || s === 'False') return false;
  if (s === 'null' || s === '~' || s === 'Null') return null;
  if (/^-?\d+$/.test(s)) return Number(s);
  if (/^-?\d+\.\d+$/.test(s)) return Number(s);
  return s;
}
