// WP-CLI over SSH adapter — the OPTIONAL path, used only for the one thing
// REST cannot do: creating/deleting a site inside a multisite network (plus
// serialization-safe search-replace when SSH happens to be available).
// Requires only the system `ssh` binary and WP-CLI on the server.

import { execFile } from 'node:child_process';

function splitSsh(target) {
  // "user@host:/var/www/example.com" -> { dest: "user@host", path: "/var/www/example.com" }
  const idx = String(target).indexOf(':');
  if (idx === -1) return { dest: target, path: null };
  return { dest: target.slice(0, idx), path: target.slice(idx + 1) };
}

export function createWpCliAdapter(config, { log = () => {} } = {}) {
  const target = config.wp_cli_ssh;
  const { dest, path } = target ? splitSsh(target) : {};
  let detected;

  function run(args) {
    const wpArgs = path ? [`--path=${path}`, ...args] : args;
    log('wpcli', { dest, args: wpArgs });
    return new Promise((resolvePromise, reject) => {
      execFile(
        'ssh',
        ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', dest, 'wp', ...wpArgs],
        { maxBuffer: 64 * 1024 * 1024 },
        (err, stdout, stderr) => {
          if (err) reject(new Error(`wp ${args[0] ?? ''} failed: ${stderr || err.message}`));
          else resolvePromise(stdout);
        }
      );
    });
  }

  async function siteList() {
    const out = await run(['site', 'list', '--fields=blog_id,url', '--format=json']);
    return JSON.parse(out).map((s) => {
      const host = new URL(s.url).hostname;
      return { id: s.blog_id, slug: host.split('.')[0], url: s.url.replace(/\/$/, '') };
    });
  }

  return {
    async detect() {
      if (detected !== undefined) return detected;
      if (!target) return (detected = false);
      try {
        await run(['core', 'version']);
        detected = true;
      } catch {
        detected = false;
      }
      log('wpcli.detect', { available: detected });
      return detected;
    },

    async siteExists(slug) {
      return (await siteList()).some((s) => s.slug === slug);
    },

    async createSite({ slug, url }) {
      await run(['site', 'create', `--slug=${slug}`, `--title=${slug}`, '--porcelain']);
      log('wpcli.siteCreate', { slug, url });
    },

    async deleteSite(slug) {
      const site = (await siteList()).find((s) => s.slug === slug);
      if (!site) return;
      await run(['site', 'delete', String(site.id), '--yes']);
      log('wpcli.siteDelete', { slug });
    },

    async listSites() {
      return siteList();
    },

    // Serialization-safe rewrite — WP-CLI handles serialized PHP data, which
    // is exactly why we prefer it over any raw-SQL approach.
    async searchReplace({ url, from, to, dryRun }) {
      const args = [
        'search-replace', from, to,
        `--url=${new URL(url).hostname}`,
        '--all-tables-with-prefix',
        '--report-changed-only',
        '--format=count',
      ];
      if (dryRun) args.push('--dry-run');
      const out = await run(args);
      return { count: Number.parseInt(out.trim() || '0', 10) };
    },
  };
}
