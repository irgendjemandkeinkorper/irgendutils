// Small shared helpers — no dependencies.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

export function todayISO(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

/**
 * Make a title safe for an Obsidian filename / wikilink.
 * `: / \ # [ ] | ^ ? * " < >` and control chars all break links or filesystems.
 */
export function sanitizeTitle(title) {
  const clean = String(title)
    .replace(/[\u0000-\u001f]/g, ' ')
    .replace(/[:/\\#[\]|^?*"<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '')
    .trim();
  return clean || 'Untitled';
}

export function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Strip userinfo (user:pass@) out of a URL so credentials never reach the vault. */
export function stripUrlCredentials(url) {
  return String(url).replace(/^([a-z][a-z0-9+.-]*:\/\/)[^@/\s]+@/i, '$1');
}

/** Fill {{key}} placeholders for known keys; unknown placeholders are left intact. */
export function render(template, data) {
  return String(template).replace(/\{\{(\w+)\}\}/g, (m, key) =>
    Object.prototype.hasOwnProperty.call(data, key) ? String(data[key]) : m
  );
}

/** Recursively list files under dir (relative paths), skipping dot-directories. */
export function walkFiles(dir, { ext = null } = {}) {
  const out = [];
  const walk = (rel) => {
    const abs = path.join(dir, rel);
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const childRel = rel ? path.join(rel, entry.name) : entry.name;
      if (entry.isDirectory()) walk(childRel);
      else if (!ext || entry.name.endsWith(ext)) out.push(childRel);
    }
  };
  if (fs.existsSync(dir)) walk('');
  return out.sort();
}

const useColor = () => process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (s) => (useColor() ? `\x1b[${code}m${s}\x1b[0m` : String(s));
export const color = {
  green: paint('32'),
  red: paint('31'),
  yellow: paint('33'),
  cyan: paint('36'),
  dim: paint('2'),
  bold: paint('1'),
};
