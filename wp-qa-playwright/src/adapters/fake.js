// Fake page-capture adapter: serves captured-page fixtures (DOM snapshots,
// link statuses, console logs, viewport metrics, screenshot specs) as plain
// data. Used by all tests so `npm test` runs offline with nothing installed.
import fs from 'node:fs';
import path from 'node:path';

/**
 * fixture: path to a capture.json, or the parsed object. Shape:
 * {
 *   pages: { "<url>": { html | htmlFile, console: [], failedRequests: [],
 *                       viewports: { "360": {...metrics} },
 *                       screenshots: { "360": {width,height,base,rects:[]} },
 *                       maskRects: { "360": [{x,y,w,h}] } } },
 *   statuses: { "<url>": { status, redirectChain: [], error? } },
 *   wp: { "<url>": { restAvailable, theme, plugins, ... } }
 * }
 * Screenshot specs are rendered to real RGBA buffers deterministically, so
 * repeated captures are pixel-identical (proves diff determinism).
 */
export function createFakeAdapter(fixture) {
  let data = fixture;
  let baseDir = process.cwd();
  if (typeof fixture === 'string') {
    baseDir = path.dirname(path.resolve(fixture));
    data = JSON.parse(fs.readFileSync(fixture, 'utf8'));
  }

  const pages = keyByUrl(data.pages);
  const statuses = keyByUrl(data.statuses);
  const wp = keyByUrl(data.wp);

  return {
    name: 'fake',

    async capturePage(url, { viewports = [] } = {}) {
      const page = pages[normalizeUrl(url)];
      if (!page) throw new Error(`fake adapter: no fixture page for ${url}`);
      let html = page.html ?? '';
      if (page.htmlFile) {
        html = fs.readFileSync(path.resolve(baseDir, page.htmlFile), 'utf8');
      }
      const screenshots = {};
      const metrics = {};
      for (const vp of viewports) {
        const key = String(vp);
        const spec = page.screenshots?.[key];
        if (spec) screenshots[key] = renderScreenshotSpec(spec);
        if (page.viewports?.[key]) metrics[key] = page.viewports[key];
      }
      return {
        url,
        finalUrl: page.finalUrl || normalizeUrl(url),
        html,
        console: page.console || [],
        failedRequests: page.failedRequests || [],
        viewports: metrics,
        screenshots,
        maskRects: page.maskRects || {},
      };
    },

    async fetchStatus(url) {
      return statuses[normalizeUrl(url)] || { status: 0, error: 'unreachable (no fixture entry)', redirectChain: [] };
    },

    async fetchWpInfo(url) {
      return wp[normalizeUrl(url)] || { restAvailable: false, note: 'no WP fixture info for this URL' };
    },

    // Auth verification for the connectivity preflight. Reads an optional
    // fixture `auth` map, else derives from whether WP REST info is available.
    async verifyAuth(url) {
      const key = normalizeUrl(url);
      const auth = keyByUrl(data.auth)[key];
      if (auth) return auth;
      const info = wp[key];
      if (info && info.restAvailable) return { ok: true, status: 200 };
      return { ok: false, status: 0, error: 'no auth fixture for this URL' };
    },

    async close() {},
  };
}

export function normalizeUrl(url) {
  try {
    return new URL(url).href;
  } catch {
    return String(url);
  }
}

function keyByUrl(obj = {}) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) out[normalizeUrl(k)] = v;
  return out;
}

/** Render {width, height, base: "#rrggbb", rects: [{x,y,w,h,color}]} to RGBA. */
export function renderScreenshotSpec(spec) {
  const { width, height } = spec;
  const data = Buffer.alloc(width * height * 4);
  const [br, bg, bb] = parseColor(spec.base || '#ffffff');
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = br;
    data[i * 4 + 1] = bg;
    data[i * 4 + 2] = bb;
    data[i * 4 + 3] = 255;
  }
  for (const rect of spec.rects || []) {
    const [r, g, b] = parseColor(rect.color || '#000000');
    const x1 = Math.min(width, rect.x + rect.w);
    const y1 = Math.min(height, rect.y + rect.h);
    for (let y = Math.max(0, rect.y); y < y1; y++) {
      for (let x = Math.max(0, rect.x); x < x1; x++) {
        const i = (y * width + x) * 4;
        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
        data[i + 3] = 255;
      }
    }
  }
  return { width, height, data };
}

function parseColor(hex) {
  const m = String(hex).match(/^#?([0-9a-f]{6})$/i);
  if (!m) throw new Error(`fake adapter: bad color "${hex}"`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}
