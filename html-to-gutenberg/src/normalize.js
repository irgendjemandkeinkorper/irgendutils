// Normalization pass: strip tracking/script/style noise, drop comments,
// resolve relative asset URLs against a media base.

const STRIP_TAGS = new Set(['script', 'style', 'noscript', 'link', 'meta', 'base', 'template', 'head', 'title']);
const URL_ATTRS = { img: ['src'], video: ['src', 'poster'], source: ['src'], iframe: ['src'] };

function isAbsoluteUrl(url) {
  return /^([a-z][a-z0-9+.-]*:)?\/\//i.test(url) || /^[a-z][a-z0-9+.-]*:/i.test(url);
}

export function normalizeTree(root, opts = {}) {
  const dropped = [];
  const mediaBase = opts.mediaBase || null;

  const visit = (node) => {
    if (!node.children) return;
    node.children = node.children.filter((child) => {
      if (child.type === 'comment') {
        if (child.text.trim() !== '') {
          dropped.push({ node: 'comment', reason: 'HTML comment removed' });
        }
        return false;
      }
      if (child.type === 'element' && STRIP_TAGS.has(child.tag)) {
        dropped.push({ node: `<${child.tag}>`, reason: `stripped non-content tag <${child.tag}>` });
        return false;
      }
      return true;
    });
    for (const child of node.children) {
      if (child.type !== 'element') continue;
      const urlAttrs = URL_ATTRS[child.tag];
      if (urlAttrs && mediaBase) {
        for (const attr of urlAttrs) {
          const val = child.attrs[attr];
          if (val && !isAbsoluteUrl(val)) {
            try {
              child.attrs[attr] = new URL(val, mediaBase).href;
            } catch {
              /* keep original on bad base */
            }
          }
        }
      }
      visit(child);
    }
  };

  visit(root);
  return { root, dropped };
}

export function collectImageSources(root) {
  const sources = [];
  const seen = new Set();
  const visit = (node) => {
    if (node.type === 'element' && node.tag === 'img' && node.attrs.src && !seen.has(node.attrs.src)) {
      seen.add(node.attrs.src);
      sources.push(node.attrs.src);
    }
    if (node.children) node.children.forEach(visit);
  };
  visit(root);
  return sources;
}
