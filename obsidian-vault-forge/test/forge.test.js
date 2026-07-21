// Unit + integration tests for the forge. Offline, no installs: everything is
// file I/O into a temp dir.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { loadManifest, normalizeManifest, ManifestError } from '../src/manifest.js';
import { buildPlan } from '../src/forge.js';
import { applyPlan } from '../src/write.js';
import { verifyVault, checkFrontMatter } from '../src/verify.js';
import { scanPlan } from '../src/secretscan.js';
import { sha256 } from '../src/util.js';

const appDir = fileURLToPath(new URL('..', import.meta.url));
const fixture = (n) => path.join(appDir, 'fixtures', n);
const DATE = '2026-07-21';

function tmp() {
  const dir = mkdtempSync(path.join(tmpdir(), 'ovf-'));
  test.after?.(() => {});
  return dir;
}

function forgeFixture(root, { today = DATE } = {}) {
  const manifest = loadManifest(fixture('project.yml'));
  const plan = buildPlan(manifest, { today });
  const vault = path.join(root, plan.vaultName);
  applyPlan(vault, plan);
  return { vault, plan, manifest };
}

test('manifest: derives slug and requires name', () => {
  const m = normalizeManifest({ name: 'Big Rebuild' });
  assert.equal(m.slug, 'big-rebuild');
  assert.throws(() => loadManifest(fixture('no-name.yml')), ManifestError);
});

test('forge produces a vault that passes all acceptance checks', () => {
  const root = tmp();
  try {
    const { vault } = forgeFixture(root);
    const result = verifyVault(vault);
    assert.deepEqual(result.dangling, [], 'no dangling wikilinks');
    assert.deepEqual(result.frontmatter, [], 'valid front-matter everywhere');
    assert.deepEqual(result.secrets, [], 'no secrets written');
    assert.ok(result.ok);
    // Core structure exists.
    for (const f of ['00-Index.md', '01-Brief/Project Brief.md', '06-Tasks/Tasks.md']) {
      assert.ok(fs.existsSync(path.join(vault, f)), `${f} exists`);
    }
    for (const d of ['04-Decisions', '05-Meetings', '07-Assets & References']) {
      assert.ok(fs.statSync(path.join(vault, d)).isDirectory(), `${d}/ exists`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('colliding stakeholder names both get a note', () => {
  const root = tmp();
  try {
    const { vault } = forgeFixture(root);
    assert.ok(fs.existsSync(path.join(vault, '02-Stakeholders/Jane Doe.md')));
    assert.ok(fs.existsSync(path.join(vault, '02-Stakeholders/Jane Doe (2).md')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('credentials never reach the vault (embedded URL creds stripped)', () => {
  const root = tmp();
  try {
    const { vault } = forgeFixture(root);
    const inv = fs.readFileSync(path.join(vault, '03-Sites & Environments/Site Inventory.md'), 'utf8');
    assert.ok(!inv.includes('hunter2'), 'password stripped from URL');
    assert.ok(inv.includes('old.acme.example.com'), 'host is kept');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('scanPlan flags a secret before it would be written', () => {
  const plan = { files: [{ path: 'x.md', content: 'token: abcdef123456\n' }] };
  const leaks = scanPlan(plan);
  assert.equal(leaks.length, 1);
  assert.equal(leaks[0].pattern, 'credential assignment');
});

test('re-forging the same manifest is a no-op (idempotent)', () => {
  const root = tmp();
  try {
    const manifest = loadManifest(fixture('project.yml'));
    const plan = buildPlan(manifest, { today: DATE });
    const vault = path.join(root, plan.vaultName);
    applyPlan(vault, plan);
    const actions = applyPlan(vault, plan);
    const changed = actions.filter((a) => !['unchanged', 'dir'].includes(a.action));
    assert.deepEqual(changed, [], 'second run changes nothing');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('--update never clobbers an existing note; writes .new sibling', () => {
  const root = tmp();
  try {
    const manifest = loadManifest(fixture('project.yml'));
    const vault = path.join(root, manifest.slug);
    applyPlan(vault, buildPlan(manifest, { today: DATE }));

    const indexPath = path.join(vault, '00-Index.md');
    const before = sha256(fs.readFileSync(indexPath, 'utf8'));

    // A later forge with a different date changes generated content.
    const actions = applyPlan(vault, buildPlan(manifest, { today: '2026-08-01' }), { update: true });

    const after = sha256(fs.readFileSync(indexPath, 'utf8'));
    assert.equal(before, after, 'original note is byte-identical');
    assert.ok(fs.existsSync(path.join(vault, '00-Index.new.md')), 'sibling written');
    assert.ok(actions.some((a) => a.action === 'new-sibling'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('checkFrontMatter catches a note missing required keys', () => {
  const root = tmp();
  try {
    const { vault } = forgeFixture(root);
    fs.writeFileSync(path.join(vault, '01-Brief/bad.md'), '---\ntype: brief\n---\n\nno keys\n');
    const problems = checkFrontMatter(vault);
    assert.ok(problems.some((p) => p.file.endsWith('bad.md') && /missing keys/.test(p.issue)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
