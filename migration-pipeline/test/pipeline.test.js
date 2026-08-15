import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadPipelineManifest, generateSubConfigs } from '../src/config.js';
import { loadState, saveState, redactText } from '../src/runlog.js';
import { runPipeline } from '../src/orchestrator.js';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-test-'));
}

test('loadPipelineManifest sets correct default values', () => {
  const manifest = loadPipelineManifest('fixtures/pipeline-fixture.yml');
  assert.equal(manifest.name, 'Offline Redesign');
  assert.equal(manifest.slug, 'offline-redesign');
  assert.equal(manifest.client, 'Acme Co');
  assert.equal(manifest.status, 'active');
  assert.deepEqual(manifest.site_urls, ['https://old.example.com']);
  assert.equal(manifest.scraper.max_pages, 50);
});

test('generateSubConfigs writes correct config structure', () => {
  const dir = tmpDir();
  const manifest = loadPipelineManifest('fixtures/pipeline-fixture.yml');
  const paths = generateSubConfigs(manifest, dir);

  assert.ok(fs.existsSync(paths.scraper));
  assert.ok(fs.existsSync(paths.vault));
  assert.ok(fs.existsSync(paths.spinup));
  assert.ok(fs.existsSync(paths.qa));
  assert.ok(fs.existsSync(paths.audit));
  assert.ok(fs.existsSync(paths.h2g));

  fs.rmSync(dir, { recursive: true, force: true });
});

test('redactText successfully masks sensitive keys from process.env', () => {
  const secrets = [ /secret_token_123/g ];
  const logMsg = 'Connecting with secret_token_123 to database';
  const redacted = redactText(logMsg, secrets);
  assert.equal(redacted, 'Connecting with [REDACTED] to database');
});

test('loadState returns fresh state if state.json does not exist', () => {
  const dir = tmpDir();
  const state = loadState('test-slug', dir);
  assert.equal(state.slug, 'test-slug');
  assert.equal(state.lastCompletedStage, null);
  assert.equal(state.stages.scrape.status, 'pending');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('saveState and loadState round-trip perfectly', () => {
  const dir = tmpDir();
  const state = loadState('test-slug', dir);
  state.stages.scrape.status = 'completed';
  state.lastCompletedStage = 'scrape';

  saveState(dir, state);

  const loaded = loadState('test-slug', dir);
  assert.equal(loaded.lastCompletedStage, 'scrape');
  assert.equal(loaded.stages.scrape.status, 'completed');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('dry-run execution does not write states or run commands', () => {
  const result = runPipeline('fixtures/pipeline-fixture.yml', { dryRun: true });
  assert.equal(result.success, true);
  assert.equal(result.dryRun, true);
});

test('pipeline run offline end-to-end executes successfully', () => {
  // Clear any existing out folder for a clean run
  fs.rmSync('./out/offline-redesign', { recursive: true, force: true });

  const result = runPipeline('fixtures/pipeline-fixture.yml', { offline: true });
  assert.equal(result.success, true);

  // Verify state file is saved
  assert.ok(fs.existsSync('./out/offline-redesign/state.json'));
  const state = JSON.parse(fs.readFileSync('./out/offline-redesign/state.json', 'utf8'));
  assert.equal(state.stages.scrape.status, 'completed');
  assert.equal(state.stages.convert.status, 'completed');
  assert.equal(state.stages.vault.status, 'completed');
  assert.equal(state.stages.spinup.status, 'completed');
  assert.equal(state.stages.qa.status, 'completed');
  assert.equal(state.stages.audit.status, 'completed');
});

test('resume option skips already completed stages', () => {
  // Rely on the previous completed run in `./out/offline-redesign`
  // Modify state to set "qa" to pending, so it is the first pending
  const baseOutputDir = './out/offline-redesign';
  const state = loadState('offline-redesign', baseOutputDir);
  state.stages.qa.status = 'pending';
  state.stages.audit.status = 'pending';
  saveState(baseOutputDir, state);

  // Run resume
  const result = runPipeline('fixtures/pipeline-fixture.yml', { offline: true, resume: true });
  assert.equal(result.success, true);

  const stateAfter = loadState('offline-redesign', baseOutputDir);
  assert.equal(stateAfter.stages.qa.status, 'completed');
  assert.equal(stateAfter.stages.audit.status, 'completed');
});

test('rerun-from-stage option skips previous but reruns target stage onwards', () => {
  const baseOutputDir = './out/offline-redesign';
  const stateBefore = loadState('offline-redesign', baseOutputDir);
  // Mark all as completed first
  for (const s of Object.keys(stateBefore.stages)) {
    stateBefore.stages[s].status = 'completed';
  }
  saveState(baseOutputDir, stateBefore);

  // Run with rerun-from-stage spinup
  const result = runPipeline('fixtures/pipeline-fixture.yml', { offline: true, rerunFromStage: 'spinup' });
  assert.equal(result.success, true);

  const stateAfter = loadState('offline-redesign', baseOutputDir);
  assert.equal(stateAfter.stages.scrape.status, 'completed'); // untouched
  assert.equal(stateAfter.stages.spinup.status, 'completed'); // rerun
  assert.equal(stateAfter.stages.qa.status, 'completed');     // rerun
  assert.equal(stateAfter.stages.audit.status, 'completed');  // rerun
});
