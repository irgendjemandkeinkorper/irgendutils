import fs from 'node:fs';
import { parseYaml } from './yaml.js';

export const DEFAULTS = {
  freshness_threshold_days: 365,
  thin_content_threshold: 300,
  entry_pages: ['/', '/index.html', '/home'],
};

/**
 * Normalizes a URL into a relative path starting with '/'.
 * E.g., 'https://example.com/blog/hello-world' -> '/blog/hello-world'
 * E.g., '/about-us' -> '/about-us'
 * E.g., '' or '/' -> '/'
 */
export function getRelativePath(url) {
  if (!url) return '/';
  if (typeof url !== 'string') url = String(url);

  let path = url;
  if (!path.startsWith('/')) {
    const schemeIndex = path.indexOf('://');
    if (schemeIndex !== -1) {
      const pathIndex = path.indexOf('/', schemeIndex + 3);
      if (pathIndex !== -1) {
        path = path.slice(pathIndex);
      } else {
        path = '/';
      }
    } else {
      try {
        const parsed = new URL(path, 'https://example.local');
        path = parsed.pathname + parsed.search;
        return path;
      } catch (e) {
        path = path.replace(/^(https?:\/\/[^/]+)/i, '');
        if (!path.startsWith('/')) path = '/' + path;
      }
    }
  }

  // Strip hash fragment if present (matching new URL behavior with pathname + search)
  const hashIndex = path.indexOf('#');
  if (hashIndex !== -1) {
    path = path.slice(0, hashIndex);
  }
  return path || '/';
}

/**
 * Resolves thresholds and flags for a given page URL/path based on the rules configuration.
 */
export function resolveRulesForPath(config, url) {
  const relPath = getRelativePath(url);

  // Start with default thresholds
  const resolved = {
    exclude: false,
    freshness_threshold_days: config.defaults?.freshness_threshold_days ?? DEFAULTS.freshness_threshold_days,
    thin_content_threshold: config.defaults?.thin_content_threshold ?? DEFAULTS.thin_content_threshold,
    entry_pages: config.defaults?.entry_pages ?? DEFAULTS.entry_pages,
  };

  if (!config.rules || !Array.isArray(config.rules)) {
    return resolved;
  }

  // Find any matching custom rules. Rules later in the list override earlier ones.
  for (const rule of config.rules) {
    if (!rule || !rule.path) continue;
    // Cache compiled RegExp instance on the rule object to avoid repeated instantiations
    if (!rule._regex) {
      try {
        rule._regex = new RegExp(rule.path);
      } catch (err) {
        rule._regex = null;
      }
    }
    if (rule._regex && rule._regex.test(relPath)) {
      if (rule.exclude !== undefined) {
        resolved.exclude = !!rule.exclude;
      }
      if (rule.freshness_threshold_days !== undefined) {
        resolved.freshness_threshold_days = Number(rule.freshness_threshold_days);
      }
      if (rule.thin_content_threshold !== undefined) {
        resolved.thin_content_threshold = Number(rule.thin_content_threshold);
      }
      if (rule.entry_pages !== undefined) {
        resolved.entry_pages = Array.isArray(rule.entry_pages) ? rule.entry_pages : [rule.entry_pages];
      }
    }
  }

  return resolved;
}

/**
 * Loads a configuration YAML file and returns normalized config.
 */
export function loadConfig(filePath) {
  if (!filePath) {
    return { defaults: DEFAULTS, rules: [] };
  }

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const parsed = parseYaml(content);

    const config = {
      defaults: {
        freshness_threshold_days: parsed.defaults?.freshness_threshold_days !== undefined
          ? Number(parsed.defaults.freshness_threshold_days)
          : DEFAULTS.freshness_threshold_days,
        thin_content_threshold: parsed.defaults?.thin_content_threshold !== undefined
          ? Number(parsed.defaults.thin_content_threshold)
          : DEFAULTS.thin_content_threshold,
        entry_pages: Array.isArray(parsed.defaults?.entry_pages)
          ? parsed.defaults.entry_pages.map(String)
          : DEFAULTS.entry_pages,
      },
      rules: Array.isArray(parsed.rules) ? parsed.rules : [],
    };

    return config;
  } catch (err) {
    throw new Error(`Failed to load config from "${filePath}": ${err.message}`);
  }
}
