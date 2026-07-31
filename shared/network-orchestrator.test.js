import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { NetworkOrchestrator, getHost, sanitizeData } from './network-orchestrator.js';

// Helper to delay execution
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('NetworkOrchestrator Unit & Performance Tests', async (t) => {
  const cachePath = path.join(process.cwd(), '.cache', 'test-network-cache.json');

  // Clean up test cache file before/after
  const cleanupCache = () => {
    try {
      if (fs.existsSync(cachePath)) {
        fs.unlinkSync(cachePath);
      }
    } catch {}
  };
  cleanupCache();

  await t.test('getHost helper correctly extracts hostnames', () => {
    assert.strictEqual(getHost('https://example.com/some/path?query=1'), 'example.com');
    assert.strictEqual(getHost('http://beta.example.org:8080/'), 'beta.example.org');
    assert.strictEqual(getHost('api.github.com'), 'api.github.com');
  });

  await t.test('sanitizeData redacts secret keys', () => {
    const raw = {
      url: 'https://example.com',
      headers: {
        'authorization': 'Bearer supersecrettoken',
        'cookie': 'sessionid=123',
        'content-type': 'application/json',
      },
    };
    const sanitized = sanitizeData(raw);
    assert.strictEqual(sanitized.headers.authorization, '[REDACTED]');
    assert.strictEqual(sanitized.headers.cookie, '[REDACTED]');
    assert.strictEqual(sanitized.headers['content-type'], 'application/json');
  });

  await t.test('concurrency limits are strictly respected', async () => {
    const orchestrator = new NetworkOrchestrator({
      globalLimit: 2,
      perHostLimit: 1,
      cacheEnabled: false,
    });

    let activeGlobal = 0;
    let maxActiveGlobal = 0;
    const activeHosts = {};
    const maxActiveHosts = {};

    const runTask = async (host, duration = 30) => {
      activeGlobal++;
      activeHosts[host] = (activeHosts[host] ?? 0) + 1;

      if (activeGlobal > maxActiveGlobal) maxActiveGlobal = activeGlobal;
      if (activeHosts[host] > (maxActiveHosts[host] ?? 0)) {
        maxActiveHosts[host] = activeHosts[host];
      }

      await delay(duration);

      activeGlobal--;
      activeHosts[host]--;
    };

    const tasks = [
      () => runTask('hostA'),
      () => runTask('hostA'),
      () => runTask('hostB'),
      () => runTask('hostB'),
      () => runTask('hostC'),
    ];

    await Promise.all([
      orchestrator.add(tasks[0], { host: 'hostA' }),
      orchestrator.add(tasks[1], { host: 'hostA' }),
      orchestrator.add(tasks[2], { host: 'hostB' }),
      orchestrator.add(tasks[3], { host: 'hostB' }),
      orchestrator.add(tasks[4], { host: 'hostC' }),
    ]);

    assert.ok(maxActiveGlobal <= 2, `Global concurrency exceeded limit of 2: got ${maxActiveGlobal}`);
    assert.ok(maxActiveHosts['hostA'] <= 1, `Host limit exceeded for hostA: got ${maxActiveHosts['hostA']}`);
    assert.ok(maxActiveHosts['hostB'] <= 1, `Host limit exceeded for hostB: got ${maxActiveHosts['hostB']}`);
    assert.strictEqual(orchestrator.telemetry.peakGlobalConcurrency, maxActiveGlobal);
  });

  await t.test('retries distinguish retryable and permanent failures', async () => {
    const orchestrator = new NetworkOrchestrator({
      maxRetries: 2,
      baseDelayMs: 5,
      cacheEnabled: false,
    });

    let retryableCount = 0;
    const retryableTask = async () => {
      retryableCount++;
      if (retryableCount < 3) {
        const err = new Error('Rate limit exceeded');
        err.status = 429;
        throw err;
      }
      return 'success';
    };

    let permanentCount = 0;
    const permanentTask = async () => {
      permanentCount++;
      const err = new Error('Not Found');
      err.status = 404;
      throw err;
    };

    const res = await orchestrator.add(retryableTask);
    assert.strictEqual(res, 'success');
    assert.strictEqual(retryableCount, 3, 'Should retry and succeed on 3rd attempt');

    await assert.rejects(
      orchestrator.add(permanentTask),
      (err) => {
        assert.strictEqual(err.status, 404);
        return true;
      }
    );
    assert.strictEqual(permanentCount, 1, 'Permanent failure (404) should fail immediately without retries');
  });

  await t.test('cancelOnFatal cancels remaining queue tasks', async () => {
    const orchestrator = new NetworkOrchestrator({
      globalLimit: 1,
      cancelOnFatal: true,
      cacheEnabled: false,
    });

    const fatalTask = async () => {
      const err = new Error('Fatal database crash');
      err.status = 404; // 404 is classified as fatal (not retryable)
      throw err;
    };

    const pendingTask = async () => 'should not run';

    const p1 = orchestrator.add(fatalTask);
    const p2 = orchestrator.add(pendingTask);

    await assert.rejects(p1);
    await assert.rejects(p2, /cancelled/i);
    assert.strictEqual(orchestrator.isCancelled, true);
  });

  await t.test('timeouts fail slow tasks', async () => {
    const orchestrator = new NetworkOrchestrator({
      timeoutMs: 15,
      cacheEnabled: false,
    });

    await assert.rejects(
      orchestrator.add(() => delay(50)),
      /timed out/i
    );
  });

  await t.test('cache features (TTL, disable/clear, secrets sanitization)', async () => {
    const orchestrator = new NetworkOrchestrator({
      cacheEnabled: true,
      cacheTtlMs: 50,
      cacheFilePath: cachePath,
    });

    let fetchCount = 0;
    const fetchFn = async () => {
      fetchCount++;
      return { data: 'ok', secretToken: '12345' };
    };

    const res1 = await orchestrator.add(fetchFn, { cacheKey: 'probe' });
    const res2 = await orchestrator.add(fetchFn, { cacheKey: 'probe' });

    assert.deepStrictEqual(res1, { data: 'ok', secretToken: '12345' });
    assert.strictEqual(fetchCount, 1, 'Second call should hit the cache');
    assert.strictEqual(orchestrator.telemetry.cacheHits, 1);
    assert.strictEqual(orchestrator.telemetry.cacheMisses, 1);

    // Verify cache file was written and sanitized
    const rawCache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    assert.strictEqual(rawCache.version, 'v1');
    assert.strictEqual(rawCache.data.probe.value.secretToken, '[REDACTED]', 'Secrets must be sanitized in stored cache');

    // Test TTL expiration
    await delay(60);
    const res3 = await orchestrator.add(fetchFn, { cacheKey: 'probe' });
    assert.strictEqual(fetchCount, 2, 'Should call again after TTL expires');

    // Test clearCache
    orchestrator.clearCache();
    assert.strictEqual(fs.existsSync(cachePath), false, 'Cache file should be deleted');
  });

  await t.test('benchmark: parallel execution outperforms serial execution', async () => {
    const taskCount = 4;
    const taskDuration = 30;

    // 1. Serial Run
    const serialStart = Date.now();
    for (let i = 0; i < taskCount; i++) {
      await delay(taskDuration);
    }
    const serialDuration = Date.now() - serialStart;

    // 2. Parallel Bounded Run with limits
    const orchestrator = new NetworkOrchestrator({
      globalLimit: 4,
      cacheEnabled: false,
    });

    const parallelStart = Date.now();
    orchestrator.startStage('allTasks');
    const tasks = Array.from({ length: taskCount }, () => () => delay(taskDuration));
    await orchestrator.run(tasks);
    orchestrator.endStage('allTasks');
    const parallelDuration = Date.now() - parallelStart;

    assert.ok(parallelDuration < serialDuration * 0.7, `Parallel duration (${parallelDuration}ms) is not significantly faster than serial (${serialDuration}ms)`);
    assert.ok(orchestrator.getSlowestStage().durationMs > 0);
  });

  cleanupCache();
});
