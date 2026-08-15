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
  try {
    const parsed = new URL(url, 'https://example.local');
    let path = parsed.pathname;
    if (parsed.search) {
      path += parsed.search;
    }
    return path;
  } catch (e) {
    // If not a valid absolute/relative URL, strip domain or leading parts manually
    let path = String(url).replace(/^(https?:\/\/[^/]+)/i, '');
    if (!path.startsWith('/')) {
      path = '/' + path;
    }
    return path;
  }
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
    try {
      const regex = new RegExp(rule.path);
      if (regex.test(relPath)) {
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
    } catch (err) {
      // Ignore invalid regex patterns or log internally
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
