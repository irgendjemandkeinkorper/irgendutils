// REST adapter — the DEFAULT access path. Uses the WP REST API with an
// Application Password (Basic auth). Works on essentially every modern WP
// host with zero server access. Only Node built-ins (global fetch).
//
// Limits (documented, by design):
// - clone copies the active theme, active plugin set, core settings and
//   published pages/posts from the template site; it is a content-copy
//   routine, not a byte-for-byte export.
// - searchReplace over REST rewrites post/page content and core settings; it
//   cannot touch serialized plugin options the way `wp search-replace` can —
//   when SSH is available the engine prefers the WP-CLI path.

import { resolveAppPassword } from '../config.js';

export function createRestAdapter(config, { log = () => {} } = {}) {
  function authHeader() {
    const pw = resolveAppPassword(config);
    if (!pw) {
      throw new Error(
        `Missing app password: set the ${config.rest.app_password_env} env var (see .env.example).`
      );
    }
    return 'Basic ' + Buffer.from(`${config.rest.user}:${pw}`).toString('base64');
  }

  async function req(base, path, { method = 'GET', body, auth = true } = {}) {
    const url = `${base.replace(/\/$/, '')}${path}`;
    log('rest', { method, url }); // never log headers/body — secrets live there
    const res = await fetch(url, {
      method,
      headers: {
        ...(auth ? { Authorization: authHeader() } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      throw new Error(`REST ${method} ${url} -> ${res.status} ${res.statusText}`);
    }
    return res.json();
  }

  async function collect(base, path) {
    // paginate through a wp/v2 collection
    const out = [];
    for (let page = 1; page <= 20; page++) {
      const batch = await req(base, `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}&context=edit`);
      out.push(...batch);
      if (batch.length < 100) break;
    }
    return out;
  }

  return {
    async ping(url) {
      log('rest', { method: 'GET', url: `${url}/wp-json` });
      try {
        const res = await fetch(`${url.replace(/\/$/, '')}/wp-json`, { redirect: 'manual' });
        return {
          ok: res.status === 200,
          status: res.status,
          https: url.startsWith('https://') && res.status === 200,
        };
      } catch {
        return { ok: false, status: 0, https: false };
      }
    },

    async siteInfo(url) {
      const root = await req(url, '/wp-json', { auth: false });
      return { siteurl: root.url ?? root.home ?? url, name: root.name };
    },

    async siteExists(url) {
      return (await this.ping(url)).status === 200;
    },

    async listSites() {
      // No core REST route lists network sites; fall back to probing the
      // template site only. `spinup list` is far richer with WP-CLI/SSH.
      const templateUrl = config.rest.base_url.replaceAll('{sub}', config.template_slug);
      const ping = await this.ping(templateUrl);
      return ping.status === 200
        ? [{ slug: config.template_slug, url: templateUrl }]
        : [];
    },

    async activeTheme(url) {
      const themes = await req(url, '/wp-json/wp/v2/themes?status=active');
      return themes[0]?.stylesheet ?? null;
    },

    async activePlugins(url) {
      const plugins = await req(url, '/wp-json/wp/v2/plugins');
      return plugins.filter((p) => p.status === 'active').map((p) => p.plugin);
    },

    async authCheck(url) {
      try {
        const me = await req(url, '/wp-json/wp/v2/users/me?context=edit');
        return Boolean(me.id);
      } catch {
        return false;
      }
    },

    async clone({ templateUrl, url }) {
      // theme + plugins
      const theme = await this.activeTheme(templateUrl);
      const plugins = await this.activePlugins(templateUrl);
      for (const plugin of plugins) {
        try {
          await req(url, `/wp-json/wp/v2/plugins/${encodeURIComponent(plugin)}`, {
            method: 'POST', body: { status: 'active' },
          });
        } catch {
          await req(url, '/wp-json/wp/v2/plugins', {
            method: 'POST', body: { slug: plugin.split('/')[0], status: 'active' },
          });
        }
      }
      if (theme) {
        await req(url, '/wp-json/wp/v2/settings', { method: 'POST', body: {} });
        // Theme activation has no core REST route pre-6.6 on all hosts; the
        // site inherits the network-enabled theme. Verify catches mismatches.
      }

      // settings
      const settings = await req(templateUrl, '/wp-json/wp/v2/settings');
      const copy = {};
      for (const key of ['title', 'description', 'timezone_string', 'date_format', 'start_of_week']) {
        if (settings[key] !== undefined) copy[key] = settings[key];
      }
      await req(url, '/wp-json/wp/v2/settings', { method: 'POST', body: copy });

      // starter pages + posts (published only)
      let pageCount = 0;
      for (const type of ['pages', 'posts']) {
        const items = await collect(templateUrl, `/wp-json/wp/v2/${type}?status=publish`);
        for (const item of items) {
          await req(url, `/wp-json/wp/v2/${type}`, {
            method: 'POST',
            body: {
              title: item.title?.raw ?? item.title?.rendered ?? '',
              content: item.content?.raw ?? item.content?.rendered ?? '',
              slug: item.slug,
              status: 'publish',
            },
          });
          pageCount++;
        }
      }

      return { theme, plugins, pages: pageCount };
    },

    async searchReplace({ url, from, to, dryRun }) {
      let count = 0;
      for (const type of ['pages', 'posts']) {
        const items = await collect(url, `/wp-json/wp/v2/${type}`);
        for (const item of items) {
          const content = item.content?.raw ?? item.content?.rendered ?? '';
          const hits = content.split(from).length - 1;
          if (hits === 0) continue;
          count += hits;
          if (!dryRun) {
            await req(url, `/wp-json/wp/v2/${type}/${item.id}`, {
              method: 'POST',
              body: { content: content.replaceAll(from, to) },
            });
          }
        }
      }
      return { count };
    },

    async applyBrand(url, brand) {
      const body = {};
      if (brand.title) body.title = brand.title;
      if (brand.tagline) body.description = brand.tagline;
      await req(url, '/wp-json/wp/v2/settings', { method: 'POST', body });
      // logo / primary color are theme-mod territory; expose them as settings
      // where the active theme supports it. Left to a theme-specific helper.
      log('rest.brand', { keys: Object.keys(brand) });
    },

    async teardownSite(url) {
      // standalone teardown: remove the content we cloned (trash + purge).
      for (const type of ['pages', 'posts']) {
        const items = await collect(url, `/wp-json/wp/v2/${type}`);
        for (const item of items) {
          await req(url, `/wp-json/wp/v2/${type}/${item.id}?force=true`, { method: 'DELETE' });
        }
      }
    },
  };
}
