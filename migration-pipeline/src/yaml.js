// Minimal YAML subset parser — zero runtime dependencies.
// Lifted from other packages in this monorepo.

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

  // Handle simple arrays in yaml [a, b, c]
  if (text.startsWith('[') && text.endsWith(']')) {
    return text.slice(1, -1).split(',').map(s => parseScalar(s.trim()));
  }
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
        const itemText = text.replace(/^-\s*/, '').trim();
        i++;
        if (itemText === '' && i < lines.length && lines[i].indent > indent) {
          out.push(parseBlock(lines[i].indent));
        } else if (itemText.startsWith('{') && itemText.endsWith('}')) {
          // Handle flow mapping / inline objects like { name: Jane, role: Client PM }
          const obj = {};
          const pairs = itemText.slice(1, -1).split(',');
          for (const pair of pairs) {
            const [k, v] = pair.split(':').map(s => s.trim());
            obj[k] = parseScalar(v);
          }
          out.push(obj);
        } else {
          out.push(parseScalar(itemText));
        }
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

// Simple YAML stringifier to generate temporary configs
export function stringifyYaml(obj, indent = 0) {
  const spaces = ' '.repeat(indent);
  if (obj === null || obj === undefined) return 'null';
  if (typeof obj === 'string') {
    if (obj.includes(':') || obj.includes('#') || obj.includes('[') || obj.includes('{')) {
      return `"${obj.replace(/"/g, '\\"')}"`;
    }
    return obj;
  }
  if (typeof obj === 'number' || typeof obj === 'boolean') return String(obj);

  if (Array.isArray(obj)) {
    if (obj.every(x => typeof x !== 'object' || x === null)) {
      return `[${obj.map(x => stringifyYaml(x)).join(', ')}]`;
    }
    let res = '';
    for (const item of obj) {
      if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
        // Inline object for stakeholder format if simple, or nested block
        const keys = Object.keys(item);
        const inlinePairs = keys.map(k => `${k}: ${stringifyYaml(item[k])}`).join(', ');
        res += `${spaces}- { ${inlinePairs} }\n`;
      } else {
        res += `${spaces}- ${stringifyYaml(item)}\n`;
      }
    }
    return res.trimEnd();
  }

  if (typeof obj === 'object') {
    let res = '';
    for (const [k, v] of Object.entries(obj)) {
      if (v === null || v === undefined) {
        res += `${spaces}${k}: null\n`;
      } else if (typeof v === 'object') {
        if (Array.isArray(v)) {
          if (v.every(x => typeof x !== 'object' || x === null)) {
            res += `${spaces}${k}: [${v.map(x => stringifyYaml(x)).join(', ')}]\n`;
          } else {
            res += `${spaces}${k}:\n`;
            res += stringifyYaml(v, indent + 2) + '\n';
          }
        } else {
          res += `${spaces}${k}:\n`;
          res += stringifyYaml(v, indent + 2) + '\n';
        }
      } else {
        res += `${spaces}${k}: ${stringifyYaml(v)}\n`;
      }
    }
    return res.trimEnd();
  }
  return String(obj);
}
