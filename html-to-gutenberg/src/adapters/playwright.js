// Render-verify adapter: log into wp-admin with a real user session, open the
// block editor for the page, and report block validity / block list / console
// errors via the wp.data stores (iframe-agnostic, unlike DOM selectors).

import { chromium } from 'playwright';

export function createPlaywrightAdapter({ baseUrl, user, password, headless = true, timeoutMs = 45_000 }) {
  if (!baseUrl) throw new Error('playwright adapter needs wp.base_url (or WP_BASE_URL)');
  if (!user || !password) {
    throw new Error(
      'verify needs a real wp-admin login: H2G_EDITOR_USER + H2G_EDITOR_PASSWORD (app passwords do not work for wp-login.php)'
    );
  }
  const base = baseUrl.replace(/\/$/, '');

  return {
    name: 'playwright',

    async open(target) {
      const browser = await chromium.launch({ headless });
      const page = await browser.newPage();
      const consoleErrors = [];
      page.on('console', (m) => {
        if (m.type() === 'error') consoleErrors.push(m.text());
      });
      page.on('pageerror', (e) => consoleErrors.push(String(e)));

      await page.goto(`${base}/wp-login.php`, { waitUntil: 'domcontentloaded' });
      await page.fill('#user_login', user);
      await page.fill('#user_pass', password);
      await Promise.all([
        page.waitForURL(/wp-admin/, { timeout: timeoutMs }).catch(() => {}),
        page.click('#wp-submit'),
      ]);
      if (!page.url().includes('/wp-admin')) {
        const err = await page.locator('#login_error').textContent().catch(() => null);
        await browser.close();
        throw new Error(`wp-admin login failed for ${user}: ${(err || 'no error shown').trim()}`);
      }

      const editorUrl = /^\d+$/.test(String(target))
        ? `${base}/wp-admin/post.php?post=${target}&action=edit`
        : String(target);
      await page.goto(editorUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(
        () => window.wp?.data?.select('core/editor')?.getCurrentPostId() > 0,
        { timeout: timeoutMs }
      );
      // Give the editor a beat to finish parsing content into blocks.
      await page.waitForFunction(
        () => window.wp.data.select('core/block-editor').getBlocks() !== undefined,
        { timeout: timeoutMs }
      );
      await page.waitForTimeout(1000);
      return { browser, page, consoleErrors };
    },

    async listBlocks({ page }) {
      return page.evaluate(() => {
        const flat = [];
        const walk = (blocks) => {
          for (const b of blocks) {
            flat.push({ name: b.name, isValid: b.isValid !== false });
            if (b.innerBlocks?.length) walk(b.innerBlocks);
          }
        };
        walk(window.wp.data.select('core/block-editor').getBlocks());
        return flat;
      });
    },

    async getInvalidBlockWarnings(session) {
      const blocks = await this.listBlocks(session);
      return blocks.filter((b) => !b.isValid).map((b) => `invalid block: ${b.name}`);
    },

    async getConsoleErrors({ consoleErrors }) {
      // Resource-load noise (missing favicons etc.) is not a block problem.
      return consoleErrors.filter((e) => !/Failed to load resource/i.test(e));
    },

    async close({ browser }) {
      await browser.close();
    },
  };
}
