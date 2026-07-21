// Scan text/files for anything that looks like a real secret. The forge must
// never write secret values — the Credentials note holds pointers only.
import fs from 'node:fs';
import path from 'node:path';
import { walkFiles } from './util.js';

const PLACEHOLDER = /^(x+|\*+|<[^>]*>|\{\{[^}]*\}\}|todo|tbd|changeme|change-me|redacted|placeholder|example|your[-_][a-z-_]+|\.{3,})$/i;

const PATTERNS = [
  {
    name: 'credential assignment',
    re: /\b(password|passwd|pwd|secret|token|api[-_]?key|apikey|auth[-_]?key|client[-_]?secret|access[-_]?key|private[-_]?key)\b\s*[:=]\s*["']?([^\s"',;]{6,})/gi,
    value: (m) => m[2],
  },
  { name: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'GitHub token', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g },
  { name: 'GitHub fine-grained PAT', re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
  { name: 'sk- style API key', re: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { name: 'Slack token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: 'private key block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { name: 'URL with embedded credentials', re: /[a-z][a-z0-9+.-]*:\/\/[^/\s:@"'`]+:[^@/\s"'`]+@/gi },
  { name: 'JWT', re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\b/g },
];

function redact(s) {
  const t = String(s);
  return t.length <= 8 ? `${t.slice(0, 2)}...` : `${t.slice(0, 4)}...${t.slice(-2)}`;
}

/** Returns findings: [{ file, pattern, match }] (match is redacted). */
export function scanText(text, file = '(inline)') {
  const findings = [];
  for (const p of PATTERNS) {
    p.re.lastIndex = 0;
    let m;
    while ((m = p.re.exec(text)) !== null) {
      const value = p.value ? p.value(m) : m[0];
      if (p.value && PLACEHOLDER.test(value)) continue;
      findings.push({ file, pattern: p.name, match: redact(value) });
    }
  }
  return findings;
}

/** Scan every generated file in a plan before it is written. */
export function scanPlan(plan) {
  return plan.files.flatMap((f) => scanText(f.content, f.path));
}

/** Scan every Markdown file in a vault directory. */
export function scanVault(vaultDir) {
  return walkFiles(vaultDir, { ext: '.md' }).flatMap((rel) =>
    scanText(fs.readFileSync(path.join(vaultDir, rel), 'utf8'), rel)
  );
}
