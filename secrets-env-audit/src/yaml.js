// Minimal YAML parser — enough for secaudit's small, flat config files.
// Supports: nested maps by indentation, block lists ("- item"), inline
// arrays [a, b], inline maps { k: v }, quoted strings, numbers, booleans,
// null (~ / null), and "#" comments. No anchors, no multi-line scalars.

export function parseYAML(text) {
  const lines = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const stripped = stripComment(raw);
    if (!stripped.trim()) continue;
    lines.push({ indent: raw.match(/^ */)[0].length, text: stripped.trim() });
  }
  let i = 0;

  function parseBlock() {
    if (i >= lines.length) return null;
    return isListItem(lines[i].text) ? parseList(lines[i].indent) : parseMap(lines[i].indent);
  }

  function parseMap(indent) {
    const obj = {};
    while (i < lines.length && lines[i].indent === indent && !isListItem(lines[i].text)) {
      const m = lines[i].text.match(/^([^:]+):\s*(.*)$/);
      if (!m) throw new Error(`YAML: expected "key: value" at "${lines[i].text}"`);
      const key = unquote(m[1].trim());
      const rest = m[2].trim();
      i++;
      if (rest === '') {
        obj[key] = i < lines.length && lines[i].indent > indent ? parseBlock() : null;
      } else {
        obj[key] = parseScalar(rest);
      }
    }
    return obj;
  }

  function parseList(indent) {
    const arr = [];
    while (i < lines.length && lines[i].indent === indent && isListItem(lines[i].text)) {
      const rest = lines[i].text === '-' ? '' : lines[i].text.slice(2).trim();
      i++;
      if (rest === '') {
        arr.push(i < lines.length && lines[i].indent > indent ? parseBlock() : null);
      } else if (/^[^:{["']+:(\s|$)/.test(rest)) {
        // "- key: value" — a map starting inline on the list item line
        const m = rest.match(/^([^:]+):\s*(.*)$/);
        const item = {};
        item[unquote(m[1].trim())] = m[2].trim() === '' ? null : parseScalar(m[2].trim());
        if (i < lines.length && lines[i].indent > indent && !isListItem(lines[i].text)) {
          Object.assign(item, parseMap(lines[i].indent));
        }
        arr.push(item);
      } else {
        arr.push(parseScalar(rest));
      }
    }
    return arr;
  }

  const result = parseBlock();
  if (i < lines.length) throw new Error(`YAML: unparsed content at "${lines[i].text}" (check indentation)`);
  return result;
}

function isListItem(text) {
  return text === '-' || text.startsWith('- ');
}

function stripComment(line) {
  let inS = false, inD = false;
  for (let j = 0; j < line.length; j++) {
    const c = line[j];
    if (c === "'" && !inD) inS = !inS;
    else if (c === '"' && !inS) inD = !inD;
    else if (c === '#' && !inS && !inD && (j === 0 || /\s/.test(line[j - 1]))) {
      return line.slice(0, j);
    }
  }
  return line;
}

function parseScalar(s) {
  s = s.trim();
  if (s.startsWith('[') && s.endsWith(']')) {
    const inner = s.slice(1, -1).trim();
    return inner === '' ? [] : splitTop(inner).map(parseScalar);
  }
  if (s.startsWith('{') && s.endsWith('}')) {
    const obj = {};
    const inner = s.slice(1, -1).trim();
    if (inner === '') return obj;
    for (const pair of splitTop(inner)) {
      const idx = pair.indexOf(':');
      if (idx === -1) throw new Error(`YAML: bad inline map entry "${pair}"`);
      obj[unquote(pair.slice(0, idx).trim())] = parseScalar(pair.slice(idx + 1));
    }
    return obj;
  }
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return unquote(s);
  }
  if (s === 'true' || s === 'True') return true;
  if (s === 'false' || s === 'False') return false;
  if (s === 'null' || s === '~' || s === '') return null;
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s);
  return s;
}

// Split on top-level commas (not inside quotes, brackets, or braces).
function splitTop(s) {
  const parts = [];
  let depth = 0, inS = false, inD = false, cur = '';
  for (const c of s) {
    if (c === "'" && !inD) inS = !inS;
    else if (c === '"' && !inS) inD = !inD;
    else if (!inS && !inD && (c === '[' || c === '{')) depth++;
    else if (!inS && !inD && (c === ']' || c === '}')) depth--;
    if (c === ',' && depth === 0 && !inS && !inD) {
      parts.push(cur.trim());
      cur = '';
    } else {
      cur += c;
    }
  }
  if (cur.trim() !== '') parts.push(cur.trim());
  return parts;
}

function unquote(s) {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}
