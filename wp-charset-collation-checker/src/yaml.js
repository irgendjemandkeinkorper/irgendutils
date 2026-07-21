// Minimal YAML subset parser — enough for this app's flat/nested config files.
// Supports: nested maps by indentation, inline arrays [a,b], block lists
// ("- item"), quoted strings, numbers, booleans, null, and # comments.
// Intentionally NOT a general YAML implementation (zero-dependency house rule).

function stripComment(line) {
  // Strip a trailing comment unless the # sits inside quotes.
  let inS = false;
  let inD = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "'" && !inD) inS = !inS;
    else if (ch === '"' && !inS) inD = !inD;
    else if (ch === '#' && !inS && !inD && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i).trimEnd();
    }
  }
  return line.trimEnd();
}

function coerce(value) {
  const v = value.trim();
  if (v === '') return null;
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null' || v === '~') return null;
  if (/^-?\d+$/.test(v)) return Number.parseInt(v, 10);
  if (/^-?\d+\.\d+$/.test(v)) return Number.parseFloat(v);
  if (v.startsWith('[') && v.endsWith(']')) {
    const inner = v.slice(1, -1).trim();
    return inner === '' ? [] : inner.split(',').map((s) => coerce(s));
  }
  return v;
}

export function parseYaml(text) {
  const root = {};
  // Each frame: { indent, node, parent, key } — parent/key let us swap an
  // empty-map placeholder for an array when a "- item" list shows up.
  const stack = [{ indent: -1, node: root, parent: null, key: null }];

  for (const rawLine of String(text).split(/\r?\n/)) {
    if (!rawLine.trim() || rawLine.trim().startsWith('#')) continue;
    const indent = rawLine.match(/^ */)[0].length;
    const line = stripComment(rawLine.trim());
    if (!line) continue;

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const frame = stack[stack.length - 1];

    if (line.startsWith('- ') || line === '-') {
      let container = frame.node;
      if (!Array.isArray(container)) {
        if (frame.parent && typeof container === 'object' && Object.keys(container).length === 0) {
          container = [];
          frame.parent[frame.key] = container;
          frame.node = container;
        } else {
          throw new Error(`yaml: unexpected list item at "${rawLine}"`);
        }
      }
      container.push(coerce(line === '-' ? '' : line.slice(2)));
      continue;
    }

    const m = line.match(/^([^:]+):(.*)$/);
    if (!m) throw new Error(`yaml: cannot parse line "${rawLine}"`);
    const key = coerce(m[1]);
    const rest = m[2].trim();
    if (Array.isArray(frame.node)) throw new Error(`yaml: map entry inside list at "${rawLine}"`);

    if (rest === '') {
      const child = {};
      frame.node[key] = child;
      stack.push({ indent, node: child, parent: frame.node, key });
    } else {
      frame.node[key] = coerce(rest);
    }
  }
  return root;
}
