import test from 'node:test';
import assert from 'node:assert/strict';
import { parseYaml } from '../src/yaml.js';

test('parseYaml parses simple key-value pairs', () => {
  const yamlStr = `
version: "1.0"
interval_seconds: 300
features:
  tls: true
  dns: false
`;
  const parsed = parseYaml(yamlStr);
  assert.equal(parsed.version, '1.0');
  assert.equal(parsed.interval_seconds, 300);
  assert.equal(parsed.features.tls, true);
  assert.equal(parsed.features.dns, false);
});
