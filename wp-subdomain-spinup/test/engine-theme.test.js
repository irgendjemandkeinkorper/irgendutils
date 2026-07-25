// cmdCreate theme-activation step: REST has no theme-activation endpoint, so
// after cloning the engine must activate the template's theme via WP-CLI when
// SSH is available, and emit the exact manual command when it is not.

import test from 'node:test';
import assert from 'node:assert/strict';
import { cmdCreate, EXIT } from '../src/engine.js';

const host = (url) => new URL(url).hostname;

function makeCtx({ ssh = true, activateFails = false, existingSites = [] } = {}) {
  const config = {
    mode: 'multisite',
    network_url: 'https://example.com',
    wp_cli_ssh: ssh ? 'host:/var/www/example.com' : undefined,
    template_slug: 'template-mise',
    rest: {
      base_url: 'https://{sub}.example.com',
      user: 'automation',
      app_password_env: 'WP_APP_PASSWORD',
    },
    dns: { provider: 'manual', zone: 'example.com' },
  };
  // network state: which sites exist, and each site's active theme by host
  const state = {
    sites: new Set(['template-mise', ...existingSites]),
    themes: { 'template-mise.example.com': 'mise' },
    activations: 0,
  };
  for (const s of existingSites) state.themes[`${s}.example.com`] = 'twentytwentyfive';

  const adapters = {
    dns: { resolves: async () => true },
    wpcli: {
      detect: async () => ssh,
      siteExists: async (slug) => state.sites.has(slug),
      createSite: async ({ slug, url }) => {
        state.sites.add(slug);
        state.themes[host(url)] = 'twentytwentyfive';
      },
      activateTheme: async ({ url, theme }) => {
        state.activations += 1;
        if (activateFails) throw new Error('boom');
        state.themes[host(url)] = theme;
      },
      searchReplace: async () => ({ count: 0 }),
    },
    rest: {
      ping: async () => ({ https: true, status: 200 }),
      siteExists: async (url) => state.sites.has(host(url).split('.')[0]),
      clone: async ({ templateUrl }) => ({
        theme: state.themes[host(templateUrl)],
        plugins: [],
        pages: 2,
      }),
      activeTheme: async (url) => state.themes[host(url)] ?? null,
      activePlugins: async () => [],
      siteInfo: async (url) => ({ siteurl: url }),
      authCheck: async () => true,
      searchReplace: async () => ({ count: 0 }),
    },
  };
  return { ctx: { config, adapters, log: () => {} }, state };
}

test('create activates the template theme via WP-CLI and passes verify', async () => {
  const { ctx, state } = makeCtx();
  const res = await cmdCreate(ctx, 'acme', { apply: true });
  assert.equal(res.exitCode, EXIT.OK);
  assert.equal(state.themes['acme.example.com'], 'mise');
  assert.ok(res.messages.some((m) => m.includes('theme: activated mise via WP-CLI')));
});

test('create skips activation when the theme is already active', async () => {
  const { ctx, state } = makeCtx({ existingSites: ['acme'] });
  state.themes['acme.example.com'] = 'mise';
  const res = await cmdCreate(ctx, 'acme', { apply: true, force: true });
  assert.equal(res.exitCode, EXIT.OK);
  assert.equal(state.activations, 0);
  assert.ok(res.messages.some((m) => m.includes('theme: mise already active')));
});

test('create without SSH emits the manual activation command and fails verify', async () => {
  // Site already exists (created manually) so the REST-only path reaches clone.
  const { ctx } = makeCtx({ ssh: false, existingSites: ['acme'] });
  const res = await cmdCreate(ctx, 'acme', { apply: true, force: true });
  assert.equal(res.exitCode, EXIT.FAIL);
  assert.ok(res.messages.some((m) => m.includes('wp theme enable mise --url=acme.example.com --activate')));
  assert.ok(res.checks.some((c) => c.id === 'theme' && !c.ok));
});

test('create degrades to the manual command when WP-CLI activation errors', async () => {
  const { ctx } = makeCtx({ activateFails: true });
  const res = await cmdCreate(ctx, 'acme', { apply: true });
  assert.equal(res.exitCode, EXIT.FAIL);
  assert.ok(res.messages.some((m) => m.includes('WP-CLI activation failed (boom)')));
  assert.ok(res.messages.some((m) => m.includes('wp theme enable mise --url=acme.example.com --activate')));
});

test('dry-run plan includes the theme activation step', async () => {
  const { ctx } = makeCtx();
  const res = await cmdCreate(ctx, 'acme', { apply: false });
  assert.equal(res.exitCode, EXIT.OK);
  assert.ok(res.plan.some((p) => p.startsWith('theme: activate the template theme')));
});
