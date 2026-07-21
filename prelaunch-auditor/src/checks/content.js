import { finding } from '../findings.js';

export const id = 'content';
export const label = 'Content readiness';

// Deterministic probe path used to test the 404 page.
export const NOT_FOUND_PROBE = '/prelaunch-auditor-404-probe';

const sameHost = (href, baseUrl) => {
  try {
    const u = new URL(href, baseUrl);
    return u.host === new URL(baseUrl).host ? u : null;
  } catch {
    return null;
  }
};

export async function run(site) {
  const F = [];
  const checkedLinks = new Set();

  for (const p of site.pages) {
    const d = p.doc;

    if (/lorem ipsum/i.test(d.text)) {
      F.push(finding('content', 'lorem-ipsum', 'blocker',
        'Placeholder "lorem ipsum" text found on the page.',
        'Replace all placeholder copy with final content before launch.', p.url));
    }

    const sample = d.anchors.find((a) =>
      /hello[\s-]world/i.test(`${a.href ?? ''} ${a.text}`) || /^sample page$/i.test(a.text.trim()));
    if (sample || /hello world!/i.test(d.text)) {
      F.push(finding('content', 'sample-content', 'warning',
        'Default WordPress sample content ("Hello world!" post or "Sample Page") is still linked/visible.',
        'Delete the sample post/page (including from menus) before launch.', p.url));
    }

    for (const nav of d.navs) {
      if (!nav.hasLinks) {
        F.push(finding('content', 'empty-menu', 'warning',
          'A navigation region (<nav>) contains no links.',
          'Assign a menu to the empty menu location, or remove the empty nav.', p.url));
        break;
      }
    }

    // Broken internal links (fetch each same-host link once).
    for (const a of d.anchors) {
      if (!a.href || a.href.startsWith('#') || /^(mailto|tel|javascript):/i.test(a.href)) continue;
      const u = sameHost(a.href, site.baseUrl);
      if (!u || checkedLinks.has(u.pathname)) continue;
      checkedLinks.add(u.pathname);
      const res = await site.resource(u.pathname);
      if (res.status >= 400 || res.status === 0) {
        F.push(finding('content', 'broken-internal-link', 'warning',
          `Internal link "${a.href}" (${a.text || 'no text'}) returns HTTP ${res.status}.`,
          'Fix or remove the link, or publish the missing page.', p.url));
      }
    }
  }

  // Favicon: a <link rel=icon> on any page, or a live /favicon.ico.
  const hasFaviconLink = site.pages.some((p) => p.doc.hasFaviconLink);
  if (!hasFaviconLink) {
    const ico = await site.resource('/favicon.ico');
    if (ico.status !== 200) {
      F.push(finding('content', 'missing-favicon', 'warning',
        'No favicon found (no <link rel="icon"> and /favicon.ico is missing).',
        'Set a Site Icon (WP: Appearance > Customize > Site Identity) or serve /favicon.ico.', site.baseUrl));
    }
  }

  // 404 page: must actually return 404, and look styled (not a bare server page).
  const probeUrl = new URL(NOT_FOUND_PROBE, site.baseUrl).href;
  const notFound = await site.resource(NOT_FOUND_PROBE);
  if (notFound.status !== 404) {
    F.push(finding('content', '404-wrong-status', 'warning',
      `Nonexistent URL returned HTTP ${notFound.status} instead of 404 (soft-404).`,
      'Ensure unknown URLs return a real 404 status so search engines do not index error pages.', probeUrl));
  } else {
    const body = notFound.body ?? '';
    const styled = body.length > 300 && /<a\b/i.test(body);
    if (!styled) {
      F.push(finding('content', '404-unstyled', 'warning',
        'The 404 page looks unstyled (very short or without navigation links).',
        'Provide a branded 404 template with navigation back to the main site.', probeUrl));
    }
  }

  return F;
}
