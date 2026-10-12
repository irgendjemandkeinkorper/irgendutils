import test from 'node:test';
import assert from 'node:assert';
import { assembleDigest } from '../src/digest.js';

test('assembleDigest aggregates counts and per-project statistics efficiently and accurately', () => {
  const rows = [
    { project: 'AppA', package: 'pkg-sec', security: true, jump: 'patch' },
    { project: 'AppA', package: 'pkg-maj', security: false, jump: 'major' },
    { project: 'AppB', package: 'pkg-min', security: false, jump: 'minor' },
  ];
  const projects = ['AppA', 'AppB', 'AppC'];

  const digest = assembleDigest({ rows, projects, errors: [] });

  assert.strictEqual(digest.counts.total, 3);
  assert.strictEqual(digest.counts.security, 1);
  assert.strictEqual(digest.counts.major, 1);
  assert.strictEqual(digest.counts.minor, 1);
  assert.strictEqual(digest.counts.patch, 0);

  assert.deepStrictEqual(digest.projects, ['AppA', 'AppB', 'AppC']);

  assert.deepStrictEqual(digest.perProject.AppA, {
    total: 2,
    security: 1,
    major: 1,
    minor: 0,
    patch: 0,
    upToDate: false,
  });

  assert.deepStrictEqual(digest.perProject.AppB, {
    total: 1,
    security: 0,
    major: 0,
    minor: 1,
    patch: 0,
    upToDate: false,
  });

  assert.deepStrictEqual(digest.perProject.AppC, {
    total: 0,
    security: 0,
    major: 0,
    minor: 0,
    patch: 0,
    upToDate: true,
  });
});
