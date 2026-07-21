#!/usr/bin/env node
// smoke — post-deploy smoke test CLI.
// Read-only, idempotent, fast: hits the critical URLs from smoke.yml and exits
// non-zero if any check fails, so it can gate a deploy / trigger rollback.

import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseYaml, parseDotEnv } from './yaml.js';
import { runSmoke } from './runner.js';
import { formatTable, buildResultsJson } from './report.js';

const HELP = `smoke — post-deploy smoke test (read-only, exits non-zero on failure)

Usage:
  smoke run                          run all checks from smoke.yml against base_url
  smoke run --url https://staging.x  override the target (e.g. test staging first)
  smoke run --fail-fast              stop at the first failure

Options:
  -c, --config <file>   config file (default: smoke.yml)
      --url <url>       override base_url from the config
      --fail-fast       stop at the first failing check
  -o, --out <file>      where to write results.json (default: results.json)
      --no-color        disable ANSI colors
      --adapter <file>  advanced: JS module providing the fetch adapter
                        (used by tests to run against fixtures, offline)
  -h, --help            show this help

Config (smoke.yml): base_url, timeout_ms, soft_budget_ms, checks[], authed[],
fail_fast. Authed checks read the Application Password from the env var named
by app_password_env (never from the config file). A .env in the cwd is loaded
if present (existing environment wins).

Exit codes: 0 = all checks passed, 1 = at least one failure, 2 = usage/config error.`;

async function main(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      config: { type: 'string', short: 'c', default: 'smoke.yml' },
      url: { type: 'string' },
      'fail-fast': { type: 'boolean', default: false },
      out: { type: 'string', short: 'o', default: 'results.json' },
      'no-color': { type: 'boolean', default: false },
      adapter: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  const command = positionals[0];
  if (values.help || !command) {
    console.log(HELP);
    return command ? 0 : 2;
  }
  if (command !== 'run') {
    console.error(`Unknown command "${command}". Try: smoke run  (or --help)`);
    return 2;
  }

  const configPath = resolve(values.config);
  if (!existsSync(configPath)) {
    console.error(
      `Config not found: ${configPath}\nCreate one from smoke.example.yml, or pass --config <file>.`,
    );
    return 2;
  }

  let config;
  try {
    config = parseYaml(readFileSync(configPath, 'utf8'));
  } catch (err) {
    console.error(`Failed to parse ${configPath}: ${err.message}`);
    return 2;
  }
  if (values.url) config.base_url = values.url;
  if (!config.base_url) {
    console.error('Config error: base_url is required (or pass --url).');
    return 2;
  }

  // Load .env from cwd if present; real environment always wins. Secrets are
  // only ever read from env — never from smoke.yml, never printed.
  const env = { ...process.env };
  const dotEnvPath = resolve('.env');
  if (existsSync(dotEnvPath)) {
    const parsed = parseDotEnv(readFileSync(dotEnvPath, 'utf8'));
    for (const [k, v] of Object.entries(parsed)) if (!(k in env)) env[k] = v;
  }

  const adapter = values.adapter
    ? await loadCustomAdapter(values.adapter)
    : lazyLiveAdapter();

  const run = await runSmoke(config, adapter, {
    failFast: values['fail-fast'] || undefined,
    env,
  });

  const color = !values['no-color'] && process.stdout.isTTY && !process.env.NO_COLOR;
  console.log(formatTable(run, { color }));

  const outPath = resolve(values.out);
  writeFileSync(outPath, JSON.stringify(buildResultsJson(run), null, 2) + '\n');
  console.log(`\nresults written to ${outPath}`);

  return run.ok ? 0 : 1;
}

// Live adapters are imported lazily so `npm test` (and --adapter runs) never
// touch them. Checks with `browser: true` route to the Playwright adapter.
function lazyLiveAdapter() {
  let http;
  let playwright;
  return {
    async fetch(req) {
      if (req.check?.browser) {
        playwright ??= await import('./adapters/playwright.js');
        return playwright.fetchUrl(req);
      }
      http ??= await import('./adapters/http.js');
      return http.fetchUrl(req);
    },
  };
}

async function loadCustomAdapter(spec) {
  const mod = await import(pathToFileURL(resolve(spec)).href);
  const fetchFn = mod.fetchUrl ?? mod.default?.fetch ?? mod.default;
  if (typeof fetchFn !== 'function') {
    throw new Error(`Adapter ${spec} must export fetchUrl(req) or default { fetch }`);
  }
  return { fetch: fetchFn };
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error(`smoke: ${err.message}`);
    process.exitCode = 2;
  });
