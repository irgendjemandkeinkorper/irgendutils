import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanWorktree } from '../src/scan.js';
import { RULES } from '../src/rules.js';
import { runDrift } from '../src/drift.js';

test('scans Python files for leaked credentials', () => {
  const root = mkdtempSync(join(tmpdir(), 'secaudit-python-'));
  try {
    mkdirSync(join(root, 'config'));
    writeFileSync(join(root, 'config', 'settings.py'), 'API_KEY = "ghp_123456789012345678901234567890123456"\n');
    const findings = scanWorktree(root, { rules: RULES });
    assert.ok(findings.some((finding) => finding.rule === 'github_pat'));
    assert.equal(findings[0].file, 'config/settings.py');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('checks env drift for Python package configuration files', () => {
  const root = mkdtempSync(join(tmpdir(), 'secaudit-env-'));
  try {
    writeFileSync(join(root, '.env.example'), 'API_URL=https://example.test\nAPI_KEY=placeholder\n');
    writeFileSync(join(root, '.env.local'), 'API_URL=https://local.test\n');
    const result = runDrift({ env_drift: { envs: [
      { name: 'example', file: '.env.example' },
      { name: 'local', file: '.env.local' },
    ] } }, { baseDir: root });
    assert.ok(result.findings.some((finding) => finding.rule === 'missing_key' && finding.key === 'API_KEY'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
