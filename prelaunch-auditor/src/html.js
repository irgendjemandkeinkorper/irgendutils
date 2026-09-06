// Small, tolerant HTML extractor — good enough for audit fixtures and typical
// rendered pages. Deliberately not a full parser (see BUILD contract: no jsdom).

// Performance optimizations:
// Pre-compile static regexes and cache tag/block RegExp instances at module level
// to avoid repeated RegExp instantiation and compilation on every page extraction.

const ATTR_RE = /([a-zA-Z][\w:-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
const TAG_RE_CACHE = new Map();
const BLOCK_RE_CACHE = new Map();

const TITLE_RE = /<title[^>]*>([\s\S]*?)<\/title>/i;
const LANG_RE = /<html\b[^>]*?\blang\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
const H1_RE = /<h1\b[^>]*>([\s\S]*?)<\/h1>/gi;
const A_RE = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
const STYLE_RE = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
const INLINE_STYLE_RE = /<[a-z][a-z0-9]*\b[^>]*\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const FAVICON_REL_RE = /(^|\s)(icon|shortcut|apple-touch-icon|mask-icon)(\s|$)/i;

const SCRIPT_STRIP_RE = /<script\b[\s\S]*?<\/script>/gi;
const STYLE_STRIP_RE = /<style\b[\s\S]*?<\/style>/gi;
const TAG_STRIP_RE = /<[^>]+>/g;
const NBSP_STRIP_RE = /&nbsp;/g;
const WS_STRIP_RE = /\s+/g;

const COLOR_FG_RE = /(?:^|;)\s*color\s*:\s*(#[0-9a-fA-F]{3,8})/;
const COLOR_BG_RE = /background(?:-color)?\s*:\s*(#[0-9a-fA-F]{3,8})/;

const MAIN_TAG_RE = /<main\b/i;
const MAIN_ROLE_RE = /role\s*=\s*["']?main\b/i;
const NAV_TAG_RE = /<nav\b/i;
const NAV_ROLE_RE = /role\s*=\s*["']?navigation\b/i;
const HEADER_TAG_RE = /<header\b/i;
const HEADER_ROLE_RE = /role\s*=\s*["']?banner\b/i;
const FOOTER_TAG_RE = /<footer\b/i;
const FOOTER_ROLE_RE = /role\s*=\s*["']?contentinfo\b/i;
const NAV_A_RE = /<a\b/i;

function parseAttrs(raw) {
  const attrs = {};
  ATTR_RE.lastIndex = 0;
  let m;
  while ((m = ATTR_RE.exec(raw))) {
    const key = m[1].toLowerCase();
    if (!(key in attrs)) attrs[key] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return attrs;
}

function tagList(html, name) {
  const out = [];
  let re = TAG_RE_CACHE.get(name);
  if (!re) {
    re = new RegExp(`<${name}\\b([^>]*)>`, 'gi');
    TAG_RE_CACHE.set(name, re);
  }
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(html))) out.push({ index: m.index, attrs: parseAttrs(m[1]) });
  return out;
}

function blockList(html, name) {
  const out = [];
  let re = BLOCK_RE_CACHE.get(name);
  if (!re) {
    re = new RegExp(`<${name}\\b([^>]*)>([\\s\\S]*?)</${name}>`, 'gi');
    BLOCK_RE_CACHE.set(name, re);
  }
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(html))) {
    out.push({ start: m.index, end: m.index + m[0].length, attrs: parseAttrs(m[1]), inner: m[2] });
  }
  return out;
}

export function stripTags(html) {
  return html
    .replace(SCRIPT_STRIP_RE, ' ')
    .replace(STYLE_STRIP_RE, ' ')
    .replace(TAG_STRIP_RE, ' ')
    .replace(NBSP_STRIP_RE, ' ')
    .replace(WS_STRIP_RE, ' ')
    .trim();
}

const LABELABLE_SKIP = new Set(['hidden', 'submit', 'button', 'reset', 'image']);

export function extract(html) {
  const h = html || '';

  const titleMatch = h.match(TITLE_RE);
  const title = titleMatch ? stripTags(titleMatch[1]) : null;

  const metas = tagList(h, 'meta').map((t) => t.attrs);
  const linkTags = tagList(h, 'link').map((t) => t.attrs);
  const relOf = (a) => (a.rel || '').toLowerCase();

  const canonical = linkTags.find((a) => relOf(a).split(/\s+/).includes('canonical'))?.href ?? null;
  const hasFaviconLink = linkTags.some((a) => FAVICON_REL_RE.test(relOf(a)));
  const stylesheets = linkTags.filter((a) => relOf(a).split(/\s+/).includes('stylesheet')).map((a) => a.href || '');

  const langMatch = h.match(LANG_RE);
  const lang = langMatch ? (langMatch[1] ?? langMatch[2] ?? langMatch[3]).trim() : null;

  const h1s = [];
  H1_RE.lastIndex = 0;
  let m;
  while ((m = H1_RE.exec(h))) h1s.push(stripTags(m[1]));

  const images = tagList(h, 'img').map((t) => ({
    src: t.attrs.src ?? '',
    alt: 'alt' in t.attrs ? t.attrs.alt : null,
  }));

  const anchors = [];
  A_RE.lastIndex = 0;
  while ((m = A_RE.exec(h))) {
    const attrs = parseAttrs(m[1]);
    anchors.push({ href: attrs.href ?? null, text: stripTags(m[2]) });
  }

  const scripts = tagList(h, 'script').map((t) => t.attrs.src).filter(Boolean);
  const iframes = tagList(h, 'iframe').map((t) => t.attrs.src).filter(Boolean);

  // Form controls + label coverage.
  const labelBlocks = blockList(h, 'label');
  const labelFor = new Set(labelBlocks.map((l) => l.attrs.for).filter(Boolean));
  const controls = [
    ...tagList(h, 'input').filter((t) => !LABELABLE_SKIP.has((t.attrs.type || 'text').toLowerCase())),
    ...tagList(h, 'select'),
    ...tagList(h, 'textarea'),
  ];
  const unlabeledControls = controls.filter((c) => {
    const a = c.attrs;
    if (a['aria-label'] || a['aria-labelledby'] || a.title) return false;
    if (a.id && labelFor.has(a.id)) return false;
    return !labelBlocks.some((l) => c.index > l.start && c.index < l.end);
  }).map((c) => ({ name: c.attrs.name ?? c.attrs.id ?? '(unnamed)', type: c.attrs.type ?? 'text' }));

  const landmarks = {
    main: MAIN_TAG_RE.test(h) || MAIN_ROLE_RE.test(h),
    nav: NAV_TAG_RE.test(h) || NAV_ROLE_RE.test(h),
    header: HEADER_TAG_RE.test(h) || HEADER_ROLE_RE.test(h),
    footer: FOOTER_TAG_RE.test(h) || FOOTER_ROLE_RE.test(h),
  };

  const navs = blockList(h, 'nav').map((n) => ({ hasLinks: NAV_A_RE.test(n.inner) }));

  const styleBlocks = [];
  STYLE_RE.lastIndex = 0;
  while ((m = STYLE_RE.exec(h))) styleBlocks.push(m[1]);

  // Inline style color pairs for the contrast heuristic.
  const inlineColorPairs = [];
  INLINE_STYLE_RE.lastIndex = 0;
  while ((m = INLINE_STYLE_RE.exec(h))) {
    const style = m[1] ?? m[2];
    const fg = style.match(COLOR_FG_RE);
    const bg = style.match(COLOR_BG_RE);
    if (fg && bg) inlineColorPairs.push({ fg: fg[1], bg: bg[1], style });
  }

  const generator = metas.find((a) => (a.name || '').toLowerCase() === 'generator')?.content ?? null;

  return {
    title, metas, canonical, hasFaviconLink, stylesheets, lang, h1s, images,
    anchors, scripts, iframes, unlabeledControls, landmarks, navs, styleBlocks,
    inlineColorPairs, generator, text: stripTags(h), raw: h,
  };
}

export function metaContent(doc, name) {
  const n = name.toLowerCase();
  return doc.metas.find((a) => (a.name || '').toLowerCase() === n)?.content ?? null;
}

export function metaProperty(doc, prefix) {
  const p = prefix.toLowerCase();
  return doc.metas.filter((a) => (a.property || '').toLowerCase().startsWith(p));
}

// --- Color contrast (WCAG relative luminance) -------------------------------

function hexToRgb(hex) {
  let x = hex.replace('#', '');
  if (x.length === 3 || x.length === 4) x = [...x].map((c) => c + c).join('');
  if (x.length < 6) return null;
  return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16));
}

function luminance(rgb) {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(fgHex, bgHex) {
  const fg = hexToRgb(fgHex);
  const bg = hexToRgb(bgHex);
  if (!fg || !bg) return null;
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}
