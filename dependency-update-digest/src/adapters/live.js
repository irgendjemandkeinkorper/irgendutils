// Live adapter: shells out to the native ecosystem tools and (for shell-less
// WP sites) talks to the WP REST API. Loaded lazily — tests never import this.
// Read-only throughout: only list/audit commands, never install/update.

import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';

function expandHome(p) {
  if (!p) return p;
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return resolve(homedir(), p.slice(2));
  return isAbsolute(p) ? p : resolve(p);
}

// Run a command and parse stdout as JSON.
// GOTCHA: `npm outdated` exits 1 whenever anything is outdated — that is a
// *result*, not a failure. So: capture output first, and only treat the run as
// failed when stdout is not parseable JSON.
function runJson(cmd, args, cwd, { verbose = false } = {}) {
  return new Promise((resolvePromise, reject) => {
    if (verbose) process.stderr.write(`$ ${cmd} ${args.join(' ')}  (cwd: ${cwd})\n`);
    execFile(
      cmd,
      args,
      { cwd, maxBuffer: 64 * 1024 * 1024, env: process.env },
      (error, stdout) => {
        const text = String(stdout ?? '').trim();
        if (text) {
          try {
            resolvePromise(JSON.parse(text));
            return;
          } catch {
            /* fall through to error handling */
          }
        }
        if (error) {
          reject(new Error(`${cmd} ${args.join(' ')} failed: ${error.message}`));
        } else if (!text) {
          resolvePromise(null);
        } else {
          reject(new Error(`${cmd} ${args.join(' ')}: output was not JSON`));
        }
      },
    );
  });
}

export class LiveAdapter {
  constructor(opts = {}) {
    this.verbose = Boolean(opts.verbose);
  }

  cwd(project) {
    if (!project.path) {
      throw new Error(`Project "${project.name}" has no path (shell types need one)`);
    }
    return expandHome(project.path);
  }

  async composerOutdated(project, opts = {}) {
    const args = ['outdated', '--format=json'];
    if (!opts.deep) args.push('--direct');
    return (await runJson('composer', args, this.cwd(project), this)) ?? { installed: [] };
  }

  async composerAudit(project) {
    // composer audit exits non-zero when advisories exist — also just a result.
    return (
      (await runJson('composer', ['audit', '--format=json'], this.cwd(project), this)) ?? {
        advisories: {},
      }
    );
  }

  async npmOutdated(project, opts = {}) {
    const args = ['outdated', '--json'];
    if (opts.deep) args.push('--all');
    // Empty stdout + exit 0 means fully up to date.
    return (await runJson('npm', args, this.cwd(project), this)) ?? {};
  }

  async npmAudit(project) {
    return (
      (await runJson('npm', ['audit', '--json'], this.cwd(project), this)) ?? {
        vulnerabilities: {},
      }
    );
  }

  async wpPluginList(project) {
    if (project.wp_rest) return this.wpRestPluginList(project);
    return (
      (await runJson(
        'wp',
        ['plugin', 'list', '--update=available', '--format=json'],
        this.cwd(project),
        this,
      )) ?? []
    );
  }

  // REST-first for WP sites without shell access. Needs an application
  // password; the env var *name* comes from config (app_password_env), the
  // secret itself only ever from the environment.
  async wpRestPluginList(project) {
    const envName = project.app_password_env || 'WP_APP_PASSWORD';
    const secret = process.env[envName];
    if (!secret) {
      throw new Error(`Env var ${envName} not set (needed for WP REST on ${project.name})`);
    }
    const user = project.wp_user || process.env.WP_APP_USER || 'admin';
    const base = String(project.wp_rest).replace(/\/+$/, '');
    const url = `${base}/wp-json/wp/v2/plugins`;
    if (this.verbose) process.stderr.write(`GET ${url}\n`);
    const res = await fetch(url, {
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${user}:${secret}`).toString('base64'),
        Accept: 'application/json',
      },
    });
    if (!res.ok) throw new Error(`WP REST ${url} -> HTTP ${res.status}`);
    const plugins = await res.json();
    // Map the REST plugin shape onto the wp-cli list shape the normalizer eats.
    return plugins
      .filter((p) => p.update && p.update !== 'none')
      .map((p) => ({
        name: p.plugin?.split('/')[0] ?? p.name,
        status: p.status,
        update: 'available',
        version: p.version,
        update_version: p.update_version ?? null,
      }));
  }

  // No free, keyless live WP vulnerability feed — degrade to "no advisories"
  // unless the config points at a local feed file (wpvulndb export or similar).
  async wpVulns(project) {
    if (!project.wp_vuln_feed) return [];
    const { readFileSync } = await import('node:fs');
    return JSON.parse(readFileSync(expandHome(project.wp_vuln_feed), 'utf8'));
  }
}
