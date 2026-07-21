// Tolerant, regex-based HTML extraction — good enough for structural QA on
// rendered pages without pulling in a DOM library.

const LANDMARK_TAGS = ['header', 'nav', 'main', 'footer'];
const ROLE_TO_LANDMARK = {
  banner: 'header',
  navigation: 'nav',
  main: 'main',
  contentinfo: 'footer',
};

export function stripTags(html) {
  return decodeEntities(String(html).replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

export function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/**
 * Extract the structural fingerprint of a page:
 * landmarks present, h1–h3 outline, and Gutenberg block types.
 */
export function extractStructure(html) {
  const src = String(html);
  const landmarks = [];
  for (const tag of LANDMARK_TAGS) {
    if (new RegExp(`<${tag}(\\s|>)`, 'i').test(src)) landmarks.push(tag);
  }
  for (const [role, tag] of Object.entries(ROLE_TO_LANDMARK)) {
    if (!landmarks.includes(tag) && new RegExp(`role\\s*=\\s*["']?${role}["']?`, 'i').test(src)) {
      landmarks.push(tag);
    }
  }

  const headings = [];
  const hRe = /<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi;
  let m;
  while ((m = hRe.exec(src)) !== null) {
    const text = stripTags(m[2]);
    if (text !== '') headings.push({ level: Number(m[1]), text });
  }

  const blocks = new Set();
  // Gutenberg block comments: <!-- wp:core/image --> or <!-- wp:image -->
  const commentRe = /<!--\s*wp:([a-z0-9_\/-]+)/gi;
  while ((m = commentRe.exec(src)) !== null) {
    blocks.add(m[1].toLowerCase().replace(/^core\//, ''));
  }
  // Rendered block classes: class="... wp-block-columns ..."
  const classRe = /\bwp-block-([a-z0-9-]+)/gi;
  while ((m = classRe.exec(src)) !== null) {
    blocks.add(m[1].toLowerCase());
  }

  return { landmarks, headings, blocks: [...blocks].sort() };
}

/**
 * Collect every <a href>, <img src>, <script src>, and stylesheet <link href>,
 * resolved to absolute URLs against baseUrl. http(s) only; deduped.
 */
export function extractLinks(html, baseUrl) {
  const src = String(html);
  const found = [];

  collect(/<a\b[^>]*\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi, 'anchor');
  collect(/<img\b[^>]*\bsrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi, 'image');
  collect(/<script\b[^>]*\bsrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi, 'script');

  // Stylesheets: <link ...> with rel containing "stylesheet" (attrs in any order)
  const linkTagRe = /<link\b[^>]*>/gi;
  let t;
  while ((t = linkTagRe.exec(src)) !== null) {
    const tag = t[0];
    if (!/\brel\s*=\s*["']?[^"'>]*stylesheet/i.test(tag)) continue;
    const href = tag.match(/\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if (href) push('stylesheet', href[2] ?? href[3] ?? href[4]);
  }

  function collect(re, type) {
    let m;
    while ((m = re.exec(src)) !== null) push(type, m[2] ?? m[3] ?? m[4]);
  }

  function push(type, raw) {
    if (raw == null) return;
    raw = decodeEntities(raw.trim());
    if (raw === '' || raw.startsWith('#')) return;
    if (/^(mailto:|tel:|javascript:|data:)/i.test(raw)) return;
    let url;
    try {
      url = new URL(raw, baseUrl);
    } catch {
      return;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
    url.hash = '';
    found.push({ type, url: url.href, raw });
  }

  const seen = new Set();
  return found.filter((l) => {
    const key = `${l.type} ${l.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
