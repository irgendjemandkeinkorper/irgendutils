// Minimal YAML loader — enough for this app's flat/nested config files.
// Supports: nested maps by indentation, scalars (string/number/bool/null),
// quoted strings, comments, block lists of scalars, inline [a, b] lists.
// Not a general YAML implementation (no anchors, multi-line strings, etc.).

export function parseYaml(text) {
  const lines = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = stripComment(raw.replace(/\t/g, '  '));
    if (!line.trim()) continue;
    lines.push({ indent: /^ */.exec(line)[0].length, text: line.trim() });
  }
  if (!lines.length) return {};
  const [value] = parseBlock(lines, 0, lines[0].indent);
  return value ?? {};
}

function parseBlock(lines, i, indent) {
  if (i >= lines.length) return [null, i];
  if (lines[i].text.startsWith('- ') || lines[i].text === '-') {
    const list = [];
    while (i < lines.length && lines[i].indent === indent && (lines[i].text.startsWith('- ') || lines[i].text === '-')) {
      const rest = lines[i].text.replace(/^-\s*/, '');
      i += 1;
      if (rest === '') {
        if (i < lines.length && lines[i].indent > indent) {
          const [v, ni] = parseBlock(lines, i, lines[i].indent);
          list.push(v);
          i = ni;
        } else list.push(null);
      } else {
        list.push(parseScalar(rest));
      }
    }
    return [list, i];
  }
  const obj = {};
  while (i < lines.length && lines[i].indent === indent && !lines[i].text.startsWith('- ')) {
    const m = /^(?:"([^"]*)"|'([^']*)'|([^:]+)):\s*(.*)$/.exec(lines[i].text);
    if (!m) throw new Error(`yaml: cannot parse line: ${lines[i].text}`);
    const key = (m[1] ?? m[2] ?? m[3]).trim();
    const rest = m[4];
    i += 1;
    if (rest === '') {
      if (i < lines.length && lines[i].indent > indent) {
        const [v, ni] = parseBlock(lines, i, lines[i].indent);
        obj[key] = v;
        i = ni;
      } else {
        obj[key] = null;
      }
    } else {
      obj[key] = parseScalar(rest);
    }
  }
  return [obj, i];
}

function parseScalar(s) {
  const t = s.trim();
  if (/^".*"$/.test(t)) return t.slice(1, -1);
  if (/^'.*'$/.test(t)) return t.slice(1, -1);
  if (t === 'null' || t === '~') return null;
  if (t === 'true' || t === 'yes') return true;
  if (t === 'false' || t === 'no') return false;
  if (/^\[.*\]$/.test(t)) {
    const inner = t.slice(1, -1).trim();
    return inner ? inner.split(',').map((x) => parseScalar(x)) : [];
  }
  if (/^-?\d+$/.test(t)) return parseInt(t, 10);
  if (/^-?\d+\.\d+$/.test(t)) return parseFloat(t);
  return t;
}

function stripComment(line) {
  let inS = false;
  let inD = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (c === "'" && !inD) inS = !inS;
    else if (c === '"' && !inS) inD = !inD;
    else if (c === '#' && !inS && !inD && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i);
    }
  }
  return line;
}
