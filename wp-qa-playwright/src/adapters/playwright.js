// Live page-capture adapter backed by Playwright. Playwright itself is
// imported LAZILY — only when a command actually runs against a live target —
// so the app has zero mandatory dependencies and tests never touch it.
//
// To use against a live site:  npm i -D playwright && npx playwright install chromium
//
// Read-only by design: navigates, scrolls, optionally clicks a consent-dismiss
// selector — never submits forms or mutates the site.
import { decodePng } from '../png.js';
import { MOBILE_MAX_WIDTH } from '../checks/responsive.js';

const FREEZE_CSS = `
  *, *::before, *::after {
    animation: none !important;
    transition: none !important;
    caret-color: transparent !important;
  }
  html { scroll-behavior: auto !important; }
`;

export function createPlaywrightAdapter({ timeoutMs = 30000, log = () => {} } = {}) {
  let browserPromise = null;

  async function getBrowser() {
    if (!browserPromise) {
      browserPromise = (async () => {
        let mod;
        try {
          mod = await import('playwright');
        } catch {
          throw new Error(
            'The live adapter needs Playwright, which is not installed.\n' +
              'Run: npm i -D playwright && npx playwright install chromium\n' +
              '(Tests never need this — they use the fixture adapter.)'
          );
        }
        return mod.chromium.launch({ headless: true });
      })();
    }
    return browserPromise;
  }

  return {
    name: 'playwright',

    async capturePage(url, { viewports = [1280], maskSelectors = [], consentSelector = null } = {}) {
      const browser = await getBrowser();
      const consoleMessages = [];
      const failedRequests = [];
      const metrics = {};
      const screenshots = {};
      const maskRects = {};
      let html = '';
      let finalUrl = url;

      for (const vp of viewports) {
        log(`GET ${url} @ ${vp}px`);
        const context = await browser.newContext({
          viewport: { width: Number(vp), height: 900 },
          deviceScaleFactor: 1,
          reducedMotion: 'reduce',
        });
        const page = await context.newPage();
        page.on('console', (msg) => {
          const type = msg.type();
          if (type === 'error' || type === 'warning') consoleMessages.push({ type, text: msg.text(), viewport: Number(vp) });
        });
        page.on('pageerror', (err) => consoleMessages.push({ type: 'error', text: String(err), viewport: Number(vp) }));
        page.on('requestfailed', (req) => failedRequests.push({ url: req.url(), reason: req.failure()?.errorText, viewport: Number(vp) }));

        await page.goto(url, { waitUntil: 'networkidle', timeout: timeoutMs });
        await page.addStyleTag({ content: FREEZE_CSS });

        if (consentSelector) {
          const consent = page.locator(consentSelector).first();
          if (await consent.isVisible().catch(() => false)) await consent.click().catch(() => {});
        }

        // Trigger lazy loads, then settle and wait for fonts (gotcha: lazy
        // images/fonts cause flaky screenshots).
        await page.evaluate(async () => {
          await new Promise((resolve) => {
            let y = 0;
            const step = () => {
              y += 600;
              window.scrollTo(0, y);
              if (y < document.body.scrollHeight) setTimeout(step, 60);
              else resolve();
            };
            step();
          });
          window.scrollTo(0, 0);
          if (document.fonts?.ready) await document.fonts.ready;
        });
        await page.waitForLoadState('networkidle', { timeout: timeoutMs }).catch(() => {});

        metrics[String(vp)] = await page.evaluate((mobileMax) => {
          const doc = document.documentElement;
          const nav = document.querySelector('nav, [role="navigation"]');
          const toggle = document.querySelector(
            '.menu-toggle, .hamburger, [aria-label*="menu" i], button[aria-expanded]'
          );
          const visible = (el) => {
            if (!el) return false;
            const s = getComputedStyle(el);
            const r = el.getBoundingClientRect();
            return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
          };
          const links = [...document.querySelectorAll('a, button, [role="button"]')]
            .map((el) => {
              const r = el.getBoundingClientRect();
              return { label: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 40), x: r.x, y: r.y, w: r.width, h: r.height };
            })
            .filter((t) => t.w > 0 && t.h > 0 && t.y < window.innerHeight);
          const inlineNavLinks = nav ? [...nav.querySelectorAll('a')].filter(visible).length : 0;
          return {
            scrollWidth: Math.max(doc.scrollWidth, document.body.scrollWidth),
            viewportWidth: window.innerWidth,
            // Collapsed = a menu toggle is visible, or the nav shows no inline links.
            navCollapsed: window.innerWidth <= mobileMax ? visible(toggle) || inlineNavLinks === 0 : false,
            tapTargets: links.slice(0, 100),
          };
        }, MOBILE_MAX_WIDTH);

        // Mask rects for dynamic regions, measured per viewport.
        if (maskSelectors.length) {
          maskRects[String(vp)] = await page.evaluate((selectors) => {
            const rects = [];
            for (const sel of selectors) {
              for (const el of document.querySelectorAll(sel)) {
                const r = el.getBoundingClientRect();
                rects.push({ x: r.x + window.scrollX, y: r.y + window.scrollY, w: r.width, h: r.height });
              }
            }
            return rects;
          }, maskSelectors);
        }

        const png = await page.screenshot({ fullPage: true, animations: 'disabled' });
        screenshots[String(vp)] = decodePng(png);

        html = await page.content();
        finalUrl = page.url();
        await context.close();
      }

      return { url, finalUrl, html, console: consoleMessages, failedRequests, viewports: metrics, screenshots, maskRects };
    },

    /** HEAD-ish status check with a manual redirect walk (records the chain). */
    async fetchStatus(url) {
      const chain = [];
      let current = url;
      try {
        for (let hop = 0; hop <= 5; hop++) {
          log(`CHECK ${current}`);
          const res = await fetch(current, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
          if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
            chain.push(current);
            current = new URL(res.headers.get('location'), current).href;
            continue;
          }
          res.body?.cancel?.().catch(() => {});
          // chain holds one entry per redirect hop (checkLinks: 1 => info, >=2 => warn).
          return { status: res.status, finalUrl: current, redirectChain: chain };
        }
        return { status: 0, error: 'too many redirects', redirectChain: chain };
      } catch (err) {
        return { status: 0, error: err?.cause?.code || err.message, redirectChain: chain };
      }
    },

    /**
     * WP facts via REST API (+ Application Password when provided). Never
     * screen-scrapes admin, never uses SSH. Degrades to restAvailable:false.
     */
    async fetchWpInfo(url, auth = null) {
      const origin = new URL(url).origin;
      const headers = { accept: 'application/json' };
      if (auth?.user && auth?.password) {
        if (!origin.startsWith('https:')) {
          return { restAvailable: false, note: 'refusing to send Application Password over plain http' };
        }
        headers.authorization = 'Basic ' + Buffer.from(`${auth.user}:${auth.password}`).toString('base64');
      }
      const get = async (p) => {
        log(`GET ${origin}${p}`);
        const res = await fetch(`${origin}${p}`, { headers, signal: AbortSignal.timeout(timeoutMs) });
        return res;
      };
      const getJson = async (p) => {
        const res = await get(p);
        if (!res.ok) return null;
        return res.json().catch(() => null);
      };

      try {
        const root = await get('/wp-json/');
        if (!root.ok) return { restAvailable: false, note: `REST API returned HTTP ${root.status}` };
        await root.body?.cancel?.().catch(() => {});
      } catch (err) {
        return { restAvailable: false, note: `REST API unreachable: ${err.message}` };
      }

      const info = { restAvailable: true, theme: null, plugins: [], samplePages: [], debugOutput: false, sitemapStatus: null, robotsStatus: null };

      const themes = await getJson('/wp-json/wp/v2/themes?status=active');
      if (Array.isArray(themes) && themes[0]) {
        info.theme = { name: themes[0].stylesheet || themes[0].name?.rendered, version: themes[0].version };
      }
      const plugins = await getJson('/wp-json/wp/v2/plugins');
      if (Array.isArray(plugins)) {
        info.plugins = plugins.map((p) => ({
          name: p.plugin?.split('/')[0] || p.name,
          version: p.version,
          active: p.status === 'active',
          updateAvailable: Boolean(p.update?.new_version),
        }));
      }

      for (const [type, search] of [['posts', 'Hello world'], ['pages', 'Sample Page']]) {
        const hits = await getJson(`/wp-json/wp/v2/${type}?search=${encodeURIComponent(search)}&per_page=5`);
        for (const hit of hits || []) {
          const title = hit.title?.rendered || '';
          if (/hello world|sample page/i.test(title)) info.samplePages.push(title);
        }
      }

      try {
        const home = await fetch(origin + '/', { signal: AbortSignal.timeout(timeoutMs) });
        const body = await home.text();
        info.debugOutput = /<b>(Warning|Notice|Deprecated|Fatal error)<\/b>:\s|Stack trace:/i.test(body);
      } catch {
        /* leave false */
      }
      for (const [key, p] of [['sitemapStatus', '/wp-sitemap.xml'], ['robotsStatus', '/robots.txt']]) {
        try {
          const res = await fetch(origin + p, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
          info[key] = res.status;
          await res.body?.cancel?.().catch(() => {});
        } catch {
          info[key] = 0;
        }
      }
      if (info.sitemapStatus !== 200) {
        try {
          const res = await fetch(origin + '/sitemap.xml', { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
          if (res.status === 200) info.sitemapStatus = 200;
          await res.body?.cancel?.().catch(() => {});
        } catch {
          /* keep previous */
        }
      }
      return info;
    },

    /**
     * Verify an Application Password works, for the connectivity preflight.
     * One authed GET to the REST "me" endpoint. HTTPS only; never logs the
     * secret. Returns { ok, status, error? }.
     */
    async verifyAuth(url, auth) {
      const origin = new URL(url).origin;
      if (!origin.startsWith('https:')) {
        return { ok: false, status: 0, error: 'refusing to send an Application Password over plain http' };
      }
      if (!auth?.user || !auth?.password) return { ok: false, status: 0, error: 'no credentials provided' };
      const headers = {
        accept: 'application/json',
        authorization: 'Basic ' + Buffer.from(`${auth.user}:${auth.password}`).toString('base64'),
      };
      try {
        log(`AUTH ${origin}/wp-json/wp/v2/users/me`);
        const res = await fetch(`${origin}/wp-json/wp/v2/users/me?context=edit`, {
          headers,
          signal: AbortSignal.timeout(timeoutMs),
        });
        await res.body?.cancel?.().catch(() => {});
        if (res.status === 200) return { ok: true, status: 200 };
        if (res.status === 401 || res.status === 403) {
          return { ok: false, status: res.status, error: `authentication failed (HTTP ${res.status}) — check the user and Application Password` };
        }
        return { ok: false, status: res.status, error: `unexpected HTTP ${res.status} from the REST me endpoint` };
      } catch (err) {
        return { ok: false, status: 0, error: err?.cause?.code || err.message };
      }
    },

    async close() {
      if (browserPromise) {
        const browser = await browserPromise.catch(() => null);
        await browser?.close?.().catch(() => {});
        browserPromise = null;
      }
    },
  };
}
