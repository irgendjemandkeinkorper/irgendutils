// Minimal YAML loader for small, flat configs (2-space nested maps, scalar
// lists, comments). Intentionally tiny — do not feed it anchors/multiline.

function parseScalar(raw) {
  const s = raw.trim();
  if (s === '' || s === '~' || s === 'null') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

export function parseYaml(text) {
  const root = {};
  const stack = [{ indent: -1, node: root }];

  for (const rawLine of String(text).split(/\r?\n/)) {
    const noComment = rawLine.replace(/(^|\s)#.*$/, '');
    if (!noComment.trim()) continue;
    const indent = noComment.match(/^ */)[0].length;
    const line = noComment.trim();

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].node;

    if (line.startsWith('- ')) {
      if (!Array.isArray(parent.__list)) parent.__list = [];
      parent.__list.push(parseScalar(line.slice(2)));
      continue;
    }

    const m = line.match(/^([^:]+):\s*(.*)$/);
    if (!m) continue;
    const key = parseScalar(m[1]);
    const value = m[2];

    if (value === '') {
      const child = {};
      parent[key] = child;
      stack.push({ indent, node: child });
    } else {
      parent[key] = parseScalar(value);
    }
  }

  // Collapse {__list: [...]} placeholders into real arrays.
  const collapse = (node) => {
    if (node === null || typeof node !== 'object') return node;
    const keys = Object.keys(node);
    if (keys.length === 1 && keys[0] === '__list') return node.__list;
    for (const k of keys) node[k] = collapse(node[k]);
    return node;
  };
  return collapse(root);
}

// Tiny .env parser: KEY=value lines, # comments, optional quotes.
export function parseDotEnv(text) {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}
