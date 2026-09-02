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
 * Pre-compiles regular expressions and normalizes entry pages for a configuration object.
 * Caches the compiled configuration on `config._compiled` to avoid repeated RegExp instantiation
 * and array normalization during page batch analysis loops.
 */
export function compileConfig(config) {
  if (config && config._compiled) return config._compiled;

  const defaultEntryPages = config?.defaults?.entry_pages ?? DEFAULTS.entry_pages;
  const defaultEntryPagesNormalized = defaultEntryPages.map(getRelativePath);

  const compiledRules = (config?.rules || []).map((rule) => {
    if (!rule || !rule.path) return null;
    let regex = null;
    try {
      regex = new RegExp(rule.path);
    } catch (e) {
      // Ignore invalid regex patterns
    }
    const entryPagesNormalized = rule.entry_pages
      ? (Array.isArray(rule.entry_pages) ? rule.entry_pages : [rule.entry_pages]).map(getRelativePath)
      : null;
    return {
      ...rule,
      regex,
      entryPagesNormalized,
    };
  }).filter(Boolean);

  const compiled = {
    defaults: {
      freshness_threshold_days: config?.defaults?.freshness_threshold_days ?? DEFAULTS.freshness_threshold_days,
      thin_content_threshold: config?.defaults?.thin_content_threshold ?? DEFAULTS.thin_content_threshold,
      entry_pages: defaultEntryPages,
      entry_pages_normalized: defaultEntryPagesNormalized,
    },
    rules: compiledRules,
  };

  if (config) config._compiled = compiled;
  return compiled;
}

/**
 * Resolves thresholds and flags for a given page URL/path based on the rules configuration.
 */
export function resolveRulesForPath(config, url) {
  const relPath = getRelativePath(url);
  const compiled = compileConfig(config);

  // Start with default thresholds
  const resolved = {
    exclude: false,
    freshness_threshold_days: compiled.defaults.freshness_threshold_days,
    thin_content_threshold: compiled.defaults.thin_content_threshold,
    entry_pages: compiled.defaults.entry_pages,
    entry_pages_normalized: compiled.defaults.entry_pages_normalized,
  };

  // Find any matching custom rules. Rules later in the list override earlier ones.
  for (const rule of compiled.rules) {
    if (rule.regex && rule.regex.test(relPath)) {
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
        resolved.entry_pages_normalized = rule.entryPagesNormalized;
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
