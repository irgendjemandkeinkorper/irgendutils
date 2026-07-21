#!/usr/bin/env node
// obsidian-vault-forge CLI — `vault`.
//
//   vault forge <project.yml> [-o root] [--update] [--dry-run] [--date ISO]
//   vault add-meeting  <slug> "<topic>" [-o root] [--date ISO]
//   vault add-decision <slug> "<title>" [-o root] [--date ISO] [--status s]
//   vault verify       <slug> [-o root]
//
// Exit codes: 0 ok · 1 runtime/verify failure · 2 usage error.
import path from 'node:path';
import { loadManifest, ManifestError } from './manifest.js';
import { buildPlan } from './forge.js';
import { applyPlan } from './write.js';
import { verifyVault } from './verify.js';
import { scanPlan } from './secretscan.js';
import { readVaultContext, buildMeetingPlan, buildDecisionPlan, VaultError } from './add.js';
import { color, todayISO } from './util.js';

const USAGE = `obsidian-vault-forge — scaffold a linked Obsidian vault for a project.

Usage:
  vault forge <project.yml> [options]     build/update a vault from a manifest
  vault add-meeting  <slug> "<topic>"     add a meeting note to a vault
  vault add-decision <slug> "<title>"     add an ADR to a vault
  vault verify <slug>                     re-run the acceptance checks

Options:
  -o, --out <dir>    vaults root (vault dir is <out>/<slug>)   [default: .]
      --update       reconcile into an existing vault (never clobbers edits)
      --dry-run      show the plan; write nothing
      --date <ISO>   date stamp for created/date fields        [default: today]
      --status <s>   ADR status (add-decision)                 [default: proposed]
      --no-color     disable ANSI color
  -h, --help         show this help`;

function parseArgs(argv) {
  const opts = { out: '.', update: false, dryRun: false, date: null, status: 'proposed' };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-o' || a === '--out') opts.out = argv[++i];
    else if (a === '--update') opts.update = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--date') opts.date = argv[++i];
    else if (a === '--status') opts.status = argv[++i];
    else if (a === '--no-color') process.env.NO_COLOR = '1';
    else if (a === '-h' || a === '--help') opts.help = true;
    else if (a.startsWith('-')) throw new UsageError(`unknown option: ${a}`);
    else positional.push(a);
  }
  return { opts, positional };
}

class UsageError extends Error {}

function summarize(actions) {
  const counts = {};
  for (const a of actions) counts[a.action] = (counts[a.action] || 0) + 1;
  return Object.entries(counts)
    .map(([k, v]) => `${v} ${k}`)
    .join(', ');
}

function reportVerify(result) {
  if (result.ok) {
    console.log(color.green('  ✓ verify: front-matter valid, no dangling links, no secrets'));
    return true;
  }
  for (const p of result.frontmatter) console.log(color.red(`  ✗ front-matter ${p.file}: ${p.issue}`));
  for (const d of result.dangling) console.log(color.red(`  ✗ dangling link in ${d.file}: [[${d.target}]]`));
  for (const s of result.secrets)
    console.log(color.red(`  ✗ possible secret in ${s.file} (${s.pattern}): ${s.match}`));
  return false;
}

function printActions(actions) {
  const icon = { create: '+', overwrite: '~', 'new-sibling': '→', unchanged: '=', keep: '·', dir: 'd' };
  for (const a of actions) {
    if (a.action === 'unchanged' || a.action === 'dir') continue;
    console.log(color.dim(`  ${icon[a.action] || '?'} ${a.path}`));
  }
}

function cmdForge(positional, opts) {
  const manifestPath = positional[0];
  if (!manifestPath) throw new UsageError('forge needs a <project.yml> path');
  const manifest = loadManifest(manifestPath);
  const plan = buildPlan(manifest, { today: opts.date || todayISO() });
  const vaultRoot = path.join(opts.out, plan.vaultName);

  // Never write a secret: scan the plan before touching disk.
  const leaks = scanPlan(plan);
  if (leaks.length) {
    console.error(color.red('Refusing to write — planned content contains secrets:'));
    for (const s of leaks) console.error(`  ${s.file} (${s.pattern}): ${s.match}`);
    return 1;
  }

  const actions = applyPlan(vaultRoot, plan, { update: opts.update, dryRun: opts.dryRun });
  const where = color.cyan(vaultRoot);
  if (opts.dryRun) {
    console.log(`${color.bold('Dry run')} — would write vault at ${where}`);
    printActions(actions);
    console.log(color.dim(`  (${summarize(actions)})`));
    return 0;
  }

  console.log(`${color.bold('Forged')} ${manifest.name} → ${where}`);
  printActions(actions);
  console.log(color.dim(`  ${summarize(actions)}`));
  const ok = reportVerify(verifyVault(vaultRoot));
  return ok ? 0 : 1;
}

function cmdAdd(kind, positional, opts) {
  const slug = positional[0];
  const subject = positional[1];
  if (!slug || !subject) throw new UsageError(`add-${kind} needs <slug> and a quoted "<title>"`);
  const vaultRoot = path.join(opts.out, slug);
  const ctx = readVaultContext(vaultRoot, { today: opts.date || todayISO() });
  const date = opts.date || ctx.today;
  const plan =
    kind === 'meeting'
      ? buildMeetingPlan(ctx, subject, { date })
      : buildDecisionPlan(ctx, subject, { date, status: opts.status });

  const leaks = scanPlan(plan);
  if (leaks.length) {
    console.error(color.red(`Refusing to write — content contains secrets: ${leaks[0].pattern}`));
    return 1;
  }

  const actions = applyPlan(vaultRoot, plan, { update: opts.update, dryRun: opts.dryRun });
  if (opts.dryRun) {
    console.log(`${color.bold('Dry run')} — would add to ${color.cyan(vaultRoot)}`);
    printActions(actions);
    return 0;
  }
  console.log(`${color.bold('Added')} ${kind} → ${color.cyan(actions[0].path)}`);
  const ok = reportVerify(verifyVault(vaultRoot));
  return ok ? 0 : 1;
}

function cmdVerify(positional, opts) {
  const slug = positional[0];
  if (!slug) throw new UsageError('verify needs a <slug>');
  const vaultRoot = path.join(opts.out, slug);
  console.log(`Verifying ${color.cyan(vaultRoot)}`);
  return reportVerify(verifyVault(vaultRoot)) ? 0 : 1;
}

export function run(argv) {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (err) {
    console.error(color.red(err.message));
    console.error(USAGE);
    return 2;
  }
  const { opts, positional } = parsed;
  const command = positional.shift();

  if (opts.help || !command) {
    console.log(USAGE);
    return opts.help ? 0 : 2;
  }

  try {
    switch (command) {
      case 'forge':
        return cmdForge(positional, opts);
      case 'add-meeting':
        return cmdAdd('meeting', positional, opts);
      case 'add-decision':
        return cmdAdd('decision', positional, opts);
      case 'verify':
        return cmdVerify(positional, opts);
      default:
        console.error(color.red(`unknown command: ${command}`));
        console.error(USAGE);
        return 2;
    }
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(color.red(err.message));
      console.error(USAGE);
      return 2;
    }
    if (err instanceof ManifestError || err instanceof VaultError) {
      console.error(color.red(`error: ${err.message}`));
      return 1;
    }
    throw err;
  }
}

// Only run when invoked directly (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(run(process.argv.slice(2)));
}
