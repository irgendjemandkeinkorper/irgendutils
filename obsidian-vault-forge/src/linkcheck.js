// Wikilink integrity check: every [[Target]] in the vault must resolve to a
// note. Obsidian resolves links by basename (shortest path) or by full path,
// case-insensitively; we accept both.
import fs from 'node:fs';
import path from 'node:path';
import { walkFiles } from './util.js';

function stripCode(text) {
  return String(text)
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`\n]*`/g, '');
}

/** Returns [{ file, target }] for every dangling wikilink. */
export function checkLinks(vaultDir) {
  const files = walkFiles(vaultDir, { ext: '.md' });
  const names = new Set();
  for (const rel of files) {
    const noExt = rel.replace(/\.md$/, '');
    names.add(path.basename(noExt).toLowerCase());
    names.add(noExt.split(path.sep).join('/').toLowerCase());
  }
  const dangling = [];
  for (const rel of files) {
    const text = stripCode(fs.readFileSync(path.join(vaultDir, rel), 'utf8'));
    for (const m of text.matchAll(/!?\[\[([^[\]\n]+)\]\]/g)) {
      let target = m[1].split('|')[0].split('#')[0].trim();
      if (target === '') continue; // [[#heading]] self-link
      target = target.replace(/\.md$/i, '');
      if (!names.has(target.toLowerCase())) dangling.push({ file: rel, target });
    }
  }
  return dangling;
}
