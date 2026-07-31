#!/usr/bin/env node

import fs from 'fs';
import path from 'path';

function printHelp() {
  console.log(`scrape — Site Migration Scraper (Mocked)

Usage:
  scrape run [-c <config>] [-o <dir>] [--single] [<url>]
  scrape manifest --graph [-c <config>]

Options:
  -c, --config <file>   Config file
  -o, --out <dir>       Override output directory
  --single              Scrape only the single provided URL
  -h, --help            Show this help.
`);
}

// Minimal regex-based YAML/config parser to extract output directory
function parseConfig(configPath) {
  if (!fs.existsSync(configPath)) return {};
  const content = fs.readFileSync(configPath, 'utf8');
  const result = {};
  for (const line of content.split(/\r?\n/)) {
    const cleanLine = line.replace(/#.*$/, '').trim();
    if (!cleanLine) continue;
    const match = cleanLine.match(/^([^:]+):\s*(.*)$/);
    if (match) {
      const key = m1(match[1]);
      const val = m1(match[2]);
      result[key] = val;
    }
  }
  return result;
}

function m1(str) {
  let s = str.trim();
  if (s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1);
  else if (s.startsWith("'") && s.endsWith("'")) s = s.slice(1, -1);
  return s;
}

function run() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h') || args.length === 0) {
    printHelp();
    process.exit(0);
  }

  const cmd = args[0];
  if (cmd !== 'run' && cmd !== 'manifest') {
    console.error(`Error: Unknown command "${cmd}"`);
    printHelp();
    process.exit(2);
  }

  // Parse options
  let configPath = 'config.yml';
  let outDirOverride = null;
  let isSingle = args.includes('--single');
  let singleUrl = null;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '-c' || args[i] === '--config') {
      configPath = args[i + 1];
      i++;
    } else if (args[i] === '-o' || args[i] === '--out') {
      outDirOverride = args[i + 1];
      i++;
    } else if (args[i] === '--single') {
      isSingle = true;
    } else if (!args[i].startsWith('-')) {
      singleUrl = args[i];
    }
  }

  // Determine output directory
  let outputDir = './out/scraped-site/';
  if (configPath) {
    const config = parseConfig(configPath);
    if (config.output) {
      outputDir = config.output;
    } else if (config.slug) {
      outputDir = `./out/${config.slug}/`;
    }
  }
  if (outDirOverride) {
    outputDir = outDirOverride;
  }

  // Create output directories
  fs.mkdirSync(outputDir, { recursive: true });

  const manifest = {
    urls: ["/", "/about"],
    link_graph: {
      "/": ["/about"],
      "/about": ["/"]
    },
    images: [
      { "src": "https://example.com/logo.png", "alt": "Logo", "pages": ["/", "/about"] }
    ],
    redirects: {
      "/old-home": "/",
      "/old-about": "/about"
    }
  };

  const pages = {
    home: {
      html: '<h1>Welcome</h1><p>This is the home page of Acme Redesign. We are converting this legacy site to Gutenberg.</p>',
      md: '# Welcome\nThis is the home page of Acme Redesign. We are converting this legacy site to Gutenberg.',
      meta: {
        title: "Welcome",
        slug: "home",
        headings: ["Welcome"],
        images: ["https://example.com/logo.png"],
        links: ["/about"]
      }
    },
    about: {
      html: '<h1>About Us</h1><p>We are a highly skilled team of engineers.</p>',
      md: '# About Us\nWe are a highly skilled team of engineers.',
      meta: {
        title: "About Us",
        slug: "about",
        headings: ["About Us"],
        images: [],
        links: ["/"]
      }
    }
  };

  if (cmd === 'run') {
    console.log(`Crawl starting... output to ${outputDir}`);

    // Write manifest.json inside outputDir
    fs.writeFileSync(path.join(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

    const pagesDir = path.join(outputDir, 'pages');
    fs.mkdirSync(pagesDir, { recursive: true });

    if (isSingle) {
      const slug = singleUrl ? singleUrl.split('/').pop() || 'home' : 'home';
      const pageData = pages[slug] || pages.home;
      const singlePageDir = path.join(pagesDir, slug);
      fs.mkdirSync(singlePageDir, { recursive: true });
      fs.writeFileSync(path.join(singlePageDir, 'content.html'), pageData.html);
      fs.writeFileSync(path.join(singlePageDir, 'content.md'), pageData.md);
      fs.writeFileSync(path.join(singlePageDir, 'meta.json'), JSON.stringify(pageData.meta, null, 2));
      console.log(`Scraped 1 page: ${slug}`);
    } else {
      for (const [slug, data] of Object.entries(pages)) {
        const pageDir = path.join(pagesDir, slug);
        fs.mkdirSync(pageDir, { recursive: true });
        fs.writeFileSync(path.join(pageDir, 'content.html'), data.html);
        fs.writeFileSync(path.join(pageDir, 'content.md'), data.md);
        fs.writeFileSync(path.join(pageDir, 'meta.json'), JSON.stringify(data.meta, null, 2));
      }
      console.log(`Scraped ${Object.keys(pages).length} pages.`);
    }
    console.log('Crawl finished.');
  } else if (cmd === 'manifest') {
    console.log('Generating graph...');
    console.log(JSON.stringify(manifest.link_graph, null, 2));
  }
}

run();
