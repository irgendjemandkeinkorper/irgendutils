// Minimal YAML subset parser — enough for the flat/nested-map configs this
// app uses. Supports: nested maps by indentation, scalar values (strings,
// quoted strings, numbers, booleans, null), simple lists of scalars, and
// comments. Intentionally NOT a full YAML implementation (see BUILD notes:
// zero runtime dependencies).

function stripComment(line) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === '#' && !inSingle && !inDouble) {
      if (i === 0 || /\s/.test(line[i - 1])) return line.slice(0, i);
    }
  }
  return line;
}

function parseScalar(raw) {
  const text = raw.trim();
  if (text === '' || text === '~' || text === 'null') return null;
  if (
    (text.startsWith('"') && text.endsWith('"') && text.length >= 2) ||
    (text.startsWith("'") && text.endsWith("'") && text.length >= 2)
  ) {
    return text.slice(1, -1);
  }
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (/^-?\d+$/.test(text)) return Number.parseInt(text, 10);
  if (/^-?\d+\.\d+$/.test(text)) return Number.parseFloat(text);
  return text;
}

export function parseYaml(source) {
  const lines = [];
  for (const raw of String(source).split(/\r?\n/)) {
    const noComment = stripComment(raw.replace(/\t/g, '  '));
    if (!noComment.trim()) continue;
    lines.push({
      indent: noComment.match(/^ */)[0].length,
      text: noComment.trim(),
    });
  }
  if (lines.length === 0) return {};

  let i = 0;
  function parseBlock(indent) {
    const isList = lines[i].text.startsWith('- ') || lines[i].text === '-';
    const out = isList ? [] : {};
    while (i < lines.length && lines[i].indent === indent) {
      const { text } = lines[i];
      if (isList) {
        if (!text.startsWith('-')) throw new Error(`YAML: expected list item, got "${text}"`);
        i++;
        out.push(parseScalar(text.replace(/^-\s*/, '')));
      } else {
        const m = text.match(/^([^:]+):(.*)$/);
        if (!m) throw new Error(`YAML: expected "key: value", got "${text}"`);
        const key = m[1].trim();
        const rest = m[2].trim();
        i++;
        if (rest === '') {
          if (i < lines.length && lines[i].indent > indent) {
            out[key] = parseBlock(lines[i].indent);
          } else {
            out[key] = null;
          }
        } else {
          out[key] = parseScalar(rest);
        }
      }
    }
    return out;
  }

  return parseBlock(lines[0].indent);
}
