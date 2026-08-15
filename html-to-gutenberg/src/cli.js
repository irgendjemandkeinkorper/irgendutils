#!/usr/bin/env node
// h2g — convert one HTML page to canonical Gutenberg block markup, optionally
// push it to WordPress, and render-verify it in the real block editor.

import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import process from 'node:process';
import { parseHTML } from './htmlparser.js';
import { normalizeTree, collectImageSources } from './normalize.js';
import { convertDocument } from './convert.js';
import { parseBlockMarkup } from './grammar.js';
import { buildReport, formatReport, green, red, yellow } from './report.js';
import { resolveMediaMap } from './media.js';
import { pushPage, titleFromMarkup } from './push.js';
import { runVerify } from './verify.js';
import { loadConfig, loadEnvFile } from './config.js';

const USAGE = `h2g — HTML -> Gutenberg block markup (one page at a time)

Usage:
  h2g convert <input.html> [-o blocks.html] [--push] [--status draft|publish]
              [--media link|import] [--title "Page title"] [--strict]
  h2g verify <page-id-or-editor-url> [--expect blocks.html.report.json]

Options:
  --config <path>   Config file (default: h2g.config.yml)
  --env <path>      .env file to load (default: .env)
  -o <path>         Output block markup file (default: blocks.html);
                    a JSON report is written alongside as <out>.report.json
  --push            Create the page in WordPress (draft unless --status)
  --status <s>      Page status when pushing (default: draft)
  --media <mode>    link (default) keeps external URLs; import uploads to WP
  --title <t>       Page title (default: first <h1> in the converted markup)
  --strict          Exit 1 if any core/html fallback or grammar warning
  --json            Machine-readable JSON output
  -h, --help        Show this help

Env: WP_USER + WP_APP_PASSWORD (REST push/media),
     H2G_EDITOR_USER + H2G_EDITOR_PASSWORD (verify — real wp-admin login).

Exit codes: 0 ok, 1 conversion/verify failure, 2 usage/config error.`;

function buildWpAdapter(config) {
  const wp = config.wp || {};
  const baseUrl = process.env.WP_BASE_URL || wp.base_url;
  if ((wp.mode || 'rest') === 'wpcli') {
    return import('./adapters/wpcli.js').then(({ createWpCliAdapter }) =>
      createWpCliAdapter({
        ssh: wp.ssh || null,
        wpPath: process.env.WP_PATH || wp.wp_path || null,
        siteUrl: baseUrl,
        log: (m) => console.error(`  ${m}`),
      })
    );
  }
  return import('./adapters/rest.js').then(({ createRestAdapter }) =>
    createRestAdapter({
      baseUrl,
      user: process.env.WP_USER,
      appPassword: process.env.WP_APP_PASSWORD,
    })
  );
}

async function cmdConvert(input, values, config) {
  const html = readFileSync(input, 'utf8');
  const { root, dropped } = normalizeTree(parseHTML(html), {
    mediaBase: config.media?.base || process.env.H2G_MEDIA_BASE ||
      process.env.WP_BASE_URL || config.wp?.base_url || null,
  });

  const mediaMode = values.media || config.media?.mode || 'link';
  const needsWp = values.push || mediaMode === 'import';
  const adapter = needsWp ? await buildWpAdapter(config) : null;

  const mediaMap = await resolveMediaMap(collectImageSources(root), {
    mode: mediaMode,
    adapter,
    log: (m) => console.error(`  ${m}`),
  });

  const result = convertDocument(root, { mediaMap });
  const { warnings } = parseBlockMarkup(result.markup);
  const report = buildReport({
    counts: result.counts,
    fallbacks: result.fallbacks,
    dropped,
    grammarWarnings: warnings,
  });

  const out = values.o || 'blocks.html';
  writeFileSync(out, result.markup);
  writeFileSync(`${out}.report.json`, JSON.stringify(report, null, 2) + '\n');

  let pushed = null;
  if (values.push) {
    const title = values.title || titleFromMarkup(result.markup, input.replace(/\.\w+$/, ''));
    pushed = await pushPage(
      { title, status: values.status, content: result.markup },
      adapter,
      (m) => console.error(`  ${m}`)
    );
  }

  if (values.json) {
    console.log(JSON.stringify({ out, report, pushed }, null, 2));
  } else {
    console.log(formatReport(report));
    console.log(`wrote ${out} (+ ${out}.report.json)`);
    if (pushed) {
      console.log(green(`pushed page id=${pushed.id} ${pushed.url || ''}`));
      const base = (process.env.WP_BASE_URL || config.wp?.base_url || '').replace(/\/$/, '');
      if (base) console.log(`editor: ${base}/wp-admin/post.php?post=${pushed.id}&action=edit`);
      console.log(`verify: h2g verify ${pushed.id} --expect ${out}.report.json`);
    }
  }

  const strict = values.strict || config.convert?.strict === true;
  return !strict || report.ok ? 0 : 1;
}

async function cmdVerify(target, values, config) {
  let createPlaywrightAdapter;
  try {
    ({ createPlaywrightAdapter } = await import('./adapters/playwright.js'));
  } catch (err) {
    if (err.code === 'ERR_MODULE_NOT_FOUND' && err.message.includes('playwright')) {
      throw new Error('Playwright is optional and required only for verify; install it with `npm install playwright` and run `npx playwright install chromium`.');
    }
    throw err;
  }
  const adapter = createPlaywrightAdapter({
    baseUrl: process.env.WP_BASE_URL || config.wp?.base_url,
    user: process.env.H2G_EDITOR_USER,
    password: process.env.H2G_EDITOR_PASSWORD,
  });

  let expectedCounts = null;
  if (values.expect) {
    const report = JSON.parse(readFileSync(values.expect, 'utf8'));
    expectedCounts = new Map(Object.entries(report.blockCounts));
  }

  const res = await runVerify(target, {
    adapter,
    expectedCounts,
    log: (m) => console.error(`  ${m}`),
  });

  if (values.json) {
    console.log(JSON.stringify({ ...res, counts: Object.fromEntries(res.counts) }, null, 2));
  } else {
    const total = [...res.counts.values()].reduce((a, b) => a + b, 0);
    console.log(`editor sees ${total} block(s): ${[...res.counts.entries()].map(([n, c]) => `${n}=${c}`).join(' ')}`);
    for (const w of res.warnings) console.log(red(`[FAIL] ${w}`));
    for (const m of res.mismatches) console.log(red(`[FAIL] count mismatch — ${m}`));
    for (const e of res.consoleErrors) console.log(yellow(`[console] ${e}`));
    console.log(
      res.ok
        ? green('VERIFY PASS — no invalid blocks, counts match, no console errors.')
        : red('VERIFY FAIL.')
    );
  }
  return res.ok ? 0 : 1;
}

export async function main(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        config: { type: 'string', default: 'h2g.config.yml' },
        env: { type: 'string', default: '.env' },
        o: { type: 'string' },
        push: { type: 'boolean', default: false },
        status: { type: 'string', default: 'draft' },
        media: { type: 'string' },
        title: { type: 'string' },
        strict: { type: 'boolean', default: false },
        expect: { type: 'string' },
        json: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    });
  } catch (err) {
    console.error(err.message);
    console.error(USAGE);
    return 2;
  }

  const [command, target] = args.positionals;
  if (args.values.help || !command) {
    console.log(USAGE);
    return args.values.help ? 0 : 2;
  }
  if (!['convert', 'verify'].includes(command) || !target) {
    console.error(`Usage: h2g convert <input.html> | h2g verify <page-id>`);
    return 2;
  }

  try {
    loadEnvFile(args.values.env);
    const config = loadConfig(args.values.config);
    return command === 'convert'
      ? await cmdConvert(target, args.values, config)
      : await cmdVerify(target, args.values, config);
  } catch (err) {
    console.error(red(`Error: ${err.message}`));
    return 1;
  }
}

const invokedAs = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === invokedAs) {
  process.exitCode = await main();
}
