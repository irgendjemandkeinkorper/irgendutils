import test from 'node:test';
import assert from 'node:assert';
import { scanProjects } from '../src/run.js';
import { FixtureAdapter } from '../src/adapters/fixture.js';

test('dependency-update-digest runner with NetworkOrchestrator integration', async (t) => {

  // Set up mock adapter with custom timing
  class MockAdapter {
    constructor() {
      this.activeCount = 0;
      this.peakConcurrency = 0;
    }

    async trackConcurrency(delayMs) {
      this.activeCount++;
      if (this.activeCount > this.peakConcurrency) {
        this.peakConcurrency = this.activeCount;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      this.activeCount--;
    }

    async composerOutdated(project) {
      await this.trackConcurrency(20);
      return { installed: [] };
    }

    async composerAudit(project) {
      return { advisories: {} };
    }

    async npmOutdated(project) {
      await this.trackConcurrency(20);
      return {};
    }

    async npmAudit(project) {
      return { vulnerabilities: {} };
    }

    async wpPluginList(project) {
      await this.trackConcurrency(20);
      return [];
    }

    async wpVulns(project) {
      return [];
    }
  }

  await t.test('concurrency limits are respected and deterministic output is preserved', async () => {
    const config = {
      projects: [
        { name: 'ProjA', types: ['composer', 'npm'] },
        { name: 'ProjB', types: ['wp', 'npm'] },
        { name: 'ProjC', types: ['composer'] },
      ],
    };

    const adapter = new MockAdapter();
    const result = await scanProjects(config, adapter, {
      globalLimit: 2,
    });

    assert.ok(adapter.peakConcurrency <= 2, `Peak adapter concurrency should not exceed 2, got ${adapter.peakConcurrency}`);
    assert.ok(result.telemetry.peakGlobalConcurrency <= 2, `Telemetry peak concurrency should not exceed 2, got ${result.telemetry.peakGlobalConcurrency}`);

    // Check that we got telemetry and slow stage details
    assert.ok(result.telemetry.slowestStage, 'Should identify the slowest stage');
    assert.ok(result.telemetry.stages, 'Should contain stage-specific timings');
    assert.strictEqual(result.projects.length, 3);
    assert.deepStrictEqual(result.projects, ['ProjA', 'ProjB', 'ProjC']);
  });
});

test('normalizes outdated and vulnerable Python requirements fixtures', async () => {
  const adapter = new FixtureAdapter('test/fixtures');
  const result = await scanProjects(
    { projects: [{ name: 'PythonTool', types: ['pip'] }] },
    adapter,
  );
  assert.equal(result.errors.length, 0);
  assert.deepEqual(result.rows.map((row) => row.package), ['requests', 'urllib3']);
  assert.equal(result.rows.find((row) => row.package === 'requests').jump, 'minor');
  assert.equal(result.rows.find((row) => row.package === 'urllib3').security, true);
});
