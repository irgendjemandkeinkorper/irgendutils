import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

export const DEFAULT_CONFIG = {
  start_urls: [],
  allow_domains: [],
  max_pages: 50,
  max_depth: 3,
  rate_limit_ms: 800,
  concurrency: 1,
  content_selector: 'main, article, .entry-content',
  strip_selectors: ['nav', 'footer', '.sidebar', '.ads', '.cookie-banner', '.cookie'],
  output: './out',
  formats: ['html', 'markdown', 'json'],
  query_denylist: []
};

/**
 * Loads a configuration file (YAML or JSON) and merges it with default options and CLI overrides.
 * @param {string} [configPath] - Path to the config file.
 * @param {Object} [cliOverrides] - Options passed from the CLI.
 * @returns {Object} Complete configuration object.
 */
export function loadConfig(configPath, cliOverrides = {}) {
  let loadedConfig = {};

  if (configPath && fs.existsSync(configPath)) {
    try {
      const content = fs.readFileSync(configPath, 'utf8');
      if (configPath.endsWith('.json')) {
        loadedConfig = JSON.parse(content);
      } else {
        loadedConfig = yaml.load(content) || {};
      }
    } catch (err) {
      console.warn(`Warning: Could not parse config file ${configPath}: ${err.message}. Using defaults.`);
    }
  }

  // Merge: Default <- File Config <- CLI overrides
  const merged = {
    ...DEFAULT_CONFIG,
    ...loadedConfig,
    ...cliOverrides
  };

  // Ensure formats are always an array
  if (typeof merged.formats === 'string') {
    merged.formats = merged.formats.split(',').map(s => s.trim());
  }

  // If start_urls is a string, make it an array
  if (typeof merged.start_urls === 'string') {
    merged.start_urls = [merged.start_urls];
  }

  // Normalize allow_domains. If empty, derive from start_urls hostnames
  if (!merged.allow_domains || merged.allow_domains.length === 0) {
    const domains = new Set();
    for (const urlStr of merged.start_urls || []) {
      try {
        const urlObj = new URL(urlStr);
        domains.add(urlObj.hostname);
      } catch {
        // ignore invalid URL at this stage
      }
    }
    merged.allow_domains = Array.from(domains);
  }

  return merged;
}
