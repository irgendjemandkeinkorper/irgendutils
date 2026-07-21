// Secret detection rules: high-signal provider regexes + a generic
// Shannon-entropy catch. Each rule captures the secret in a group so the
// engine can mask it and fingerprint it (sha256) for allowlisting.

import { createHash } from 'node:crypto';
import { mask, maskedPreview } from './mask.js';

export const CONFIDENCE_RANK = { high: 3, medium: 2, low: 1 };
export const SEVERITY_RANK = { high: 3, medium: 2, low: 1, info: 0 };

export const RULES = [
  {
    name: 'aws',
    description: 'AWS access key ID',
    regex: /\b((?:AKIA|ASIA|AGPA|AROA)[0-9A-Z]{16})\b/g,
    confidence: 'high',
    severity: 'high',
    remediation: 'Rotate the key in AWS IAM now, then purge it from git history (git filter-repo). Deleting the file is not enough.',
  },
  {
    name: 'gcp',
    description: 'Google Cloud API key',
    regex: /\b(AIza[0-9A-Za-z_-]{35})\b/g,
    confidence: 'high',
    severity: 'high',
    remediation: 'Regenerate the key in Google Cloud Console, restrict it, then purge from history.',
  },
  {
    name: 'stripe',
    description: 'Stripe live secret key',
    regex: /\b((?:sk|rk)_live_[0-9a-zA-Z]{16,})\b/g,
    confidence: 'high',
    severity: 'high',
    remediation: 'Roll the key in the Stripe dashboard immediately, then purge from history.',
  },
  {
    name: 'github_pat',
    description: 'GitHub token',
    regex: /\b(gh[pousr]_[0-9A-Za-z]{36,255}|github_pat_[0-9A-Za-z_]{22,255})\b/g,
    confidence: 'high',
    severity: 'high',
    remediation: 'Revoke the token in GitHub settings, then purge from history.',
  },
  {
    name: 'private_key',
    description: 'Private key material',
    regex: /(-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----)/g,
    confidence: 'high',
    severity: 'high',
    preview: () => '-----BEGIN ... PRIVATE KEY----- [key material not shown]',
    remediation: 'Treat the key pair as compromised: generate a new pair, remove the old public key everywhere, purge from history.',
  },
  {
    name: 'db_url',
    description: 'Database URL with embedded password',
    regex: /\b((?:mysql|mariadb|postgres(?:ql)?|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s'"@:/]+:([^\s'"@]{3,})@[^\s'"]+)/g,
    secretGroup: 2,
    confidence: 'high',
    severity: 'high',
    remediation: 'Change the database password, move the URL into an env var, purge from history.',
  },
  {
    name: 'wp_salts',
    description: 'WordPress auth key/salt',
    regex: /define\(\s*['"]((?:AUTH|SECURE_AUTH|LOGGED_IN|NONCE)_(?:KEY|SALT))['"]\s*,\s*['"]([^'"]{16,})['"]\s*\)/g,
    secretGroup: 2,
    confidence: 'high',
    severity: 'medium',
    remediation: 'Regenerate salts (api.wordpress.org/secret-key/1.1/salt), which logs everyone out; purge from history.',
  },
  {
    name: 'generic_high_entropy',
    description: 'High-entropy value assigned to a secret-looking name',
    regex: /(?:secret|token|passw(?:or)?d|api[_-]?key|access[_-]?key|auth[_-]?key|credential)[A-Za-z0-9_-]*["']?\s*(?:[:=]|=>)\s*["']?([A-Za-z0-9+/=_-]{20,})/gi,
    minEntropy: 3.8,
    confidence: 'medium',
    severity: 'medium',
    remediation: 'Verify whether this is a real credential; if so rotate it and move it to an env var. If a test value, allowlist its sha256.',
  },
];

export function selectRules(names) {
  if (!names || names.length === 0) return RULES;
  const wanted = new Set(names);
  return RULES.filter((r) => wanted.has(r.name));
}

export function shannonEntropy(s) {
  if (!s) return 0;
  const freq = new Map();
  for (const c of s) freq.set(c, (freq.get(c) || 0) + 1);
  let e = 0;
  for (const n of freq.values()) {
    const p = n / s.length;
    e -= p * Math.log2(p);
  }
  return e;
}

export function fingerprint(secret) {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

// Allowlist file: one entry per line; "#" comments. A 64-hex line is a
// sha256 of the allowed value; any other line is the literal value and is
// hashed at load so the allowlist itself can be committed safely (hashed
// form) or kept local (literal form).
export function parseAllowlist(text) {
  const hashes = new Set();
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    hashes.add(/^[0-9a-f]{64}$/i.test(line) ? line.toLowerCase() : fingerprint(line));
  }
  return hashes;
}

const PLACEHOLDER_RE = /^(x+|\*+|\.+|your[_-]|changeme|example|placeholder|<.*>$)/i;

// Scan one blob of text line-by-line. Returns raw findings (unmerged).
export function scanText(content, { file, rules = RULES, allowlist = new Set(), location = 'worktree', commit = null, startLine = 1 } = {}) {
  const findings = [];
  const lines = String(content).split(/\r?\n/);
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    if (line.length > 2000) continue; // minified/one-line bundles: entropy noise
    for (const rule of rules) {
      rule.regex.lastIndex = 0;
      let m;
      while ((m = rule.regex.exec(line)) !== null) {
        const secret = m[rule.secretGroup ?? 1] ?? m[0];
        if (rule.minEntropy) {
          if (shannonEntropy(secret) < rule.minEntropy) continue;
          if (PLACEHOLDER_RE.test(secret)) continue;
        }
        const fp = fingerprint(secret);
        if (allowlist.has(fp)) continue;
        findings.push({
          part: 'scan',
          rule: rule.name,
          description: rule.description,
          severity: rule.severity,
          confidence: rule.confidence,
          file,
          line: startLine + li,
          masked: rule.preview ? rule.preview(m) : maskedPreview(m[0], secret),
          maskedSecret: mask(secret),
          location,
          commit,
          fingerprint: fp,
          remediation: rule.remediation,
        });
        if (m.index === rule.regex.lastIndex) rule.regex.lastIndex++;
      }
    }
  }
  return findings;
}
