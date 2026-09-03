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

// Static lookup sets used inside parseHTML to avoid allocating thousands of short-lived
// Set objects in the parser's hot loop when parsing table tags (tr, td, th).
const STOP_TR = new Set(['table', 'thead', 'tbody', 'tfoot']);
const STOP_TD_TH = new Set(['table', 'thead', 'tbody', 'tfoot', 'tr']);

// Sticky regexes to avoid slicing strings in the hot loop
const CLOSE_TAG_RE = /<\/\s*([a-zA-Z][a-zA-Z0-9-]*)[^>]*>/y;
const OPEN_TAG_RE = /<([a-zA-Z][a-zA-Z0-9-]*)/y;
const ATTR_RE = /([^\s=/>]+)(\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*)))?/y;
const COMMENT_RE = /<!--([\s\S]*?)(?:-->|$)/y;

// Cached regular expressions for raw text tags to prevent re-compilation and allocations in the hot loop.
const RAW_TEXT_RES = {
  script: /<\/script\s*>/gi,
  style: /<\/style\s*>/gi,
  textarea: /<\/textarea\s*>/gi,
  title: /<\/title\s*>/gi,
};

export function parseHTML(input) {
  const root = { type: 'root', tag: '#root', children: [] };
  const stack = [root];
  let top = root;
  let i = 0;

  const pushText = (text) => {
    if (text === '') return;
    top.children.push({ type: 'text', text });
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
      COMMENT_RE.lastIndex = i;
      const m = COMMENT_RE.exec(input);
      if (m) {
        top.children.push({ type: 'comment', text: m[1] });
        i = COMMENT_RE.lastIndex;
      } else {
        i += 4;
      }
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
      CLOSE_TAG_RE.lastIndex = i;
      const m = CLOSE_TAG_RE.exec(input);
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
      if (idx !== -1) {
        stack.length = idx; // pop through the matching element
        top = stack[stack.length - 1];
      }
      // else: stray close tag — ignore
      i += m[0].length;
      continue;
    }

    // Opening tag
    OPEN_TAG_RE.lastIndex = i;
    const m = OPEN_TAG_RE.exec(input);
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
      // Fast charCodeAt whitespace scanning instead of /\s/.test()
      while (j < input.length) {
        const c = input.charCodeAt(j);
        if (c === 32 || c === 9 || c === 10 || c === 13 || c === 12) j++;
        else break;
      }
      if (input[j] === '>') { j++; break; }
      if (input[j] === '/') { selfClose = true; j++; continue; }
      ATTR_RE.lastIndex = j;
      const am = ATTR_RE.exec(input);
      if (!am || am[0] === '') { j++; continue; }
      const name = am[1].toLowerCase();
      attrs[name] = am[2] != null ? (am[3] ?? am[4] ?? am[5] ?? '') : '';
      j += am[0].length;
    }

    // Implicit closes for tolerance
    if (BLOCK_STARTS.has(tag)) {
      while (stack.length > 1 && (top.tag === 'p' || HEADINGS.has(top.tag))) {
        stack.pop();
        top = stack[stack.length - 1];
      }
    }
    if (tag === 'li') {
      for (let s = stack.length - 1; s > 0; s--) {
        const t = stack[s].tag;
        if (t === 'ul' || t === 'ol') break;
        if (t === 'li') {
          stack.length = s;
          top = stack[stack.length - 1];
          break;
        }
      }
    }
    if (tag === 'tr' || tag === 'td' || tag === 'th') {
      const stop = tag === 'tr' ? STOP_TR : STOP_TD_TH;
      for (let s = stack.length - 1; s > 0; s--) {
        const t = stack[s].tag;
        if (stop.has(t)) break;
        if (t === 'tr' || t === 'td' || t === 'th') {
          stack.length = s;
          top = stack[stack.length - 1];
          break;
        }
      }
    }

    const node = { type: 'element', tag, attrs, children: [] };
    top.children.push(node);
    i = j;

    if (VOID_TAGS.has(tag) || selfClose) continue;

    if (RAW_TEXT_TAGS.has(tag)) {
      const closeRe = RAW_TEXT_RES[tag];
      closeRe.lastIndex = i;
      const cm = closeRe.exec(input);
      const rawEnd = cm ? cm.index : input.length;
      const raw = input.slice(i, rawEnd);
      if (raw) node.children.push({ type: 'text', text: raw });
      i = rawEnd + (cm ? cm[0].length : 0);
      continue;
    }

    stack.push(node);
    top = node;
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
