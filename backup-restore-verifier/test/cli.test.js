import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../src/cli.js';

test('parseArgs parses CLI flags correctly', () => {
  const flags = parseArgs(['run', '--with-smoke', '-c', 'custom.yml']);
  assert.equal(flags.command, 'run');
  assert.equal(flags.withSmoke, true);
  assert.equal(flags.config, 'custom.yml');
});
