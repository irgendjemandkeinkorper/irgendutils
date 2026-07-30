// Live adapter: crawls a real site (homepage + sitemap + same-host links, up
// to config.maxPages), fetches page HTML and arbitrary resources, and
// optionally runs Lighthouse for performance budgets.
//
// Lighthouse + chrome-launcher are imported LAZILY, exactly like
// wp-qa-playwright's Playwright adapter — the base adapter (crawl + fetch)
// has zero mandatory dependencies; only a live `perfRuns()` call needs them.
// To enable live performance runs:  npm i -D lighthouse chrome-launcher
//
// Read-only: GET requests only, never submits forms or mutates the site.
import { extract } from '../html.js';

const HTML_EXT_RE = /\.(html?|php|aspx?)$/i;
const NON_PAGE_EXT_RE = /\.(png|jpe?g|gif|webp|avif|svg|ico|css|js|mjs|json|xml|pdf|zip|woff2?|ttf|mp4|webm|mp3)$/i;

function basicAuthHeader() {
  const user = process.env.AUDIT_HTTP_USER;
  const pass = process.env.AUDIT_HTTP_PASS;
  if (!user || !pass) return null;
  return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
}

export function createLiveAdapter(baseUrl, config = {}, { log = () => {}, timeoutMs = 20000 } = {}) {
  const base = new URL(baseUrl);
  const authHeader = base.protocol === 'https:' ? basicAuthHeader() : null;
  if (base.protocol !== 'https:' && basicAuthHeader()) {
    log('AUDIT_HTTP_USER/PASS set but base URL is not https:// — refusing to send credentials in the clear.');
  }

  async function rawFetch(url, { redirect = 'manual' } = {}) {
    const headers = {};
    if (authHeader) headers.authorization = authHeader;
    try {
      const res = await fetch(url, { headers, redirect, signal: AbortSignal.timeout(timeoutMs) });
      const body = await res.text().catch(() => '');
      return { status: res.status, headers: Object.fromEntries(res.headers), body };
    } catch (err) {
      return { status: 0, headers: {}, body: '', error: err?.cause?.code || err.message };
    }
  }

  function sameHostPageLinks(html, from) {
    const links = [];
    for (const a of extract(html).anchors) {
      if (!a.href || /^(mailto|tel|javascript):/i.test(a.href) || a.href.startsWith('#')) continue;
      let u;
      try { u = new URL(a.href, from); } catch { continue; }
      if (u.host !== base.host) continue;
      if (NON_PAGE_EXT_RE.test(u.pathname)) continue;
      u.hash = '';
      links.push(u.href);
    }
    return links;
  }

  async function sitemapUrls() {
    const urls = [];
    for (const path of ['/sitemap.xml', '/sitemap_index.xml']) {
      const res = await rawFetch(new URL(path, base).href, { redirect: 'follow' });
      if (res.status !== 200) continue;
      const locs = [...res.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
      for (const loc of locs) {
        try {
          const u = new URL(loc);
          if (u.host === base.host && !NON_PAGE_EXT_RE.test(u.pathname)) urls.push(u.href);
        } catch { /* ignore malformed loc */ }
      }
      if (urls.length) break; // one sitemap is enough to seed the crawl
    }
    return urls;
  }

  return {
    baseUrl: base.href,

    async pages() {
      const maxPages = config.maxPages ?? 25;
      const seen = new Set();
      const out = [];
      const queue = [base.href, ...(await sitemapUrls())];

      while (queue.length && out.length < maxPages) {
        const url = queue.shift();
        const path = new URL(url).pathname || '/';
        if (seen.has(path)) continue;
        seen.add(path);

        log(`GET ${url}`);
        const res = await rawFetch(url, { redirect: 'follow' });
        out.push({ url, path, status: res.status, headers: res.headers, html: res.body });

        if (res.status === 200 && res.headers['content-type']?.includes('html')) {
          for (const link of sameHostPageLinks(res.body, url)) {
            const p = new URL(link).pathname || '/';
            if (!seen.has(p) && !queue.includes(link)) queue.push(link);
          }
        }
      }
      return out;
    },

    async resource(pathOrUrl) {
      const url = /^https?:\/\//i.test(pathOrUrl) ? pathOrUrl : new URL(pathOrUrl, base).href;
      log(`GET ${url}`);
      return rawFetch(url, { redirect: 'manual' });
    },

    // Lighthouse-style budget: mobile/desktop formFactor, median of n runs is
    // computed by checks/perf.js — this just returns the raw samples (or null
    // if the optional lighthouse/chrome-launcher deps aren't installed).
    async perfRuns(formFactor, n) {
      let lighthouse, chromeLauncher;
      try {
        ({ default: lighthouse } = await import('lighthouse'));
        chromeLauncher = await import('chrome-launcher');
      } catch {
        return null;
      }

      const chrome = await chromeLauncher.launch({ chromeFlags: ['--headless', '--no-sandbox'] });
      try {
        const samples = [];
        for (let i = 0; i < n; i++) {
          log(`lighthouse ${formFactor} run ${i + 1}/${n}`);
          const result = await lighthouse(base.href, {
            port: chrome.port,
            onlyCategories: ['performance'],
            formFactor,
            screenEmulation: formFactor === 'desktop'
              ? { mobile: false, width: 1350, height: 940, deviceScaleFactor: 1, disabled: false }
              : { mobile: true, width: 360, height: 640, deviceScaleFactor: 2, disabled: false },
          });
          const audits = result?.lhr?.audits ?? {};
          samples.push({
            lcp_ms: audits['largest-contentful-paint']?.numericValue ?? null,
            tbt_ms: audits['total-blocking-time']?.numericValue ?? null,
            cls: audits['cumulative-layout-shift']?.numericValue ?? null,
            performance_score: result?.lhr?.categories?.performance?.score ?? null,
          });
        }
        return samples;
      } finally {
        await chrome.kill();
      }
    },

    async close() {},
  };
}
