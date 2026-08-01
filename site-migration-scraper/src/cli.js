#!/usr/bin/env node

import path from 'node:path';
import fs from 'node:fs';
import { Scraper } from './scraper.js';

export const color = {
  green: (s) => `\x1b[32m${s}\x1b[39m`,
  red: (s) => `\x1b[31m${s}\x1b[39m`,
  yellow: (s) => `\x1b[33m${s}\x1b[39m`,
  cyan: (s) => `\x1b[36m${s}\x1b[39m`,
  bold: (s) => `\x1b[1m${s}\x1b[22m`,
  dim: (s) => `\x1b[2m${s}\x1b[22m`
};

const USAGE = `site-migration-scraper — Crawl a legacy site and extract clean HTML/Markdown body.

Usage:
  scrape run [url] [options]          Run crawler starting at URL or config start_urls
  scrape manifest [options]           Show or analyze the generated manifest.json

Options:
  -c, --config <file>                 Path to config file (YAML/JSON)
  -o, --out <dir>                     Override output directory
  --single                            Skip crawling, scrape only the single provided URL
  --depth <n>                         Maximum crawl depth
  --pages <n>                         Maximum total crawled pages
  --graph                             Print link graph & redirect map under 'scrape manifest'
  -h, --help                          Show this help`;

function parseArgs(argv) {
  const opts = {
    config: null,
    out: null,
    single: false,
    depth: null,
    pages: null,
    graph: false,
    help: false
  };
  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-c' || a === '--config') {
      opts.config = argv[++i];
    } else if (a === '-o' || a === '--out') {
      opts.out = argv[++i];
    } else if (a === '--single') {
      opts.single = true;
    } else if (a === '--depth') {
      opts.depth = parseInt(argv[++i], 10);
    } else if (a === '--pages') {
      opts.pages = parseInt(argv[++i], 10);
    } else if (a === '--graph') {
      opts.graph = true;
    } else if (a === '-h' || a === '--help') {
      opts.help = true;
    } else if (a.startsWith('-')) {
      throw new Error(`Unknown option: ${a}`);
    } else {
      positional.push(a);
    }
  }

  return { opts, positional };
}

export async function run(argv) {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (err) {
    console.error(color.red(err.message));
    console.log(USAGE);
    return 1;
  }

  const { opts, positional } = parsed;

  if (opts.help) {
    console.log(USAGE);
    return 0;
  }

  const command = positional[0];

  if (!command) {
    console.log(USAGE);
    return 0;
  }

  if (command === 'run') {
    const targetUrl = positional[1];

    // Map CLI flags to config overrides
    const overrides = {};
    if (opts.out) overrides.output = opts.out;
    if (opts.depth !== null) overrides.max_depth = opts.depth;
    if (opts.pages !== null) overrides.max_pages = opts.pages;
    if (targetUrl) {
      overrides.start_urls = [targetUrl];
    }

    const scraper = new Scraper(opts.config, overrides);

    console.log(color.bold(color.cyan('Starting site-migration-scraper...')));
    console.log(color.dim(`Configured Output: ${scraper.config.output}`));

    try {
      if (opts.single) {
        if (!targetUrl) {
          throw new Error('Single-page scraping requires a URL: scrape run <url> --single');
        }
        await scraper.run(targetUrl);
      } else {
        await scraper.run();
      }

      console.log(color.green(color.bold('\nScrape run finished successfully!')));
      return 0;
    } catch (err) {
      console.error(color.red(`Scraper runtime error: ${err.message}`));
      return 1;
    }
  } else if (command === 'manifest') {
    // Determine output directory to find manifest.json
    const scraper = new Scraper(opts.config, opts.out ? { output: opts.out } : {});
    const manifestPath = path.join(scraper.config.output, 'manifest.json');

    if (!fs.existsSync(manifestPath)) {
      console.error(color.red(`Error: No manifest found at ${manifestPath}. Run the scraper first.`));
      return 1;
    }

    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      console.log(color.bold(color.cyan(`Manifest summary for: ${scraper.config.output}`)));
      console.log(`- Scraped Pages count: ${manifest.urls.length}`);
      console.log(`- Images count: ${manifest.images.length}`);
      console.log(`- Redirects count: ${Object.keys(manifest.redirects).length}`);
      console.log(`- Errors count: ${Object.keys(manifest.errors).length}`);

      if (opts.graph) {
        console.log(color.bold(color.yellow('\n--- Link Graph ---')));
        for (const [page, links] of Object.entries(manifest.links || {})) {
          console.log(`${color.cyan(page)} links to:`);
          if (links.length === 0) {
            console.log('  (no internal links)');
          } else {
            for (const l of links) {
              console.log(`  → ${l}`);
            }
          }
        }

        console.log(color.bold(color.yellow('\n--- Redirect Map ---')));
        const redirectEntries = Object.entries(manifest.redirects || {});
        if (redirectEntries.length === 0) {
          console.log('No redirects recorded.');
        } else {
          for (const [src, target] of redirectEntries) {
            console.log(`  ${color.red(src)} → ${color.green(target)}`);
          }
        }
      }
      return 0;
    } catch (err) {
      console.error(color.red(`Error parsing manifest.json: ${err.message}`));
      return 1;
    }
  } else {
    console.error(color.red(`Unknown command: ${command}`));
    console.log(USAGE);
    return 1;
  }
}

// Execute when run as a script directly
if (import.meta.url === `file://${process.argv[1]}`) {
  run(process.argv.slice(2)).then(code => process.exit(code));
}
