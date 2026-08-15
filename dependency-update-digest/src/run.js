// Scan orchestration. Adapter interface (all methods async, all return the
// parsed JSON the native tool would emit):
//   composerOutdated(project, opts) -> { installed: [...] }
//   composerAudit(project, opts)    -> { advisories: {...} }
//   npmOutdated(project, opts)      -> { pkg: {...} }
//   npmAudit(project, opts)         -> { vulnerabilities: {...} }
//   wpPluginList(project, opts)     -> [ ... ]
//   wpVulns(project, opts)          -> [ ... ]   (wpvulndb-style feed, may be [])
//
// Real adapters (shelling out / WP REST) live in src/adapters/ and are
// import()ed lazily so tests and offline runs never touch them.

import { normalizeComposer, normalizeNpm, normalizeWp } from './normalize.js';
import { NetworkOrchestrator } from '../../shared/network-orchestrator.js';

export async function createAdapter(opts = {}) {
  if (opts.fixtures) {
    const { FixtureAdapter } = await import('./adapters/fixture.js');
    return new FixtureAdapter(opts.fixtures);
  }
  const { LiveAdapter } = await import('./adapters/live.js');
  return new LiveAdapter(opts);
}

export async function scanProjects(config, adapter, opts = {}) {
  const all = config?.projects ?? [];
  const projects = opts.project ? all.filter((p) => p.name === opts.project) : all;
  if (opts.project && projects.length === 0) {
    throw new Error(`Unknown project "${opts.project}" (configured: ${all.map((p) => p.name).join(', ')})`);
  }

  const jobs = [];
  for (const project of projects) {
    for (const type of project.types ?? []) {
      jobs.push({ project, type });
    }
  }

  const orchestrator = new NetworkOrchestrator({
    globalLimit: config?.concurrency?.global ?? opts.globalLimit ?? 4,
    perHostLimit: config?.concurrency?.perHost ?? opts.perHostLimit ?? 2,
    timeoutMs: config?.timeout_ms ?? opts.timeoutMs ?? 30000,
    maxRetries: config?.max_retries ?? opts.maxRetries ?? 2,
    cacheEnabled: config?.cache_enabled ?? opts.cacheEnabled ?? false, // default off for updates
  });

  const tasks = jobs.map((job) => {
    const host = job.project.wp_rest ? new URL(job.project.wp_rest).hostname : 'local';

    return {
      host,
      url: job.project.wp_rest ?? '',
      fn: async () => {
        const stageName = `${job.project.name}:${job.type}`;
        orchestrator.startStage(stageName);
        try {
          const results = [];
          if (job.type === 'composer') {
            const outdated = await adapter.composerOutdated(job.project, opts);
            const audit = await adapter.composerAudit(job.project, opts);
            results.push(...normalizeComposer(job.project.name, outdated, audit));
          } else if (job.type === 'npm') {
            const outdated = await adapter.npmOutdated(job.project, opts);
            const audit = await adapter.npmAudit(job.project, opts);
            results.push(...normalizeNpm(job.project.name, outdated, audit, { deep: opts.deep }));
          } else if (job.type === 'wp') {
            const plugins = await adapter.wpPluginList(job.project, opts);
            const vulns = await adapter.wpVulns(job.project, opts);
            results.push(...normalizeWp(job.project.name, plugins, vulns));
          } else {
            throw new Error(`Unknown project type "${job.type}"`);
          }
          return { success: true, results };
        } catch (err) {
          return { success: false, error: err.message ?? String(err) };
        } finally {
          orchestrator.endStage(stageName);
        }
      }
    };
  });

  const taskResults = await orchestrator.run(tasks);

  const rows = [];
  const errors = [];

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    const res = taskResults[i];
    if (res.success) {
      rows.push(...res.results);
    } else {
      errors.push({ project: job.project.name, type: job.type, message: res.error });
    }
  }

  const telemetry = orchestrator.getTelemetrySummary();

  return {
    rows,
    errors,
    projects: projects.map((p) => p.name),
    telemetry,
  };
}
