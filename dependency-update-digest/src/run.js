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

  const rows = [];
  const errors = [];
  for (const project of projects) {
    for (const type of project.types ?? []) {
      try {
        if (type === 'composer') {
          const outdated = await adapter.composerOutdated(project, opts);
          const audit = await adapter.composerAudit(project, opts);
          rows.push(...normalizeComposer(project.name, outdated, audit));
        } else if (type === 'npm') {
          const outdated = await adapter.npmOutdated(project, opts);
          const audit = await adapter.npmAudit(project, opts);
          rows.push(...normalizeNpm(project.name, outdated, audit, { deep: opts.deep }));
        } else if (type === 'wp') {
          const plugins = await adapter.wpPluginList(project, opts);
          const vulns = await adapter.wpVulns(project, opts);
          rows.push(...normalizeWp(project.name, plugins, vulns));
        } else {
          errors.push({ project: project.name, type, message: `Unknown project type "${type}"` });
        }
      } catch (err) {
        // Detect and degrade: one failing tool must not sink the whole digest.
        errors.push({ project: project.name, type, message: err.message });
      }
    }
  }
  return { rows, errors, projects: projects.map((p) => p.name) };
}
