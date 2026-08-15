import test from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';

import {
  normalizePath,
  cleanTitle,
  generateRedirectMap,
  parseCSV,
  stringifyCSV,
} from '../src/engine/matcher.js';
import { validateRedirectMap, isRegexUnsafe } from '../src/engine/validator.js';
import { exportRules } from '../src/engine/generator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('Path Normalization', () => {
  // Trailing slashes
  assert.strictEqual(normalizePath('/about/'), '/about');
  assert.strictEqual(normalizePath('/about'), '/about');
  assert.strictEqual(normalizePath('/'), '/');

  // Case insensitivity
  assert.strictEqual(normalizePath('/ABOUT-US'), '/about-us');

  // Query parameter sorting & normalization
  assert.strictEqual(normalizePath('/product?b=2&a=1'), '/product?a=1&b=2');
  assert.strictEqual(normalizePath('/product?'), '/product');

  // Unicode NFC and percent decoding
  assert.strictEqual(normalizePath('/caf%C3%A9'), '/café');
  // NFC normalization check (café with combining acute accent vs precomposed e with acute)
  const combinedCafe = '/cafe\u0301';
  assert.strictEqual(normalizePath(combinedCafe), '/café');

  // Handling full URLs vs paths
  assert.strictEqual(normalizePath('https://old.site.com/blog-post/'), '/blog-post');
});

test('CSV Parser and Stringifier', () => {
  const csvContent = 'source,target,status\n"/about","https://new.site/about",301\n"/gone","",410';
  const parsed = parseCSV(csvContent);
  assert.deepStrictEqual(parsed, [
    ['source', 'target', 'status'],
    ['/about', 'https://new.site/about', '301'],
    ['/gone', '', '410']
  ]);

  const rows = [
    ['col1', 'col,2', 'col"3"'],
    ['val1', 'val2', 'val3\nwith\nnewline']
  ];
  const stringified = stringifyCSV(rows);
  assert.ok(stringified.includes('"col,2"'));
  assert.ok(stringified.includes('"col""3"""'));
  assert.ok(stringified.includes('"val3\nwith\nnewline"'));
});

test('Title Cleaning', () => {
  assert.strictEqual(cleanTitle('About Us - My Website!'), 'about us my website');
  assert.strictEqual(cleanTitle('Hello   World???'), 'hello world');
});

test('Regex Safety Checks', () => {
  assert.strictEqual(isRegexUnsafe('^/blog/(.*)'), false);
  assert.strictEqual(isRegexUnsafe('^/blog/(.*)*'), true); // ReDoS potential
  assert.strictEqual(isRegexUnsafe('[invalid regex'), true); // Throws syntax error
});

test('Core Matching and Classification Engine', async () => {
  // Create temporary manifest, sitemap, and override files
  const tempDir = path.join(__dirname, 'temp_fixtures');
  fs.mkdirSync(tempDir, { recursive: true });

  const sourceManifest = {
    pages: [
      { url: 'https://old.site.com/about-us', title: 'About Us', slug: 'about-us', canonical: 'https://old.site.com/about-us/' },
      { url: 'https://old.site.com/blog/hello-world', title: 'Hello World', slug: 'hello-world' },
      { url: 'https://old.site.com/contact-page', title: 'Contact Us', slug: 'contact' },
      { url: 'https://old.site.com/gone-content', title: 'Old Product', slug: 'old-product' },
      { url: 'https://old.site.com/ambiguous-page', title: 'Duplicated Title', slug: 'ambig' },
      { url: 'https://old.site.com/required-missing', title: 'Required Page', slug: 'required' }
    ]
  };

  const destSitemap = [
    { url: 'https://new.site.com/about', title: 'About Us', slug: 'about' },
    { url: 'https://new.site.com/news/hello-world', title: 'Hello World Post', slug: 'hello-world' },
    { url: 'https://new.site.com/contact-new', title: 'Contact Us Now', slug: 'contact' },
    { url: 'https://new.site.com/other-hello-world', title: 'Another Hello World', slug: 'hello-world' }, // Causes slug ambiguity for hello-world
    { url: 'https://new.site.com/dup-1', title: 'Duplicated Title', slug: 'dup1' }, // Causes title ambiguity
    { url: 'https://new.site.com/dup-2', title: 'Duplicated Title', slug: 'dup2' }
  ];

  const overrides = {
    '/contact-page': '/contact-new',
    '/gone-content': 'gone'
  };

  const sourcePath = path.join(tempDir, 'source.json');
  const destPath = path.join(tempDir, 'dest.json');
  const overridesPath = path.join(tempDir, 'overrides.json');

  fs.writeFileSync(sourcePath, JSON.stringify(sourceManifest, null, 2));
  fs.writeFileSync(destPath, JSON.stringify(destSitemap, null, 2));
  fs.writeFileSync(overridesPath, JSON.stringify(overrides, null, 2));

  try {
    const result = await generateRedirectMap({
      sourcePath,
      destPath,
      overridesPath
    });

    assert.strictEqual(result.stats.total, 6);
    assert.strictEqual(result.stats.overrides, 2);

    // Verify manual overrides precedence
    const contactRedirect = result.map.find(r => r.source.includes('contact-page'));
    assert.ok(contactRedirect);
    assert.strictEqual(contactRedirect.target, '/contact-new');
    assert.strictEqual(contactRedirect.strategy, 'override');

    const goneRedirect = result.map.find(r => r.source.includes('gone-content'));
    assert.ok(goneRedirect);
    assert.strictEqual(goneRedirect.status, 410);
    assert.strictEqual(goneRedirect.notes.includes('gone'), true);

    // Verify Title Match (About Us matches About Us)
    const aboutRedirect = result.map.find(r => r.source.includes('about-us'));
    assert.ok(aboutRedirect);
    assert.strictEqual(aboutRedirect.target, 'https://new.site.com/about');
    assert.strictEqual(aboutRedirect.classification, 'confident');
    assert.strictEqual(aboutRedirect.strategy, 'title');

    // Verify Slug Ambiguity (hello-world matches two destinations)
    const helloRedirect = result.map.find(r => r.source.includes('hello-world'));
    assert.ok(helloRedirect);
    assert.strictEqual(helloRedirect.classification, 'ambiguous');
    assert.strictEqual(helloRedirect.target, '');

    // Verify Title Ambiguity (Duplicated Title matches two destinations)
    const ambigRedirect = result.map.find(r => r.source.includes('ambiguous-page'));
    assert.ok(ambigRedirect);
    assert.strictEqual(ambigRedirect.classification, 'ambiguous');

    // Verify Missing Match
    const missingRedirect = result.map.find(r => r.source.includes('required-missing'));
    assert.ok(missingRedirect);
    assert.strictEqual(missingRedirect.classification, 'missing');
    assert.strictEqual(missingRedirect.status, 404);

  } finally {
    // Clean up
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Graph Validation: Loops, Chains, and Collisions', async () => {
  // Test case with a loop: A -> B -> A
  const mapWithLoop = [
    { source: '/page-a', target: '/page-b', status: 301, classification: 'exact' },
    { source: '/page-b', target: '/page-a', status: 301, classification: 'exact' }
  ];

  const loopRes = await validateRedirectMap(mapWithLoop);
  assert.strictEqual(loopRes.valid, false);
  assert.strictEqual(loopRes.loops.length, 1);
  assert.deepStrictEqual(loopRes.loops[0], ['/page-a', '/page-b', '/page-a']);

  // Test case with a chain: A -> B -> C
  const mapWithChain = [
    { source: '/page-a', target: '/page-b', status: 301, classification: 'exact' },
    { source: '/page-b', target: '/page-c', status: 301, classification: 'exact' }
  ];

  const chainRes = await validateRedirectMap(mapWithChain);
  assert.strictEqual(chainRes.chains.length, 1);
  assert.deepStrictEqual(chainRes.chains[0], ['/page-a', '/page-b', '/page-c']);

  // Test case with a collision: A -> B and A -> C
  const mapWithCollision = [
    { source: '/page-a', target: '/page-b', status: 301, classification: 'exact' },
    { source: '/page-a', target: '/page-c', status: 301, classification: 'exact' }
  ];

  const collisionRes = await validateRedirectMap(mapWithCollision);
  assert.strictEqual(collisionRes.valid, false);
  assert.strictEqual(collisionRes.collisions.length, 1);
  assert.strictEqual(collisionRes.collisions[0].source, '/page-a');
  assert.ok(collisionRes.collisions[0].targets.includes('/page-b'));
  assert.ok(collisionRes.collisions[0].targets.includes('/page-c'));

  // Test case with unresolved required URL (homepage root '/')
  const mapWithMissingHome = [
    { source: '/', target: '', status: 404, classification: 'missing' }
  ];

  const requiredRes = await validateRedirectMap(mapWithMissingHome);
  assert.strictEqual(requiredRes.valid, false);
  assert.strictEqual(requiredRes.unresolvedRequired.length, 1);
  assert.strictEqual(requiredRes.unresolvedRequired[0], '/');
});

test('Apache & Nginx Rules Generation', () => {
  const mapData = [
    { source: '/about-us', target: '/about', status: 301, classification: 'exact' },
    { source: '/product-page?id=5', target: '/product', status: 301, classification: 'exact' },
    { source: '/gone-content', target: '', status: 410, classification: 'exact' }
  ];

  const rules = exportRules(mapData);

  // Apache rules validation
  assert.ok(rules.apache.includes('RewriteEngine On'));
  assert.ok(rules.apache.includes('Redirect 301 "/about-us" "/about"'));
  assert.ok(rules.apache.includes('Redirect 410 "/gone-content"'));
  assert.ok(rules.apache.includes('RewriteCond %{QUERY_STRING} ^id=5$'));
  assert.ok(rules.apache.includes('RewriteRule ^product-page$ /product? [R=301,L]'));

  // Nginx individual rewrite rules validation
  assert.ok(rules.nginxRewrite.includes('rewrite ^/about-us$ /about permanent;'));
  assert.ok(rules.nginxRewrite.includes('if ($request_uri = "/product-page?id=5")'));
  assert.ok(rules.nginxRewrite.includes('return 301 /product?;'));

  // Nginx Map validation
  assert.ok(rules.nginxMap.includes('map $request_uri $redirect_uri {'));
  assert.ok(rules.nginxMap.includes('"/about-us" "/about";'));
  assert.ok(rules.nginxMap.includes('"/product-page?id=5" "/product";'));
  assert.ok(rules.nginxMap.includes('"/gone-content" "gone";'));
});

test('HTTP Destination Verification (Mock Server)', async () => {
  // Setup local mock HTTP server
  const server = http.createServer((req, res) => {
    if (req.url === '/ok-destination') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('OK');
    } else if (req.url === '/broken-destination') {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    } else {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Error');
    }
  });

  // Listen on a random free port
  const port = await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve(server.address().port);
    });
  });

  const baseUrl = `http://127.0.0.1:${port}`;

  const mapData = [
    { source: '/old-ok', target: `${baseUrl}/ok-destination`, status: 301, classification: 'exact' },
    { source: '/old-broken', target: `${baseUrl}/broken-destination`, status: 301, classification: 'exact' }
  ];

  try {
    const validationRes = await validateRedirectMap(mapData, { verifyDestinations: true });

    assert.strictEqual(validationRes.valid, false); // Failed due to broken destination
    assert.strictEqual(validationRes.brokenDestinations.length, 1);
    assert.strictEqual(validationRes.brokenDestinations[0].source, '/old-broken');
    assert.strictEqual(validationRes.brokenDestinations[0].status, 404);
  } finally {
    // Close the server
    await new Promise((resolve) => server.close(resolve));
  }
});
