// WordPress-specific check: wp_options autoload bloat. Every autoloaded option
// is loaded on EVERY request — a multi-MB total slows the whole site without
// ever appearing in the slow query log.

export const DEFAULT_AUTOLOAD_WARN_BYTES = 800 * 1024;

export function formatBytes(n) {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

/**
 * Evaluate autoload stats ({ totalBytes, count, top: [{name, bytes}] } or null).
 * Returns { checked, bloated, totalBytes, count, top, message }.
 */
export function evaluateAutoload(stats, { warnBytes = DEFAULT_AUTOLOAD_WARN_BYTES } = {}) {
  if (!stats || typeof stats.totalBytes !== 'number') {
    return { checked: false, bloated: false, message: 'wp_options not found or no DB connection — autoload check skipped.' };
  }
  const bloated = stats.totalBytes >= warnBytes;
  return {
    checked: true,
    bloated,
    totalBytes: stats.totalBytes,
    count: stats.count ?? null,
    top: (stats.top ?? []).slice(0, 10),
    message: bloated
      ? `Autoloaded options total ${formatBytes(stats.totalBytes)} across ${stats.count} rows (threshold ${formatBytes(warnBytes)}). This payload loads on every request — review the largest options below (stale transients and widget blobs are common culprits).`
      : `Autoloaded options total ${formatBytes(stats.totalBytes)} — under the ${formatBytes(warnBytes)} threshold.`,
  };
}
