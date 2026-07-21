#!/usr/bin/env node
// spinup — provision a WordPress subdomain site from a template.
// Commands: create <sub> | teardown <sub> | list | verify <sub>
// Mutating commands are DRY-RUN BY DEFAULT; pass --apply to execute.

import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import process from 'node:process';
import { loadConfig, loadEnvFile, ConfigError } from './config.js';
import { loadAdapters } from './adapters/index.js';
import { createRunLog } from './runlog.js';
import { cmdCreate, cmdTeardown, cmdList, cmdVerify, EXIT } from './engine.js';

const USAGE = `spinup — WordPress subdomain spinup from a template site

Usage:
  spinup create <sub> [--brand brand.json] [--apply] [--force]
  spinup teardown <sub> [--apply]
  spinup list
  spinup verify <sub>

Options:
  --config <path>   Config file (default: config.yml)
  --env <path>      .env file to load (default: .env)
  --brand <path>    Brand tokens JSON (title, tagline, logo, primary_color)
  --apply           Actually mutate. Without it, create/teardown only print a plan.
  --force           Re-run provisioning steps even if the site already exists.
  --json            Machine-readable JSON output.
  -h, --help        Show this help.

Exit codes: 0 ok, 1 failure/collision/verify-failed, 2 usage/config error,
            3 manual step required (no SSH / manual DNS).

Modes: multisite (site create needs WP-CLI over SSH — everything else is REST;
without SSH you get the exact manual command instead of a failure) and
standalone (pure REST; assumes WP core is already installed at the target).
Secrets come from env vars only — see .env.example.`;

function color(code, text) {
  if (process.env.NO_COLOR || !process.stdout.isTTY) return text;
  return `[${code}m${text}[0m`;
}
const paint = {
  ok: (t) => color('32', t),
  warn: (t) => color('33', t),
  err: (t) => color('31', t),
};

function printResult(res, { json }) {
  if (json) {
    const { messages, ...rest } = res;
    console.log(JSON.stringify({ ...rest, messages }, null, 2));
    return;
  }
  for (const line of res.messages) {
    if (/\[FAIL\]|FAILED|Aborting|failed/i.test(line)) console.log(paint.err(line));
    else if (/DRY RUN|manual|Manual/i.test(line)) console.log(paint.warn(line));
    else if (/\[PASS\]|clean|passed|Live:/.test(line)) console.log(paint.ok(line));
    else console.log(line);
  }
}

function loadBrand(path) {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const allowed = ['title', 'tagline', 'logo', 'primary_color'];
  const brand = {};
  for (const key of allowed) if (raw[key] !== undefined) brand[key] = raw[key];
  const unknown = Object.keys(raw).filter((k) => !allowed.includes(k));
  if (unknown.length) {
    throw new ConfigError(`Unknown brand key(s): ${unknown.join(', ')} (allowed: ${allowed.join(', ')})`);
  }
  if (Object.keys(brand).length === 0) {
    throw new ConfigError(`Brand file ${path} has none of: ${allowed.join(', ')}`);
  }
  return brand;
}

export async function main(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        config: { type: 'string', default: 'config.yml' },
        env: { type: 'string', default: '.env' },
        brand: { type: 'string' },
        apply: { type: 'boolean', default: false },
        force: { type: 'boolean', default: false },
        json: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    });
  } catch (err) {
    console.error(paint.err(err.message));
    console.error(USAGE);
    return EXIT.USAGE;
  }

  const [command, sub] = args.positionals;
  if (args.values.help || !command) {
    console.log(USAGE);
    return args.values.help ? EXIT.OK : EXIT.USAGE;
  }
  const commands = ['create', 'teardown', 'list', 'verify'];
  if (!commands.includes(command)) {
    console.error(paint.err(`Unknown command: ${command}`));
    console.error(USAGE);
    return EXIT.USAGE;
  }
  if (command !== 'list' && !sub) {
    console.error(paint.err(`Usage: spinup ${command} <sub>`));
    return EXIT.USAGE;
  }

  try {
    loadEnvFile(args.values.env);
    const config = loadConfig(args.values.config);
    const { log } = createRunLog(process.env.SPINUP_LOG_DIR || 'runs');
    log('start', { command, sub: sub ?? null, apply: args.values.apply, force: args.values.force });

    const adapters = await loadAdapters(config, { log });
    const ctx = { config, adapters, log };

    let res;
    if (command === 'create') {
      const brand = args.values.brand ? loadBrand(args.values.brand) : null;
      res = await cmdCreate(ctx, sub, { apply: args.values.apply, force: args.values.force, brand });
    } else if (command === 'teardown') {
      res = await cmdTeardown(ctx, sub, { apply: args.values.apply });
    } else if (command === 'list') {
      res = await cmdList(ctx);
    } else {
      res = await cmdVerify(ctx, sub);
    }

    log('done', { status: res.status, exitCode: res.exitCode });
    printResult(res, { json: args.values.json });
    return res.exitCode;
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(paint.err(err.message));
      return EXIT.USAGE;
    }
    console.error(paint.err(`Error: ${err.message}`));
    return EXIT.FAIL;
  }
}

// Only run when executed directly (not when imported by tests).
const invokedAs = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === invokedAs) {
  process.exitCode = await main();
}
