// Fixture adapter: serves captured page-data from a fixture directory so the
// whole audit runs offline and deterministically. Directory layout:
//
//   <dir>/site.json      { baseUrl, environment?, pages: {path: {file|body, status, headers}},
//                          resources: {pathOrUrl: {file|body, status, headers}}, perf: {mobile: [...], desktop: [...]} }
//   <dir>/pages/*.html   referenced via "file"
//   <dir>/robots.txt ... any other referenced files

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function body(dir, entry) {
  if (entry.body != null) return entry.body;
  if (entry.file) return readFileSync(join(dir, entry.file), 'utf8');
  return '';
}

export async function createFixtureAdapter(dir) {
  const site = JSON.parse(readFileSync(join(dir, 'site.json'), 'utf8'));
  const baseUrl = site.baseUrl;

  return {
    baseUrl,
    environment: site.environment ?? null,

    async pages() {
      return Object.entries(site.pages ?? {}).map(([path, entry]) => ({
        url: new URL(path, baseUrl).href,
        path,
        status: entry.status ?? 200,
        headers: entry.headers ?? {},
        html: body(dir, entry),
      }));
    },

    async resource(pathOrUrl) {
      const resources = site.resources ?? {};
      const keys = [pathOrUrl];
      // Allow lookups by absolute URL for same-host paths and vice versa.
      if (!/^https?:\/\//i.test(pathOrUrl)) {
        keys.push(new URL(pathOrUrl, baseUrl).href);
      } else {
        try {
          const u = new URL(pathOrUrl);
          if (u.host === new URL(baseUrl).host) keys.push(u.pathname);
        } catch { /* ignore */ }
      }
      for (const k of keys) {
        const entry = resources[k];
        if (entry) {
          return { status: entry.status ?? 200, headers: entry.headers ?? {}, body: body(dir, entry) };
        }
        const page = (site.pages ?? {})[k];
        if (page) {
          return { status: page.status ?? 200, headers: page.headers ?? {}, body: body(dir, page) };
        }
      }
      return { status: 404, headers: {}, body: '' };
    },

    async perfRuns(formFactor, n) {
      const runs = site.perf?.[formFactor];
      if (!Array.isArray(runs) || runs.length === 0) return null;
      return runs.slice(0, n);
    },
  };
}
