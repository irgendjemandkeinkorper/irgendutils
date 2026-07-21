import { finding } from '../findings.js';
import { metaContent, metaProperty } from '../html.js';

export const id = 'seo';
export const label = 'SEO';

const STAGING_HOST_RE = /(^|[./-])(staging|stage|stg|dev|test|preview|sandbox)([./-])/i;

const header = (headers, name) => headers?.[name.toLowerCase()] ?? null;

export async function run(site) {
  const F = [];
  const prod = site.config.environment === 'production';
  const titles = new Map();
  const descriptions = new Map();

  for (const p of site.pages) {
    const d = p.doc;

    if (!d.title) {
      F.push(finding('seo', 'missing-title', 'blocker',
        'Page has no <title>.',
        'Add a unique, descriptive <title> (roughly 50-60 characters).', p.url));
    } else {
      const key = d.title.toLowerCase();
      titles.set(key, [...(titles.get(key) ?? []), p.url]);
    }

    const desc = metaContent(d, 'description');
    if (!desc) {
      F.push(finding('seo', 'missing-meta-description', 'warning',
        'Page has no meta description.',
        'Add a unique meta description (roughly 120-160 characters) summarizing the page.', p.url));
    } else {
      const key = desc.toLowerCase();
      descriptions.set(key, [...(descriptions.get(key) ?? []), p.url]);
    }

    if (d.h1s.length === 0) {
      F.push(finding('seo', 'missing-h1', 'warning',
        'Page has no <h1>.',
        'Add exactly one <h1> describing the page content.', p.url));
    } else if (d.h1s.length > 1) {
      F.push(finding('seo', 'multiple-h1', 'warning',
        `Page has ${d.h1s.length} <h1> elements.`,
        'Keep exactly one <h1>; demote the others to <h2>.', p.url));
    }

    if (!d.canonical) {
      F.push(finding('seo', 'missing-canonical', 'warning',
        'Page has no canonical link.',
        'Add <link rel="canonical" href="..."> pointing at the production URL.', p.url));
    } else if (STAGING_HOST_RE.test(d.canonical)) {
      F.push(finding('seo', 'staging-canonical', 'blocker',
        `Canonical URL still points at a staging/dev host: ${d.canonical}`,
        'Update canonical URLs (search-replace the site URL) to the production domain before launch.', p.url));
    }

    const metaRobots = metaContent(d, 'robots') ?? '';
    const xRobots = header(p.headers, 'x-robots-tag') ?? '';
    const noindex = /noindex/i.test(metaRobots) || /noindex/i.test(xRobots);
    if (noindex && prod) {
      F.push(finding('seo', 'noindex-production', 'blocker',
        'Page is set to noindex while auditing as PRODUCTION.',
        'Remove the noindex robots meta tag / X-Robots-Tag header (in WP: Settings > Reading > uncheck "Discourage search engines").', p.url));
    } else if (noindex && !prod) {
      F.push(finding('seo', 'noindex-staging-ok', 'info',
        'Page is noindex — correct for a staging environment. Re-audit with --env production before launch.',
        'No action needed on staging; remove noindex when going live.', p.url));
    } else if (!noindex && !prod) {
      F.push(finding('seo', 'staging-indexable', 'warning',
        'Staging page is indexable (no noindex found).',
        'Add noindex on staging so search engines do not index the pre-launch site.', p.url));
    }

    if (metaProperty(d, 'og:').length === 0) {
      F.push(finding('seo', 'missing-open-graph', 'warning',
        'Page has no Open Graph tags.',
        'Add og:title, og:description, og:url and og:image so shares render correctly.', p.url));
    }
    if (!metaContent(d, 'twitter:card')) {
      F.push(finding('seo', 'missing-twitter-card', 'info',
        'Page has no Twitter card meta tags.',
        'Add <meta name="twitter:card" content="summary_large_image"> plus title/description/image.', p.url));
    }
  }

  for (const [, urls] of titles) {
    if (urls.length > 1) {
      F.push(finding('seo', 'duplicate-title', 'warning',
        `Same <title> used on ${urls.length} pages: ${urls.join(', ')}`,
        'Give every page a unique title.', urls[0]));
    }
  }
  for (const [, urls] of descriptions) {
    if (urls.length > 1) {
      F.push(finding('seo', 'duplicate-meta-description', 'warning',
        `Same meta description used on ${urls.length} pages: ${urls.join(', ')}`,
        'Give every page a unique meta description.', urls[0]));
    }
  }

  const robots = await site.resource('/robots.txt');
  if (robots.status !== 200) {
    F.push(finding('seo', 'missing-robots-txt', 'warning',
      `robots.txt not found (HTTP ${robots.status}).`,
      'Serve a robots.txt with a Sitemap: line.', new URL('/robots.txt', site.baseUrl).href));
  } else if (prod && /^\s*User-agent:\s*\*/im.test(robots.body) && /^\s*Disallow:\s*\/\s*$/im.test(robots.body)) {
    F.push(finding('seo', 'robots-disallow-all', 'blocker',
      'robots.txt disallows all crawling while auditing as PRODUCTION.',
      'Remove the blanket "Disallow: /" rule before launch.', new URL('/robots.txt', site.baseUrl).href));
  }

  const sitemap = await site.resource('/sitemap.xml');
  const sitemapIndex = sitemap.status === 200 ? sitemap : await site.resource('/sitemap_index.xml');
  if (sitemapIndex.status !== 200) {
    F.push(finding('seo', 'missing-sitemap', 'warning',
      'No XML sitemap found at /sitemap.xml or /sitemap_index.xml.',
      'Publish an XML sitemap (e.g. via your SEO plugin) and reference it from robots.txt.', new URL('/sitemap.xml', site.baseUrl).href));
  }

  return F;
}
