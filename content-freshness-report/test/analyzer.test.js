import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getRelativePath, resolveRulesForPath } from '../src/config.js';
import { calculateWordCount, checkHeadingStructure, runAnalysis, FINDING_TYPES } from '../src/analyzer.js';
import { compareSnapshots } from '../src/report.js';

test('getRelativePath normalizes URLs correctly', () => {
  assert.equal(getRelativePath('https://example.com/blog/hello-world'), '/blog/hello-world');
  assert.equal(getRelativePath('/about-us'), '/about-us');
  assert.equal(getRelativePath(''), '/');
  assert.equal(getRelativePath(null), '/');
  assert.equal(getRelativePath('https://example.com/search?q=query'), '/search?q=query');
});

test('resolveRulesForPath applies defaults and path-specific overrides', () => {
  const config = {
    defaults: {
      freshness_threshold_days: 100,
      thin_content_threshold: 200,
      entry_pages: ['/'],
    },
    rules: [
      {
        path: '^/privacy$',
        exclude: true,
      },
      {
        path: '^/blog/.*',
        thin_content_threshold: 500,
        freshness_threshold_days: 50,
      },
    ],
  };

  // Default path
  const rDefault = resolveRulesForPath(config, 'https://example.com/about');
  assert.equal(rDefault.exclude, false);
  assert.equal(rDefault.freshness_threshold_days, 100);
  assert.equal(rDefault.thin_content_threshold, 200);

  // Excluded path
  const rExcluded = resolveRulesForPath(config, '/privacy');
  assert.equal(rExcluded.exclude, true);

  // Overridden path
  const rBlog = resolveRulesForPath(config, 'https://example.com/blog/post-1');
  assert.equal(rBlog.exclude, false);
  assert.equal(rBlog.freshness_threshold_days, 50);
  assert.equal(rBlog.thin_content_threshold, 500);
});

test('calculateWordCount counts words and strips HTML tags', () => {
  assert.equal(calculateWordCount(''), 0);
  assert.equal(calculateWordCount(null), 0);
  assert.equal(calculateWordCount('One two three.'), 3);
  assert.equal(calculateWordCount('<p>One <strong>two</strong> three.</p>'), 3);
  assert.equal(calculateWordCount('   One    two \n\n three.  '), 3);
});

test('checkHeadingStructure validates headings structure correctly', () => {
  // Good structure
  const good = ['H1: Page Title', 'H2: Section 1', 'H3: Subsection', 'H2: Section 2'];
  assert.deepEqual(checkHeadingStructure(good), []);

  // No headings
  const empty = [];
  const emptyRes = checkHeadingStructure(empty);
  assert.equal(emptyRes.length, 1);
  assert.equal(emptyRes[0].type, FINDING_TYPES.NO_HEADINGS.type);

  // Missing H1
  const missingH1 = ['H2: Section 1', 'H3: Subsection'];
  const missingH1Res = checkHeadingStructure(missingH1);
  assert.equal(missingH1Res.length, 1);
  assert.equal(missingH1Res[0].type, FINDING_TYPES.MISSING_H1.type);

  // Multiple H1s
  const multH1 = ['H1: Title 1', 'H1: Title 2', 'H2: Section'];
  const multH1Res = checkHeadingStructure(multH1);
  assert.equal(multH1Res.length, 1);
  assert.equal(multH1Res[0].type, FINDING_TYPES.MULTIPLE_H1.type);

  // Non-sequential skip
  const skipped = ['H1: Title', 'H2: Section', 'H4: Sub-subsection'];
  const skippedRes = checkHeadingStructure(skipped);
  assert.equal(skippedRes.length, 1);
  assert.equal(skippedRes[0].type, FINDING_TYPES.NON_SEQUENTIAL_HEADINGS.type);
});

test('runAnalysis: content freshness checks', () => {
  const pages = [
    {
      url: 'https://example.com/fresh',
      title: 'Fresh Page',
      date: '2026-01-01',
      content: 'Lots of substantive content. '.repeat(50),
    },
    {
      url: 'https://example.com/stale',
      title: 'Stale Page',
      date: '2024-01-01',
      content: 'Lots of substantive content. '.repeat(50),
    },
    {
      url: 'https://example.com/unknown',
      title: 'Unknown Date Page',
      date: null,
      content: 'Lots of substantive content. '.repeat(50),
    },
    {
      url: 'https://example.com/invalid-date',
      title: 'Invalid Date Page',
      date: 'not-a-date-format',
      content: 'Lots of substantive content. '.repeat(50),
    },
  ];

  const config = { defaults: { freshness_threshold_days: 365, thin_content_threshold: 50, entry_pages: ['/'] } };
  const result = runAnalysis(pages, config, { currentDate: '2026-06-01' });

  // Fresh page: no date findings
  const freshPage = result.pages.find(p => p.url.endsWith('/fresh'));
  assert.ok(freshPage);
  assert.equal(freshPage.findings.some(f => f.type === FINDING_TYPES.STALE_CONTENT.type), false);
  assert.equal(freshPage.findings.some(f => f.type === FINDING_TYPES.UNKNOWN_DATE.type), false);

  // Stale page: stale content finding
  const stalePage = result.pages.find(p => p.url.endsWith('/stale'));
  assert.ok(stalePage);
  assert.equal(stalePage.findings.some(f => f.type === FINDING_TYPES.STALE_CONTENT.type), true);
  assert.equal(stalePage.findings.some(f => f.type === FINDING_TYPES.UNKNOWN_DATE.type), false);

  // Unknown date: unknown date finding (not stale)
  const unknownPage = result.pages.find(p => p.url.endsWith('/unknown'));
  assert.ok(unknownPage);
  assert.equal(unknownPage.findings.some(f => f.type === FINDING_TYPES.UNKNOWN_DATE.type), true);
  assert.equal(unknownPage.findings.some(f => f.type === FINDING_TYPES.STALE_CONTENT.type), false);

  // Invalid date: unknown date finding (not stale)
  const invalidPage = result.pages.find(p => p.url.endsWith('/invalid-date'));
  assert.ok(invalidPage);
  assert.equal(invalidPage.findings.some(f => f.type === FINDING_TYPES.UNKNOWN_DATE.type), true);
  assert.equal(invalidPage.findings.some(f => f.type === FINDING_TYPES.STALE_CONTENT.type), false);
});

test('runAnalysis: duplicate metadata checks', () => {
  const pages = [
    {
      url: 'https://example.com/p1',
      title: 'Duplicate Title',
      metaDesc: 'Unique description 1',
    },
    {
      url: 'https://example.com/p2',
      title: 'Duplicate Title',
      metaDesc: 'Duplicate description',
    },
    {
      url: 'https://example.com/p3',
      title: 'Unique Title',
      metaDesc: 'Duplicate description',
    },
  ];

  const config = { defaults: { entry_pages: [] } };
  const result = runAnalysis(pages, config);

  const p1 = result.pages.find(p => p.url.endsWith('/p1'));
  const p2 = result.pages.find(p => p.url.endsWith('/p2'));
  const p3 = result.pages.find(p => p.url.endsWith('/p3'));

  // p1 and p2 should have duplicate title
  assert.ok(p1.findings.some(f => f.type === FINDING_TYPES.DUPLICATE_TITLE.type));
  assert.ok(p2.findings.some(f => f.type === FINDING_TYPES.DUPLICATE_TITLE.type));
  assert.equal(p3.findings.some(f => f.type === FINDING_TYPES.DUPLICATE_TITLE.type), false);

  // p2 and p3 should have duplicate desc
  assert.ok(p2.findings.some(f => f.type === FINDING_TYPES.DUPLICATE_DESC.type));
  assert.ok(p3.findings.some(f => f.type === FINDING_TYPES.DUPLICATE_DESC.type));
  assert.equal(p1.findings.some(f => f.type === FINDING_TYPES.DUPLICATE_DESC.type), false);
});

test('runAnalysis: orphan page detection & entry page exemption', () => {
  const pages = [
    {
      url: 'https://example.com/',
      title: 'Home',
      links: ['https://example.com/about'],
    },
    {
      url: 'https://example.com/about',
      title: 'About Us',
      links: [],
    },
    {
      url: 'https://example.com/orphan',
      title: 'Orphan Page',
      links: [],
    },
  ];

  const config = {
    defaults: {
      entry_pages: ['/'], // Home is exempt
    },
  };

  const result = runAnalysis(pages, config);

  const home = result.pages.find(p => p.url === 'https://example.com/');
  const about = result.pages.find(p => p.url === 'https://example.com/about');
  const orphan = result.pages.find(p => p.url === 'https://example.com/orphan');

  // Home has 0 inbound links but is configured as entry page, so it should NOT be flagged as orphan
  assert.equal(home.findings.some(f => f.type === FINDING_TYPES.ORPHAN.type), false);

  // About has 1 inbound link, so NOT flagged as orphan
  assert.equal(about.findings.some(f => f.type === FINDING_TYPES.ORPHAN.type), false);

  // Orphan has 0 inbound links and is NOT an entry page, so it MUST be flagged as orphan
  assert.ok(orphan.findings.some(f => f.type === FINDING_TYPES.ORPHAN.type));
});

test('runAnalysis: priority scores sorting', () => {
  const pages = [
    {
      url: 'https://example.com/many-issues',
      title: 'Duplicate Title', // duplicate with below
      metaDesc: 'Duplicate description', // duplicate with below
      date: null, // unknown date (+10)
      headings: [], // no headings (+20)
      content: 'Thin.', // thin content (+30)
    },
    {
      url: 'https://example.com/some-issues',
      title: 'Duplicate Title',
      metaDesc: 'Duplicate description',
      date: '2026-01-01',
      headings: ['H1: Fine'],
      content: 'Substantive '.repeat(100), // fine
    },
    {
      url: 'https://example.com/fine',
      title: 'Fine Page',
      metaDesc: 'Unique description',
      date: '2026-01-01',
      headings: ['H1: Fine'],
      content: 'Substantive '.repeat(100), // fine
    },
  ];

  const config = { defaults: { entry_pages: [] } }; // No exempt entry pages
  const result = runAnalysis(pages, config);

  // The pages should be sorted descending by priorityScore
  assert.ok(result.pages[0].priorityScore > result.pages[1].priorityScore);
  assert.ok(result.pages[1].priorityScore > result.pages[2].priorityScore);

  assert.equal(result.pages[0].url, 'https://example.com/many-issues');
  assert.equal(result.pages[1].url, 'https://example.com/some-issues');
  assert.equal(result.pages[2].url, 'https://example.com/fine');
});

test('compareSnapshots classifies findings correctly', () => {
  const current = [
    { relativePath: '/about', type: FINDING_TYPES.THIN_CONTENT.type, label: 'Thin Content', severity: 'Medium-Low', message: 'Thin content' },
    { relativePath: '/blog-1', type: FINDING_TYPES.STALE_CONTENT.type, label: 'Stale Content', severity: 'Medium', message: 'Stale' },
  ];

  const previous = [
    { relativePath: '/about', type: FINDING_TYPES.THIN_CONTENT.type, label: 'Thin Content', severity: 'Medium-Low', message: 'Thin content' },
    { relativePath: '/old-resolved-page', type: FINDING_TYPES.ORPHAN.type, label: 'Orphan Page', severity: 'Critical', message: 'Orphan' },
  ];

  const diff = compareSnapshots(current, previous);

  // '/blog-1' stale finding is new
  assert.equal(diff.newFindings.length, 1);
  assert.equal(diff.newFindings[0].relativePath, '/blog-1');

  // '/about' thin finding is unchanged
  assert.equal(diff.unchangedFindings.length, 1);
  assert.equal(diff.unchangedFindings[0].relativePath, '/about');

  // '/old-resolved-page' orphan finding is resolved
  assert.equal(diff.resolvedFindings.length, 1);
  assert.equal(diff.resolvedFindings[0].relativePath, '/old-resolved-page');
});
