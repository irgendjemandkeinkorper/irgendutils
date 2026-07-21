import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkConsole, isBeaconUrl, isAbortedReason } from '../src/checks/consoleCheck.js';

const bySeverity = (findings, sev) => findings.filter((f) => f.severity === sev);

test('error-level console messages are errors; warnings are warnings', () => {
  const f = checkConsole(
    [
      { type: 'error', text: 'Uncaught TypeError: x is undefined' },
      { type: 'warning', text: 'deprecated API' },
      { type: 'log', text: 'noise' },
    ],
    [],
  );
  assert.equal(bySeverity(f, 'error').length, 1);
  assert.equal(bySeverity(f, 'warn').length, 1);
  assert.equal(f.length, 2); // 'log' ignored
});

test('a genuinely failed resource is an error', () => {
  const f = checkConsole([], [{ url: 'https://site.test/app.js', reason: 'net::ERR_CONNECTION_REFUSED' }]);
  assert.equal(f[0].severity, 'error');
  assert.match(f[0].message, /Failed request/);
});

test('an aborted request is downgraded to a warning, not an error', () => {
  const f = checkConsole([], [{ url: 'https://site.test/thing', reason: 'net::ERR_ABORTED' }]);
  assert.equal(f[0].severity, 'warn');
  assert.equal(f[0].details.aborted, true);
});

test('analytics/beacon failures are info and never fail the check (the live-run false positive)', () => {
  const gaUrl =
    'https://www.google-analytics.com/g/collect?v=2&tid=G-ZZPT74ZBFD&dl=https%3A%2F%2Fexample.com%2F&very=long&query=string';
  const f = checkConsole([], [{ url: gaUrl, reason: 'net::ERR_ABORTED' }]);
  assert.equal(f[0].severity, 'info');
  assert.equal(f[0].details.beacon, true);
  // Beacon URL is tidied (query string dropped) so the report stays readable.
  assert.equal(f[0].message.includes('?'), false);
  assert.match(f[0].message, /google-analytics\.com\/g\/collect/);
});

test('the beacon downgrade applies across common trackers', () => {
  for (const url of [
    'https://www.googletagmanager.com/gtm.js?id=GTM-XXXX',
    'https://connect.facebook.net/en_US/fbevents.js',
    'https://stats.g.doubleclick.net/g/collect',
    'https://a.clarity.ms/collect',
  ]) {
    assert.equal(isBeaconUrl(url), true, url);
    const f = checkConsole([], [{ url, reason: 'net::ERR_ABORTED' }]);
    assert.equal(f[0].severity, 'info', url);
  }
});

test('a real first-party asset is NOT treated as a beacon', () => {
  assert.equal(isBeaconUrl('https://site.test/wp-content/app.js'), false);
});

test('isAbortedReason recognises abort/blocked variants only', () => {
  assert.equal(isAbortedReason('net::ERR_ABORTED'), true);
  assert.equal(isAbortedReason('net::ERR_BLOCKED_BY_CLIENT'), true);
  assert.equal(isAbortedReason('net::ERR_NAME_NOT_RESOLVED'), false);
  assert.equal(isAbortedReason(''), false);
});
