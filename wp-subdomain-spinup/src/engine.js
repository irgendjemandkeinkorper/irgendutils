// Core orchestration for create / teardown / list / verify.
//
// Pure with respect to I/O: every external effect goes through the injected
// `adapters` object ({ wpcli, rest, dns }), so tests drive the engine with
// in-memory fakes and the CLI drives it with the real adapters (lazily
// loaded). Dry-run is the default for mutating commands; `apply: true` is
// required to touch anything.
//
// Exit codes: 0 ok / clean / dry-run, 1 failure / collision / verify failed,
// 2 validation or usage error, 3 manual step required (no SSH, manual DNS).

import { validateSubdomain, fqdnFor, urlFor, hostOf } from './subdomain.js';

export const EXIT = { OK: 0, FAIL: 1, USAGE: 2, MANUAL: 3 };

function result(status, exitCode, messages, extra = {}) {
  return { status, exitCode, messages, ...extra };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pollUntil(fn, { timeoutMs = 120_000, intervalMs = 2_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await fn()) return true;
    if (Date.now() >= deadline) return false;
    await sleep(intervalMs);
  }
}

/** Cache WP-CLI/SSH detection per context so we only probe once per run. */
async function sshAvailable(ctx) {
  if (ctx._ssh === undefined) {
    ctx._ssh = Boolean(ctx.config.wp_cli_ssh) && (await ctx.adapters.wpcli.detect());
    ctx.log?.('detect', { wpcli_ssh: ctx._ssh });
  }
  return ctx._ssh;
}

/** Serialization-safe URL rewrite: WP-CLI when reachable, REST fallback. */
async function searchReplace(ctx, sub, url, from, to, { dryRun }) {
  if (await sshAvailable(ctx)) {
    return ctx.adapters.wpcli.searchReplace({ site: sub, url, from, to, dryRun });
  }
  return ctx.adapters.rest.searchReplace({ url, from, to, dryRun });
}

async function siteExists(ctx, sub, url) {
  if (await sshAvailable(ctx)) return ctx.adapters.wpcli.siteExists(sub);
  if (ctx.adapters.rest.siteExists) return ctx.adapters.rest.siteExists(url);
  const ping = await ctx.adapters.rest.ping(url);
  return ping.status === 200;
}

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

export async function cmdCreate(ctx, sub, opts = {}) {
  const { config, adapters } = ctx;
  const log = ctx.log ?? (() => {});
  const messages = [];

  // 1. Validate input (read-only, always runs).
  const v = validateSubdomain(sub, { reserved: [config.template_slug] });
  if (!v.ok) {
    return result('invalid', EXIT.USAGE, [
      `Invalid subdomain ${JSON.stringify(sub ?? '')}: ${v.errors.join('; ')}`,
    ]);
  }

  const fqdn = fqdnFor(config, sub);
  const url = urlFor(config, sub);
  const templateUrl = urlFor(config, config.template_slug);
  const dnsProvider = config.dns?.provider ?? 'manual';
  const manualDns = dnsProvider === 'manual';

  // Collision check (read-only, always runs). Re-running create against an
  // existing site is an idempotent no-op unless --force re-runs the steps.
  // Standalone mode ASSUMES WP core already exists at the target, so an
  // answering site there is the precondition, not a collision.
  const exists = config.mode === 'multisite' ? await siteExists(ctx, sub, url) : false;
  if (exists && !opts.force) {
    return result('exists', EXIT.FAIL, [
      `Site already exists: ${fqdn}`,
      'Aborting without changes (idempotent no-op).',
      'Re-run with --force to re-apply the remaining provisioning steps, or pick another subdomain.',
    ]);
  }

  // 2..7 are the mutating plan.
  const plan = [
    manualDns
      ? `dns: MANUAL — add a CNAME/A record for ${fqdn} pointing at ${hostOf(config.network_url)}`
      : `dns: ensure ${dnsProvider} record ${fqdn} -> ${hostOf(config.network_url)}, then poll until it resolves`,
    config.mode === 'multisite'
      ? `provision: wp site create --slug=${sub} --url=${url} (WP-CLI over SSH, or manual command if SSH is unreachable)`
      : `provision: standalone — assume WP core already installed at ${url}, check it responds`,
    `clone: copy theme, plugin set, settings, menus and starter pages from ${config.template_slug} (${templateUrl})`,
    `rewrite: search-replace ${templateUrl} -> ${url} (dry-run count first, then apply, then re-check count == 0)`,
    opts.brand
      ? `brand: apply brand tokens (${Object.keys(opts.brand).join(', ')})`
      : 'brand: none provided (--brand brand.json to customize)',
    `tls: require ${fqdn} to serve https with a valid cert`,
    `verify: full acceptance checks against ${url}`,
  ];

  if (!opts.apply) {
    return result('dry-run', EXIT.OK, [
      `DRY RUN — no changes made. Plan for ${fqdn}:`,
      ...plan.map((p, i) => `  ${i + 1}. ${p}`),
      'Re-run with --apply to execute.',
    ], { plan });
  }

  // --- 2. DNS ---
  if (manualDns) {
    log('dns.manual', { fqdn });
    const resolves = adapters.dns ? await adapters.dns.resolves(fqdn) : false;
    if (!resolves) {
      return result('manual-step-required', EXIT.MANUAL, [
        'Manual DNS step required. Add this record at your DNS provider:',
        `  ${fqdn}.  CNAME  ${hostOf(config.network_url)}.`,
        '(or an A record pointing at the same origin IP)',
        `Then re-run: spinup create ${sub} --apply --force`,
      ]);
    }
    messages.push(`dns: ${fqdn} already resolves (manual provider) — ok`);
  } else {
    if (!(await adapters.dns.recordExists(fqdn))) {
      log('dns.create', { provider: dnsProvider, fqdn });
      await adapters.dns.createRecord(fqdn, hostOf(config.network_url));
      messages.push(`dns: created ${dnsProvider} record for ${fqdn}`);
    } else {
      messages.push(`dns: record for ${fqdn} already exists — skipped`);
    }
    const resolved = await pollUntil(() => adapters.dns.resolves(fqdn), {
      timeoutMs: ctx.dnsTimeoutMs ?? 120_000,
      intervalMs: ctx.dnsIntervalMs ?? 2_000,
    });
    if (!resolved) {
      return result('failed', EXIT.FAIL, [
        ...messages,
        `dns: ${fqdn} did not resolve within the timeout — aborting before provisioning.`,
      ]);
    }
    messages.push(`dns: ${fqdn} resolves`);
  }

  // --- 3. Provision the site (the only step that may need SSH) ---
  if (config.mode === 'multisite') {
    if (await sshAvailable(ctx)) {
      if (!(await adapters.wpcli.siteExists(sub))) {
        log('wpcli.siteCreate', { sub });
        await adapters.wpcli.createSite({ slug: sub, url });
        messages.push(`provision: created network site ${sub} via WP-CLI`);
      } else {
        messages.push(`provision: network site ${sub} already exists — skipped`);
      }
    } else if (!(await siteExists(ctx, sub, url))) {
      return result('manual-step-required', EXIT.MANUAL, [
        ...messages,
        'WP-CLI over SSH is not reachable, and creating a multisite site is the one step',
        'with no REST equivalent. Run this on the server (or via your host panel):',
        `  wp site create --slug=${sub} --url=${url} --title=${JSON.stringify(sub)}`,
        `Then re-run: spinup create ${sub} --apply --force`,
        '(everything after site creation runs over REST — no SSH needed)',
      ]);
    } else {
      messages.push(`provision: site ${sub} already exists (REST) — skipped`);
    }
  } else {
    // standalone: WP core must already exist at the target (documented).
    const ping = await adapters.rest.ping(url);
    if (ping.status !== 200) {
      return result('failed', EXIT.FAIL, [
        ...messages,
        `provision: standalone mode assumes WP core is already installed at ${url},`,
        `but it responded with status ${ping.status}. Install WP there first.`,
      ]);
    }
    messages.push(`provision: standalone site responds at ${url}`);
  }

  // --- 4. Clone from template (REST in both modes) ---
  log('rest.clone', { from: templateUrl, to: url });
  const cloned = await adapters.rest.clone({
    templateUrl,
    templateSlug: config.template_slug,
    url,
    slug: sub,
  });
  messages.push(
    `clone: theme=${cloned.theme} plugins=[${cloned.plugins.join(', ')}] pages=${cloned.pages}`
  );

  // --- URL rewrite: dry-run first, then apply, then confirm count == 0 ---
  const before = await searchReplace(ctx, sub, url, templateUrl, url, { dryRun: true });
  log('rewrite.dry-run', { count: before.count });
  if (before.count > 0) {
    await searchReplace(ctx, sub, url, templateUrl, url, { dryRun: false });
    messages.push(`rewrite: replaced ${before.count} occurrence(s) of ${templateUrl}`);
  } else {
    messages.push('rewrite: nothing to replace');
  }
  const after = await searchReplace(ctx, sub, url, templateUrl, url, { dryRun: true });
  if (after.count !== 0) {
    return result('failed', EXIT.FAIL, [
      ...messages,
      `rewrite: ${after.count} template URL(s) still present after rewrite — aborting.`,
    ]);
  }
  messages.push('rewrite: dry re-run count == 0 — clean');

  // --- 5. Brand tokens ---
  if (opts.brand) {
    log('rest.brand', { keys: Object.keys(opts.brand) });
    await adapters.rest.applyBrand(url, opts.brand);
    messages.push(`brand: applied (${Object.keys(opts.brand).join(', ')})`);
  }

  // --- 6. TLS ---
  const tls = await adapters.rest.ping(url);
  if (!tls.https || tls.status !== 200) {
    return result('failed', EXIT.FAIL, [
      ...messages,
      `tls: ${url} does not serve https with status 200 (https=${tls.https}, status=${tls.status}).`,
      'Check the wildcard cert / trigger issuance, then run: spinup verify ' + sub,
    ]);
  }
  messages.push('tls: https ok');

  // --- 7. Verify + report ---
  const verify = await cmdVerify(ctx, sub);
  if (verify.exitCode !== EXIT.OK) {
    return result('failed', EXIT.FAIL, [...messages, ...verify.messages], {
      checks: verify.checks,
    });
  }

  return result('created', EXIT.OK, [
    ...messages,
    ...verify.messages,
    '',
    `Live: ${url}`,
    `Admin: ${url.replace(/\/$/, '')}/wp-admin/ (user: ${config.rest.user}, app password from $${config.rest.app_password_env})`,
  ], { url, checks: verify.checks });
}

// ---------------------------------------------------------------------------
// teardown
// ---------------------------------------------------------------------------

export async function cmdTeardown(ctx, sub, opts = {}) {
  const { config, adapters } = ctx;
  const log = ctx.log ?? (() => {});
  const messages = [];

  const v = validateSubdomain(sub, { reserved: [] });
  if (!v.ok) {
    return result('invalid', EXIT.USAGE, [
      `Invalid subdomain ${JSON.stringify(sub ?? '')}: ${v.errors.join('; ')}`,
    ]);
  }
  if (sub === config.template_slug) {
    return result('invalid', EXIT.USAGE, [
      `Refusing to tear down the template site (${config.template_slug}).`,
    ]);
  }

  const fqdn = fqdnFor(config, sub);
  const url = urlFor(config, sub);
  const dnsProvider = config.dns?.provider ?? 'manual';

  const exists = await siteExists(ctx, sub, url);
  const hasRecord =
    dnsProvider !== 'manual' && adapters.dns ? await adapters.dns.recordExists(fqdn) : false;

  if (!exists && !hasRecord) {
    return result('clean', EXIT.OK, [
      `Nothing to tear down: ${fqdn} has no site and no managed DNS record. Already clean.`,
    ]);
  }

  const plan = [];
  if (exists) {
    plan.push(
      config.mode === 'multisite'
        ? `site: wp site delete ${sub} --yes (WP-CLI over SSH, or manual command if unreachable)`
        : `site: remove cloned content from ${url} over REST (WP core/vhost removal is your host's job)`
    );
  }
  if (hasRecord) plan.push(`dns: delete ${dnsProvider} record ${fqdn}`);
  plan.push('verify: re-run list to confirm the network is clean');

  if (!opts.apply) {
    return result('dry-run', EXIT.OK, [
      `DRY RUN — no changes made. Teardown plan for ${fqdn}:`,
      ...plan.map((p, i) => `  ${i + 1}. ${p}`),
      'Re-run with --apply to execute.',
    ], { plan });
  }

  let manualNeeded = false;

  if (exists) {
    if (config.mode === 'multisite') {
      if (await sshAvailable(ctx)) {
        log('wpcli.siteDelete', { sub });
        await adapters.wpcli.deleteSite(sub);
        messages.push(`site: deleted network site ${sub} via WP-CLI`);
      } else {
        manualNeeded = true;
        messages.push(
          'site: WP-CLI over SSH is not reachable — run this on the server:',
          `  wp site delete ${sub} --yes`
        );
      }
    } else {
      log('rest.teardown', { url });
      await adapters.rest.teardownSite(url);
      messages.push(`site: removed cloned content at ${url} (host vhost/core removal is manual)`);
    }
  } else {
    messages.push('site: no site found — skipped');
  }

  if (hasRecord) {
    log('dns.delete', { provider: dnsProvider, fqdn });
    await adapters.dns.deleteRecord(fqdn);
    messages.push(`dns: deleted ${dnsProvider} record for ${fqdn}`);
  } else if (dnsProvider === 'manual') {
    messages.push(`dns: manual provider — remove the ${fqdn} record at your DNS provider if you added one`);
  }

  if (manualNeeded) {
    return result('manual-step-required', EXIT.MANUAL, [
      ...messages,
      `Then re-run: spinup teardown ${sub} --apply  (to confirm clean state)`,
    ]);
  }

  // Verify clean state (confirm by re-running list).
  const listAfter = await cmdList(ctx);
  const stillThere = listAfter.sites.some((s) => s.slug === sub);
  const recordLeft =
    dnsProvider !== 'manual' && adapters.dns ? await adapters.dns.recordExists(fqdn) : false;
  if (stillThere || recordLeft) {
    return result('failed', EXIT.FAIL, [
      ...messages,
      `verify: teardown incomplete (site present: ${stillThere}, dns record present: ${recordLeft}).`,
    ]);
  }

  return result('torn-down', EXIT.OK, [
    ...messages,
    `verify: ${sub} no longer in site list, no managed DNS record left — network clean.`,
  ]);
}

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

export async function cmdList(ctx) {
  const { config, adapters } = ctx;
  let sites;
  if (await sshAvailable(ctx)) {
    sites = await adapters.wpcli.listSites();
  } else {
    sites = (await adapters.rest.listSites()) ?? [];
  }
  const rows = sites.map((s) => ({
    slug: s.slug,
    url: s.url,
    template: s.slug === config.template_slug,
  }));
  const messages =
    rows.length === 0
      ? ['No sites found.']
      : rows.map((r) => `  ${r.slug.padEnd(20)} ${r.url}${r.template ? '   (template)' : ''}`);
  return result('listed', EXIT.OK, messages, { sites: rows });
}

// ---------------------------------------------------------------------------
// verify — the acceptance criteria, as checks
// ---------------------------------------------------------------------------

export async function cmdVerify(ctx, sub) {
  const { config, adapters } = ctx;

  const v = validateSubdomain(sub, { reserved: [] });
  if (!v.ok) {
    return result('invalid', EXIT.USAGE, [
      `Invalid subdomain ${JSON.stringify(sub ?? '')}: ${v.errors.join('; ')}`,
    ]);
  }

  const url = urlFor(config, sub);
  const templateUrl = urlFor(config, config.template_slug);
  const checks = [];
  const add = (id, label, ok, detail) => checks.push({ id, label, ok: Boolean(ok), detail });

  // https + 200
  const ping = await adapters.rest.ping(url);
  add('https-200', 'resolves over https and returns 200', ping.https && ping.status === 200,
    `https=${ping.https} status=${ping.status}`);

  if (ping.status === 200) {
    // siteurl reports the new subdomain, not the template's
    const info = await adapters.rest.siteInfo(url);
    const wantHost = hostOf(url);
    const gotHost = hostOf(info.siteurl || '');
    add('siteurl', 'siteurl reports the new subdomain', gotHost === wantHost,
      `siteurl=${info.siteurl}`);

    // no leftover template-domain URLs (search-replace dry-run count == 0)
    const leftover = await searchReplace(ctx, sub, url, templateUrl, url, { dryRun: true });
    add('no-template-urls', 'no leftover template URLs in content (dry-run count == 0)',
      leftover.count === 0, `count=${leftover.count}`);

    // template theme active, template plugins active
    const [tTheme, sTheme] = await Promise.all([
      adapters.rest.activeTheme(templateUrl),
      adapters.rest.activeTheme(url),
    ]);
    add('theme', 'template theme is the active theme', tTheme === sTheme,
      `template=${tTheme} site=${sTheme}`);

    const [tPlugins, sPlugins] = await Promise.all([
      adapters.rest.activePlugins(templateUrl),
      adapters.rest.activePlugins(url),
    ]);
    const missing = tPlugins.filter((p) => !sPlugins.includes(p));
    add('plugins', 'template plugins are active', missing.length === 0,
      missing.length ? `missing: ${missing.join(', ')}` : `${sPlugins.length} active`);

    // authenticated REST smoke test
    const authOk = await adapters.rest.authCheck(url);
    add('auth', 'admin user can log in (authenticated REST call)', authOk,
      authOk ? `user=${config.rest.user}` : 'authenticated request failed');
  }

  const failed = checks.filter((c) => !c.ok);
  const lines = checks.map(
    (c) => `  [${c.ok ? 'PASS' : 'FAIL'}] ${c.label}${c.detail ? ` (${c.detail})` : ''}`
  );
  if (failed.length > 0) {
    return result('verify-failed', EXIT.FAIL, [
      `verify ${sub}:`, ...lines, `${failed.length} of ${checks.length} checks FAILED.`,
    ], { checks });
  }
  return result('verified', EXIT.OK, [
    `verify ${sub}:`, ...lines, `All ${checks.length} checks passed.`,
  ], { checks });
}
