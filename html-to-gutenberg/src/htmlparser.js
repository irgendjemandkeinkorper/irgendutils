// Small, tolerant HTML parser — no dependencies.
// Produces a tree of { type: 'root'|'element'|'text'|'comment' } nodes.
// Tolerates unclosed <p>/<li>/heading tags, unquoted attributes, stray closers.

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

// Content is raw text until the matching close tag.
const RAW_TEXT_TAGS = new Set(['script', 'style', 'textarea', 'title']);

// Opening one of these implicitly closes an open <p> or heading.
const BLOCK_STARTS = new Set([
  'address', 'article', 'aside', 'blockquote', 'div', 'dl', 'fieldset',
  'figure', 'figcaption', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'ul',
]);

const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

export function parseHTML(input) {
  const root = { type: 'root', tag: '#root', children: [] };
  const stack = [root];
  const top = () => stack[stack.length - 1];
  let i = 0;

  const pushText = (text) => {
    if (text === '') return;
    top().children.push({ type: 'text', text });
  };

  while (i < input.length) {
    if (input[i] !== '<') {
      const next = input.indexOf('<', i);
      const end = next === -1 ? input.length : next;
      pushText(input.slice(i, end));
      i = end;
      continue;
    }

    // Comment
    if (input.startsWith('<!--', i)) {
      const end = input.indexOf('-->', i + 4);
      const text = end === -1 ? input.slice(i + 4) : input.slice(i + 4, end);
      top().children.push({ type: 'comment', text });
      i = end === -1 ? input.length : end + 3;
      continue;
    }

    // Doctype / other declarations
    if (input.startsWith('<!', i) || input.startsWith('<?', i)) {
      const end = input.indexOf('>', i);
      i = end === -1 ? input.length : end + 1;
      continue;
    }

    // Closing tag
    if (input.startsWith('</', i)) {
      const m = /^<\/\s*([a-zA-Z][a-zA-Z0-9-]*)[^>]*>/.exec(input.slice(i));
      if (!m) {
        pushText('<');
        i += 1;
        continue;
      }
      const tag = m[1].toLowerCase();
      let idx = -1;
      for (let s = stack.length - 1; s > 0; s--) {
        if (stack[s].tag === tag) { idx = s; break; }
      }
      if (idx !== -1) stack.length = idx; // pop through the matching element
      // else: stray close tag — ignore
      i += m[0].length;
      continue;
    }

    // Opening tag
    const m = /^<([a-zA-Z][a-zA-Z0-9-]*)/.exec(input.slice(i));
    if (!m) {
      pushText('<');
      i += 1;
      continue;
    }
    const tag = m[1].toLowerCase();
    let j = i + m[0].length;
    const attrs = {};
    let selfClose = false;
    while (j < input.length) {
      while (j < input.length && /\s/.test(input[j])) j++;
      if (input[j] === '>') { j++; break; }
      if (input[j] === '/') { selfClose = true; j++; continue; }
      const am = /^([^\s=/>]+)(\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*)))?/.exec(input.slice(j));
      if (!am || am[0] === '') { j++; continue; }
      const name = am[1].toLowerCase();
      attrs[name] = am[2] != null ? (am[3] ?? am[4] ?? am[5] ?? '') : '';
      j += am[0].length;
    }

    // Implicit closes for tolerance
    if (BLOCK_STARTS.has(tag)) {
      while (stack.length > 1 && (top().tag === 'p' || HEADINGS.has(top().tag))) {
        stack.pop();
      }
    }
    if (tag === 'li') {
      for (let s = stack.length - 1; s > 0; s--) {
        const t = stack[s].tag;
        if (t === 'ul' || t === 'ol') break;
        if (t === 'li') { stack.length = s; break; }
      }
    }
    if (tag === 'tr' || tag === 'td' || tag === 'th') {
      const stop = new Set(tag === 'tr'
        ? ['table', 'thead', 'tbody', 'tfoot']
        : ['table', 'thead', 'tbody', 'tfoot', 'tr']);
      for (let s = stack.length - 1; s > 0; s--) {
        const t = stack[s].tag;
        if (stop.has(t)) break;
        if (t === 'tr' || t === 'td' || t === 'th') { stack.length = s; break; }
      }
    }

    const node = { type: 'element', tag, attrs, children: [] };
    top().children.push(node);
    i = j;

    if (VOID_TAGS.has(tag) || selfClose) continue;

    if (RAW_TEXT_TAGS.has(tag)) {
      const closeRe = new RegExp(`</${tag}\\s*>`, 'i');
      const rest = input.slice(i);
      const cm = closeRe.exec(rest);
      const rawEnd = cm ? cm.index : rest.length;
      const raw = rest.slice(0, rawEnd);
      if (raw) node.children.push({ type: 'text', text: raw });
      i += rawEnd + (cm ? cm[0].length : 0);
      continue;
    }

    stack.push(node);
  }

  return root;
}

export function elementChildren(node) {
  return node.children.filter((c) => c.type === 'element');
}

export function isWhitespaceText(node) {
  return node.type === 'text' && node.text.trim() === '';
}

// Reconstruct HTML from a parsed node (used for core/html fallbacks and code blocks).
export function serializeNodeRaw(node) {
  if (node.type === 'text') return node.text;
  if (node.type === 'comment') return `<!--${node.text}-->`;
  if (node.type === 'root') return node.children.map(serializeNodeRaw).join('');
  const attrs = Object.entries(node.attrs)
    .map(([k, v]) => (v === '' ? ` ${k}` : ` ${k}="${v.replace(/"/g, '&quot;')}"`))
    .join('');
  if (VOID_TAGS.has(node.tag)) return `<${node.tag}${attrs}/>`;
  return `<${node.tag}${attrs}>${node.children.map(serializeNodeRaw).join('')}</${node.tag}>`;
}

export { VOID_TAGS, HEADINGS };
