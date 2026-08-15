import test from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Scraper, getPageSlug, getRelativePath } from '../src/scraper.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testOutputDir = path.join(__dirname, 'out-test');

// Clean up helper
function cleanOutputDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Start local mock HTTP server
function createMockServer() {
  const server = http.createServer((req, res) => {
    const url = req.url;

    if (url === '/robots.txt') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(`User-agent: *
Disallow: /blocked-path
`);
      return;
    }

    if (url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<!DOCTYPE html>
<html>
<head>
  <title>Homepage</title>
</head>
<body>
  <nav class="navigation">
    <a href="/">Home</a> | <a href="/about-us">About</a>
  </nav>

  <main class="entry-content">
    <h1>Welcome to Legacy Site</h1>
    <p>This is the main body text of the homepage.</p>
    <a href="/about-us">Learn more about us</a>
    <a href="/blog/hello-world">Check our blog</a>
    <a href="/redirect-me">Redirect link</a>
    <a href="/duplicate-canonical">Duplicate page</a>
    <a href="/broken-page">Broken page</a>
    <a href="/blocked-path">Blocked path</a>
    <img src="/media/logo.png" alt="Site Logo" width="200" height="100" />
  </main>

  <footer class="footer">
    <p>&copy; 2025 Legacy Company. All rights reserved.</p>
  </footer>
</body>
</html>`);
      return;
    }

    if (url === '/about-us') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<!DOCTYPE html>
<html>
<head>
  <title>About Us</title>
</head>
<body>
  <nav class="navigation">
    <a href="/">Home</a>
  </nav>

  <article>
    <h1>About Our Team</h1>
    <p>We have been building websites for decades.</p>
    <img src="/media/about.jpg" alt="About Image" width="400" height="300" />
  </article>

  <footer class="footer">
    <p>&copy; 2025 Legacy Company.</p>
  </footer>
</body>
</html>`);
      return;
    }

    if (url === '/blog/hello-world') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<!DOCTYPE html>
<html>
<head>
  <title>Hello World</title>
</head>
<body>
  <main class="entry-content">
    <h1>Hello World!</h1>
    <p>Our very first post.</p>
    <a href="https://external-domain.com/off-site">External Link</a>
  </main>
</body>
</html>`);
      return;
    }

    if (url === '/redirect-me') {
      // HTTP 301 Redirect to /about-us
      res.writeHead(301, { 'Location': '/about-us' });
      res.end();
      return;
    }

    if (url === '/duplicate-canonical') {
      // Returns page pointing to /about-us canonical
      const port = server.address().port;
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<!DOCTYPE html>
<html>
<head>
  <title>Duplicate page</title>
  <link rel="canonical" href="http://localhost:${port}/about-us" />
</head>
<body>
  <main>
    <h1>Duplicate</h1>
    <p>This content is identical to about us.</p>
  </main>
</body>
</html>`);
      return;
    }

    if (url === '/blocked-path') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<html><body><main><h1>Blocked</h1></main></body></html>`);
      return;
    }

    if (url === '/broken-page') {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error');
      return;
    }

    if (url.startsWith('/media/')) {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end('PNG_DUMMY_DATA');
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });

  return server;
}

// --- Tests ---

test('Scraper Unit Helpers', () => {
  assert.strictEqual(getPageSlug('/'), 'index');
  assert.strictEqual(getPageSlug('/about-us/'), 'about-us');
  assert.strictEqual(getPageSlug('/blog/hello-world'), 'blog/hello-world');
  assert.strictEqual(getPageSlug('https://example.com/some/path'), 'some/path');

  assert.strictEqual(getRelativePath('http://example.com/about-us', 'http://example.com/'), '/about-us');
  assert.strictEqual(getRelativePath('http://example.com/blog?p=1', 'http://example.com/'), '/blog?p=1');
});

test('Full Scrape & Crawl offline pipeline', async (t) => {
  cleanOutputDir(testOutputDir);

  const server = createMockServer();
  await new Promise(resolve => server.listen(0, 'localhost', resolve));
  const port = server.address().port;
  const startUrl = `http://localhost:${port}/`;

  console.log(`Test Mock Server running at: ${startUrl}`);

  // Create customized configuration
  const scraper = new Scraper(null, {
    start_urls: [startUrl],
    allow_domains: ['localhost'],
    max_pages: 10,
    max_depth: 3,
    rate_limit_ms: 10, // low delay for fast tests
    output: testOutputDir,
    formats: ['html', 'markdown', 'json']
  });

  try {
    // 1. Run full scraper
    await scraper.run();

    // 2. Validate Outputs
    const manifestPath = path.join(testOutputDir, 'manifest.json');
    assert.ok(fs.existsSync(manifestPath), 'manifest.json exists');

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    // URLs list checks
    assert.ok(manifest.urls.includes('/'), 'includes homepage');
    assert.ok(manifest.urls.includes('/about-us'), 'includes about-us');
    assert.ok(manifest.urls.includes('/blog/hello-world'), 'includes blog');
    assert.ok(!manifest.urls.includes('/blocked-path'), 'polite: blocked by robots.txt');
    assert.ok(!manifest.urls.includes('https://external-domain.com/off-site'), 'does not follow external domains');
    assert.ok(!manifest.urls.includes('/duplicate-canonical'), 'does not create a duplicate page file for canonicalized duplicate');

    // Folder and Files existence checks
    assert.ok(fs.existsSync(path.join(testOutputDir, 'pages', 'index', 'content.html')), 'homepage HTML exists');
    assert.ok(fs.existsSync(path.join(testOutputDir, 'pages', 'index', 'content.md')), 'homepage MD exists');
    assert.ok(fs.existsSync(path.join(testOutputDir, 'pages', 'index', 'meta.json')), 'homepage JSON exists');

    // Boilerplate strip verification
    const homeHtml = fs.readFileSync(path.join(testOutputDir, 'pages', 'index', 'content.html'), 'utf8');
    assert.ok(homeHtml.includes('Welcome to Legacy Site'), 'body content is present');
    assert.ok(!homeHtml.includes('navigation'), 'nav boilerplate is stripped');
    assert.ok(!homeHtml.includes('All rights reserved'), 'footer boilerplate is stripped');

    // Markdown compilation check
    const homeMd = fs.readFileSync(path.join(testOutputDir, 'pages', 'index', 'content.md'), 'utf8');
    assert.ok(homeMd.includes('# Welcome to Legacy Site'), 'compiled headings correctly');
    assert.ok(homeMd.includes('This is the main body text of the homepage.'), 'compiled body paragraph correctly');
    assert.ok(homeMd.includes('![Site Logo]'), 'compiled images to markdown correctly');

    // Image inventory checks
    const logoImg = manifest.images.find(img => img.src.includes('logo.png'));
    assert.ok(logoImg, 'logo.png is recorded');
    assert.ok(logoImg.pages.includes('/'), 'logo.png is referenced on homepage');

    // Redirect map checks (no duplicate, no self-redirect, chains resolved)
    assert.strictEqual(manifest.redirects['/redirect-me'], '/about-us', 'HTTP redirect resolved');
    assert.strictEqual(manifest.redirects['/duplicate-canonical'], '/about-us', 'Duplicate canonical resolved');
    assert.ok(!manifest.redirects['/about-us'], 'no self-redirects');

    // Error section checks
    assert.ok(Object.keys(manifest.errors).length > 0, 'errors is populated');
    const brokenPageUrl = `${startUrl}broken-page`;
    assert.ok(manifest.errors[brokenPageUrl], 'broken-page is recorded as an error');

    // 3. Resumable Run check
    console.log('Running scraper second time to test resumable/caching...');
    const secondaryScraper = new Scraper(null, {
      start_urls: [startUrl],
      allow_domains: ['localhost'],
      max_pages: 10,
      max_depth: 3,
      rate_limit_ms: 10,
      output: testOutputDir,
      formats: ['html', 'markdown', 'json']
    });

    // Run again
    await secondaryScraper.run();

    const secondaryManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.deepStrictEqual(secondaryManifest.urls, manifest.urls, 're-running produces stable/identical output');

  } finally {
    server.close();
    cleanOutputDir(testOutputDir);
  }
});
