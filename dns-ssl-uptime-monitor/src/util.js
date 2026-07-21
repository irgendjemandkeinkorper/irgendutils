export const DAY_MS = 86_400_000;

const STATUS_RANK = { green: 0, amber: 1, red: 2 };

export function worstStatus(statuses, fallback = 'green') {
  let worst = fallback;
  for (const s of statuses) {
    if ((STATUS_RANK[s] ?? 0) > (STATUS_RANK[worst] ?? 0)) worst = s;
  }
  return worst;
}

export function toUrl(target) {
  return /^https?:\/\//i.test(target) ? target : `https://${target}`;
}

export function hostOf(target) {
  try {
    return new URL(toUrl(target)).hostname;
  } catch {
    return String(target).trim().replace(/\/.*$/, '');
  }
}

// Naive registered-domain guess (last two labels). No public-suffix list is bundled;
// override via domain_expiry.domains for co.uk-style TLDs.
export function registeredDomain(host) {
  const parts = String(host).split('.').filter(Boolean);
  return parts.length <= 2 ? parts.join('.') : parts.slice(-2).join('.');
}

export function daysUntil(dateish, now) {
  const t = typeof dateish === 'number' ? dateish : Date.parse(dateish);
  if (!Number.isFinite(t)) return null;
  return Math.ceil((t - now) / DAY_MS);
}

// Certificate-style name match: exact, or single-label wildcard "*.example.com".
export function nameMatches(pattern, host) {
  pattern = String(pattern).toLowerCase().replace(/^dns:/, '');
  host = String(host).toLowerCase();
  if (pattern === host) return true;
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(1); // ".example.com"
    if (!host.endsWith(suffix)) return false;
    const label = host.slice(0, -suffix.length);
    return label.length > 0 && !label.includes('.');
  }
  return false;
}

export function issue(severity, kind, message, extra = {}) {
  return { severity, kind, message, ...extra };
}

const useColor =
  process.stdout.isTTY && !process.env.NO_COLOR && process.env.TERM !== 'dumb';

const CODES = { red: 31, green: 32, amber: 33, yellow: 33, dim: 2, bold: 1 };

export function paint(name, text) {
  const code = CODES[name];
  return useColor && code ? `[${code}m${text}[0m` : String(text);
}

export function statusBadge(status) {
  const label = { green: 'GREEN', amber: 'AMBER', red: 'RED' }[status] ?? String(status).toUpperCase();
  return paint(status === 'red' ? 'red' : status === 'amber' ? 'amber' : 'green', label);
}

export function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
