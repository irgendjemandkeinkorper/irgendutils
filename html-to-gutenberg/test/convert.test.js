// Conversion pipeline acceptance tests (CLAUDE.md): every mapping-table row
// produces canonical block markup that round-trips through the grammar parser
// with zero warnings; fallbacks are flagged, never silent; re-conversion is
// deterministic.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseHTML } from '../src/htmlparser.js';
import { normalizeTree } from '../src/normalize.js';
import { convertDocument } from '../src/convert.js';
import { parseBlockMarkup, countBlocks } from '../src/grammar.js';

function convert(html, opts = {}) {
  const { root } = normalizeTree(parseHTML(html), opts);
  return convertDocument(root, opts);
}

/** Round-trip the produced markup through the grammar parser; must be clean. */
function roundTrip(markup) {
  const { root, warnings } = parseBlockMarkup(markup);
  assert.deepEqual(warnings, [], `grammar warnings: ${warnings.join('; ')}`);
  return countBlocks(root);
}

test('headings map to core/heading with level attr (h2 default omitted)', () => {
  const r = convert('<h1>One</h1><h2>Two</h2><h4>Four</h4>');
  assert.match(r.markup, /<!-- wp:heading \{"level":1\} -->/);
  assert.match(r.markup, /<!-- wp:heading -->\n<h2 class="wp-block-heading">Two<\/h2>/);
  assert.match(r.markup, /<!-- wp:heading \{"level":4\} -->/);
  assert.equal(roundTrip(r.markup).get('core/heading'), 3);
});

test('paragraph keeps allowed inline markup, drops unknown attrs', () => {
  const r = convert('<p id="x">Hi <strong>there</strong> <a href="/a" onclick="evil()">go</a></p>');
  assert.match(r.markup, /<p>Hi <strong>there<\/strong> <a href="\/a">go<\/a><\/p>/);
  assert.doesNotMatch(r.markup, /onclick/);
  roundTrip(r.markup);
});

test('bare inline runs outside <p> are wrapped into a paragraph', () => {
  const r = convert('Loose text with <em>emphasis</em>.<h2>Then a heading</h2>');
  assert.equal(r.counts.get('core/paragraph'), 1);
  assert.match(r.markup, /<p>Loose text with <em>emphasis<\/em>\.<\/p>/);
  roundTrip(r.markup);
});

test('nested lists produce core/list with core/list-item children', () => {
  const r = convert('<ul><li>a</li><li>b<ol><li>b1</li></ol></li></ul>');
  const counts = roundTrip(r.markup);
  assert.equal(counts.get('core/list'), 2);
  assert.equal(counts.get('core/list-item'), 3);
  assert.match(r.markup, /\{"ordered":true\}/);
});

test('figure > img with caption maps to core/image with wp-element-caption', () => {
  const r = convert(
    '<figure><img src="/hero.jpg" alt="Hero"><figcaption>Cap</figcaption></figure>',
    { mediaBase: 'https://cdn.example.com' }
  );
  assert.match(r.markup, /<!-- wp:image -->/);
  assert.match(r.markup, /src="https:\/\/cdn\.example\.com\/hero\.jpg"/);
  assert.match(r.markup, /alt="Hero"/);
  assert.match(r.markup, /<figcaption class="wp-element-caption">Cap<\/figcaption>/);
  roundTrip(r.markup);
});

test('image with a media map entry gets id/sizeSlug attrs and wp-image class', () => {
  const mediaMap = new Map([['/hero.jpg', { id: 42, url: 'https://wp.example.com/wp-content/uploads/hero.jpg' }]]);
  const r = convert('<img src="/hero.jpg" alt="">', { mediaMap });
  assert.match(r.markup, /"id":42/);
  assert.match(r.markup, /"sizeSlug":"full"/);
  assert.match(r.markup, /class="wp-image-42"/);
  roundTrip(r.markup);
});

test('adjacent button anchors group into one core/buttons', () => {
  const r = convert('<a class="btn" href="/a">A</a> <a class="button" href="/b">B</a>');
  const counts = roundTrip(r.markup);
  assert.equal(counts.get('core/buttons'), 1);
  assert.equal(counts.get('core/button'), 2);
  assert.match(r.markup, /wp-block-button__link wp-element-button/);
});

test('blockquote with cite maps to core/quote, inner paragraph included', () => {
  const r = convert('<blockquote><p>Wise words.</p><cite>Someone</cite></blockquote>');
  assert.match(r.markup, /<!-- wp:quote -->/);
  assert.match(r.markup, /<cite>Someone<\/cite>/);
  const counts = roundTrip(r.markup);
  assert.equal(counts.get('core/quote'), 1);
  assert.equal(counts.get('core/paragraph'), 1);
});

test('pre > code maps to core/code with entities preserved', () => {
  const r = convert('<pre><code>if (a &lt; b) { run("x&y"); }</code></pre>');
  assert.match(r.markup, /<!-- wp:code -->/);
  assert.match(r.markup, /a &lt; b/);
  assert.match(r.markup, /"x&amp;y"/);
  roundTrip(r.markup);
});

test('hr maps to self-contained core/separator', () => {
  const r = convert('<hr>');
  assert.match(r.markup, /<!-- wp:separator -->/);
  assert.match(r.markup, /has-alpha-channel-opacity/);
  roundTrip(r.markup);
});

test('table with thead/tbody maps to core/table preserving sections', () => {
  const r = convert(
    '<table><thead><tr><th>H</th></tr></thead><tbody><tr><td>c</td></tr></tbody></table>'
  );
  assert.match(r.markup, /<figure class="wp-block-table"><table><thead>/);
  roundTrip(r.markup);
});

test('div.row > div.col twins map to core/columns with two core/column', () => {
  const r = convert(
    '<div class="row"><div class="col"><p>L</p></div><div class="col"><p>R</p></div></div>'
  );
  const counts = roundTrip(r.markup);
  assert.equal(counts.get('core/columns'), 1);
  assert.equal(counts.get('core/column'), 2);
  assert.equal(counts.get('core/paragraph'), 2);
});

test('youtube iframe becomes core/embed with canonical watch URL', () => {
  const r = convert('<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>');
  assert.match(r.markup, /"url":"https:\/\/www\.youtube\.com\/watch\?v=dQw4w9WgXcQ"/);
  assert.match(r.markup, /"providerNameSlug":"youtube"/);
  roundTrip(r.markup);
});

test('video tag maps to core/video', () => {
  const r = convert('<video src="/clip.mp4"></video>');
  assert.match(r.markup, /<figure class="wp-block-video"><video controls src="\/clip\.mp4">/);
  roundTrip(r.markup);
});

test('unmappable elements fall back to core/html and are flagged, never silent', () => {
  const r = convert('<canvas id="c"></canvas>');
  assert.equal(r.counts.get('core/html'), 1);
  assert.equal(r.fallbacks.length, 1);
  assert.match(r.fallbacks[0].reason, /no core block mapping/);
  roundTrip(r.markup);
});

test('plain wrapper divs unwrap transparently (no phantom blocks)', () => {
  const r = convert('<div><section><p>Deep</p></section></div>');
  const counts = roundTrip(r.markup);
  assert.deepEqual([...counts.keys()], ['core/paragraph']);
});

test('scripts, styles and comments are stripped and reported by normalize', () => {
  const { root, dropped } = normalizeTree(
    parseHTML('<script>x()</script><!-- note --><p>Kept</p>')
  );
  const r = convertDocument(root);
  assert.equal(r.counts.get('core/paragraph'), 1);
  assert.doesNotMatch(r.markup, /script|note/);
  assert.equal(dropped.length, 2);
});

test('kitchen-sink fixture: zero grammar warnings, one flagged fallback, deterministic', () => {
  const html = readFileSync(new URL('./fixtures/kitchen-sink.html', import.meta.url), 'utf8');
  const opts = { mediaBase: 'https://origin.example.com' };
  const r1 = convert(html, opts);
  const counts = roundTrip(r1.markup);

  // The only intentional unmappable in the fixture is <canvas>.
  assert.equal(r1.fallbacks.length, 1, JSON.stringify(r1.fallbacks, null, 2));
  assert.match(r1.fallbacks[0].node, /canvas/);

  // Spot-check the fixture hits every mapping row.
  for (const name of [
    'core/heading', 'core/paragraph', 'core/list', 'core/list-item', 'core/image',
    'core/buttons', 'core/button', 'core/quote', 'core/code', 'core/separator',
    'core/table', 'core/columns', 'core/column', 'core/embed', 'core/video', 'core/html',
  ]) {
    assert.ok(counts.get(name) > 0, `expected at least one ${name}`);
  }

  // Deterministic: converting the same input twice is byte-identical.
  const r2 = convert(html, { mediaBase: 'https://origin.example.com' });
  assert.equal(r1.markup, r2.markup);

  // Grammar counts agree with the converter's own counts.
  for (const [name, n] of r1.counts) {
    assert.equal(counts.get(name), n, `count mismatch for ${name}`);
  }
});
