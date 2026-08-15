#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const configIndex = args.findIndex((arg) => arg === '--config' || arg === '-c');
const configPath = configIndex >= 0 ? args[configIndex + 1] : null;
const config = configPath && fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '';
const output = config.match(/^output:\s*["']?([^"'\s]+)["']?\s*$/m)?.[1] || './out/scraped-site';
const pages = {
  home: ['<h1>Welcome</h1><p>Offline migration fixture.</p>', '# Welcome\n\nOffline migration fixture.', ['/about']],
  about: ['<h1>About Us</h1><p>Offline fixture content.</p>', '# About Us\n\nOffline fixture content.', ['/']]
};

fs.mkdirSync(path.join(output, 'pages'), { recursive: true });
for (const [slug, [html, markdown, links]] of Object.entries(pages)) {
  const dir = path.join(output, 'pages', slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'content.html'), html);
  fs.writeFileSync(path.join(dir, 'content.md'), markdown);
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ title: slug, slug, links }, null, 2));
}
fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify({
  urls: ['/', '/about'], link_graph: { '/': ['/about'], '/about': ['/'] }, redirects: {}
}, null, 2));
console.log(`Offline scrape wrote ${Object.keys(pages).length} pages to ${output}`);
