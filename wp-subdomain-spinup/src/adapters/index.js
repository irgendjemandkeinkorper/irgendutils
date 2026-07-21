// Adapter loader. Real adapters (SSH, REST-over-HTTP, DNS APIs) are imported
// LAZILY here — the engine and tests never touch them. Tests (and anything
// else) can inject a complete fake adapter set via the SPINUP_ADAPTERS env
// var pointing at a module exporting `createAdapters(config, { log })`.

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function loadAdapters(config, ctx = {}) {
  if (process.env.SPINUP_ADAPTERS) {
    const mod = await import(pathToFileURL(resolve(process.env.SPINUP_ADAPTERS)).href);
    return mod.createAdapters(config, ctx);
  }

  const [{ createWpCliAdapter }, { createRestAdapter }] = await Promise.all([
    import('./wpcli-ssh.js'),
    import('./rest.js'),
  ]);

  const provider = config.dns?.provider ?? 'manual';
  const dnsMod =
    provider === 'cloudflare'
      ? await import('./dns-cloudflare.js')
      : provider === 'route53'
        ? await import('./dns-route53.js')
        : await import('./dns-manual.js');

  return {
    wpcli: createWpCliAdapter(config, ctx),
    rest: createRestAdapter(config, ctx),
    dns: dnsMod.createDnsAdapter(config, ctx),
  };
}
