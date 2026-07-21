// Pure subdomain validation — no I/O, trivially testable.

const DEFAULT_RESERVED = ['www', 'mail', 'ftp', 'smtp', 'ns1', 'ns2', 'admin', 'api'];

/**
 * Validate a subdomain label per DNS rules + house rules.
 * @param {string} sub
 * @param {{reserved?: string[]}} [opts] extra reserved labels (e.g. the template slug)
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateSubdomain(sub, opts = {}) {
  const errors = [];
  const reserved = new Set([...DEFAULT_RESERVED, ...(opts.reserved || [])].filter(Boolean));

  if (typeof sub !== 'string' || sub.length === 0) {
    return { ok: false, errors: ['subdomain is required'] };
  }
  if (sub !== sub.toLowerCase()) {
    errors.push('must be lowercase');
  }
  const lower = sub.toLowerCase();
  if (lower.length > 63) {
    errors.push('must be at most 63 characters');
  }
  if (!/^[a-z0-9-]+$/.test(lower)) {
    errors.push('may only contain a-z, 0-9 and hyphens (no dots, spaces or underscores)');
  } else {
    if (lower.startsWith('-') || lower.endsWith('-')) {
      errors.push('must not start or end with a hyphen');
    }
    if (/^\d+$/.test(lower)) {
      errors.push('must not be all-numeric');
    }
  }
  if (reserved.has(lower)) {
    errors.push(`"${lower}" is a reserved name`);
  }
  return { ok: errors.length === 0, errors };
}

/** Host part of a URL, e.g. "https://example.com/x" -> "example.com". */
export function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return String(url).replace(/^[a-z+]+:\/\//i, '').split('/')[0];
  }
}

/** Fully-qualified domain name for a subdomain. */
export function fqdnFor(config, sub) {
  const zone = (config.dns && config.dns.zone) || hostOf(config.network_url);
  return `${sub}.${zone}`;
}

/** Site URL for a subdomain, from the rest.base_url template. */
export function urlFor(config, sub) {
  return config.rest.base_url.replaceAll('{sub}', sub);
}
