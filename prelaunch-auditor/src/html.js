// Small, tolerant HTML extractor — good enough for audit fixtures and typical
// rendered pages. Deliberately not a full parser (see BUILD contract: no jsdom).

function parseAttrs(raw) {
  const attrs = {};
  const re = /([a-zA-Z][\w:-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m;
  while ((m = re.exec(raw))) {
    const key = m[1].toLowerCase();
    if (!(key in attrs)) attrs[key] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return attrs;
}

function tagList(html, name) {
  const out = [];
  const re = new RegExp(`<${name}\\b([^>]*)>`, 'gi');
  let m;
  while ((m = re.exec(html))) out.push({ index: m.index, attrs: parseAttrs(m[1]) });
  return out;
}

function blockList(html, name) {
  const out = [];
  const re = new RegExp(`<${name}\\b([^>]*)>([\\s\\S]*?)</${name}>`, 'gi');
  let m;
  while ((m = re.exec(html))) {
    out.push({ start: m.index, end: m.index + m[0].length, attrs: parseAttrs(m[1]), inner: m[2] });
  }
  return out;
}

export function stripTags(html) {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const LABELABLE_SKIP = new Set(['hidden', 'submit', 'button', 'reset', 'image']);

export function extract(html) {
  const h = html || '';

  const titleMatch = h.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? stripTags(titleMatch[1]) : null;

  const metas = tagList(h, 'meta').map((t) => t.attrs);
  const linkTags = tagList(h, 'link').map((t) => t.attrs);
  const relOf = (a) => (a.rel || '').toLowerCase();

  const canonical = linkTags.find((a) => relOf(a).split(/\s+/).includes('canonical'))?.href ?? null;
  const hasFaviconLink = linkTags.some((a) => /(^|\s)(icon|shortcut|apple-touch-icon|mask-icon)(\s|$)/.test(relOf(a)));
  const stylesheets = linkTags.filter((a) => relOf(a).split(/\s+/).includes('stylesheet')).map((a) => a.href || '');

  const langMatch = h.match(/<html\b[^>]*?\blang\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
  const lang = langMatch ? (langMatch[1] ?? langMatch[2] ?? langMatch[3]).trim() : null;

  const h1s = [];
  const h1re = /<h1\b[^>]*>([\s\S]*?)<\/h1>/gi;
  let m;
  while ((m = h1re.exec(h))) h1s.push(stripTags(m[1]));

  const images = tagList(h, 'img').map((t) => ({
    src: t.attrs.src ?? '',
    alt: 'alt' in t.attrs ? t.attrs.alt : null,
  }));

  const anchors = [];
  const are = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  while ((m = are.exec(h))) {
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
    main: /<main\b/i.test(h) || /role\s*=\s*["']?main\b/i.test(h),
    nav: /<nav\b/i.test(h) || /role\s*=\s*["']?navigation\b/i.test(h),
    header: /<header\b/i.test(h) || /role\s*=\s*["']?banner\b/i.test(h),
    footer: /<footer\b/i.test(h) || /role\s*=\s*["']?contentinfo\b/i.test(h),
  };

  const navs = blockList(h, 'nav').map((n) => ({ hasLinks: /<a\b/i.test(n.inner) }));

  const styleBlocks = [];
  const sre = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  while ((m = sre.exec(h))) styleBlocks.push(m[1]);

  // Inline style color pairs for the contrast heuristic.
  const inlineColorPairs = [];
  const stre = /<[a-z][a-z0-9]*\b[^>]*\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  while ((m = stre.exec(h))) {
    const style = m[1] ?? m[2];
    const fg = style.match(/(?:^|;)\s*color\s*:\s*(#[0-9a-fA-F]{3,8})/);
    const bg = style.match(/background(?:-color)?\s*:\s*(#[0-9a-fA-F]{3,8})/);
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
