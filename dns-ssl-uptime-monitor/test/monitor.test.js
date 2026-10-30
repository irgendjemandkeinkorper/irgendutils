import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('dns-ssl-uptime-monitor package structure and checks', () => {
  assert.ok(fs.existsSync('package.json'));
  assert.ok(fs.existsSync('src/checks/tls.js'));
  assert.ok(fs.existsSync('src/checks/uptime.js'));
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  assert.equal(pkg.name, '@irgendutils/dns-ssl-uptime-monitor');
  assert.equal(pkg.scripts.test, 'node --test');
});
