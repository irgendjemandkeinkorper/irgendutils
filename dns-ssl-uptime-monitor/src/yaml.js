// Minimal YAML loader for the small, flat configs this app uses.
// Supports: nested mappings by indentation, block lists ("- item", "- key: value"),
// inline lists [a, b], inline maps { k: v }, quoted strings, numbers, booleans,
// null/~, and "#" comments. Not a general YAML parser — no anchors, multi-line
// scalars, or flow nesting beyond one level of [ ] / { }.

export function parseYaml(text) {
  const tokens = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = stripComment(raw.replace(/\t/g, '  '));
    if (!line.trim()) continue;
    const indent = line.match(/^ */)[0].length;
    tokens.push({ indent, text: line.trim() });
  }
  if (!tokens.length) return {};
  const [value] = parseBlock(tokens, 0, -1);
  return value ?? {};
}

function stripComment(line) {
  let inS = false;
  let inD = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "'" && !inD) inS = !inS;
    else if (c === '"' && !inS) inD = !inD;
    else if (c === '#' && !inS && !inD && (i === 0 || line[i - 1] === ' ')) {
      return line.slice(0, i);
    }
  }
  return line;
}

function isListItem(t) {
  return t === '-' || t.startsWith('- ');
}

function parseBlock(tokens, i, parentIndent) {
  if (i >= tokens.length || tokens[i].indent <= parentIndent) return [null, i];
  const indent = tokens[i].indent;
  if (isListItem(tokens[i].text)) return parseList(tokens, i, indent);
  return parseMap(tokens, i, indent);
}

function parseList(tokens, i, indent) {
  const out = [];
  while (i < tokens.length && tokens[i].indent === indent && isListItem(tokens[i].text)) {
    const rest = tokens[i].text === '-' ? '' : tokens[i].text.slice(2).trim();
    if (!rest) {
      const [val, next] = parseBlock(tokens, i + 1, indent);
      out.push(val);
      i = next;
    } else if (splitKey(rest)) {
      // "- key: value" list item, possibly continued by deeper-indented keys.
      const synth = [{ indent: indent + 2, text: rest }];
      let j = i + 1;
      while (j < tokens.length && tokens[j].indent > indent) {
        synth.push(tokens[j]);
        j++;
      }
      const [val] = parseMap(synth, 0, synth[0].indent);
      out.push(val);
      i = j;
    } else {
      out.push(parseScalar(rest));
      i++;
    }
  }
  return [out, i];
}

function parseMap(tokens, i, indent) {
  const out = {};
  while (i < tokens.length && tokens[i].indent === indent && !isListItem(tokens[i].text)) {
    const kv = splitKey(tokens[i].text);
    if (!kv) {
      i++;
      continue;
    }
    const [key, rawVal] = kv;
    if (rawVal !== '') {
      out[unquote(key)] = parseScalar(rawVal);
      i++;
    } else {
      const [val, next] = parseBlock(tokens, i + 1, indent);
      out[unquote(key)] = val;
      i = next;
    }
  }
  return [out, i];
}

// Split "key: value" / "key:" at the first colon followed by a space or EOL.
// Returns null when the line is not a key line (e.g. "https://example.com").
function splitKey(s) {
  for (let i = 0; i < s.length; i++) {
    if (s[i] === ':' && (i === s.length - 1 || s[i + 1] === ' ')) {
      const key = s.slice(0, i).trim();
      if (!key) return null;
      return [key, s.slice(i + 1).trim()];
    }
  }
  return null;
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
    return inner === '' ? [] : splitTop(inner).map(parseScalar);
  }
  if (s.startsWith('{') && s.endsWith('}')) {
    const out = {};
    const inner = s.slice(1, -1).trim();
    if (inner === '') return out;
    for (const part of splitTop(inner)) {
      const kv = splitKey(part.trim());
      if (kv) out[unquote(kv[0])] = parseScalar(kv[1]);
    }
    return out;
  }
  if ((s[0] === '"' && s.at(-1) === '"') || (s[0] === "'" && s.at(-1) === "'")) return unquote(s);
  if (s === 'null' || s === '~') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?\d*\.\d+$/.test(s)) return parseFloat(s);
  return s;
}

// Split on commas at bracket/quote depth zero.
function splitTop(s) {
  const parts = [];
  let depth = 0;
  let inS = false;
  let inD = false;
  let cur = '';
  for (const c of s) {
    if (c === "'" && !inD) inS = !inS;
    else if (c === '"' && !inS) inD = !inD;
    else if (!inS && !inD) {
      if (c === '[' || c === '{') depth++;
      else if (c === ']' || c === '}') depth--;
      else if (c === ',' && depth === 0) {
        parts.push(cur.trim());
        cur = '';
        continue;
      }
    }
    cur += c;
  }
  if (cur.trim() !== '') parts.push(cur.trim());
  return parts;
}
