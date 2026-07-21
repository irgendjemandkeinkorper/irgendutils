// Fixture adapter: serves captured JSON from <dir>/<project-name>/*.json.
// Used by tests and by `depdigest run --fixtures <dir>` for offline dry runs.
// A missing file simply means "nothing outdated / no advisories" — same shape
// an up-to-date live project would produce.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export class FixtureAdapter {
  constructor(dir) {
    this.dir = dir;
  }

  read(project, file, fallback) {
    try {
      return JSON.parse(readFileSync(join(this.dir, project.name, file), 'utf8'));
    } catch (err) {
      if (err.code === 'ENOENT') return fallback;
      throw new Error(`Bad fixture ${project.name}/${file}: ${err.message}`);
    }
  }

  async composerOutdated(project) {
    return this.read(project, 'composer-outdated.json', { installed: [] });
  }

  async composerAudit(project) {
    return this.read(project, 'composer-audit.json', { advisories: {} });
  }

  async npmOutdated(project) {
    return this.read(project, 'npm-outdated.json', {});
  }

  async npmAudit(project) {
    return this.read(project, 'npm-audit.json', { vulnerabilities: {} });
  }

  async wpPluginList(project) {
    return this.read(project, 'wp-plugins.json', []);
  }

  async wpVulns(project) {
    return this.read(project, 'wp-vulns.json', []);
  }
}
