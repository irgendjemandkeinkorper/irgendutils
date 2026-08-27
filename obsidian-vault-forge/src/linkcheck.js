// Wikilink integrity check: every [[Target]] in the vault must resolve to a
// note. Obsidian resolves links by basename (shortest path) or by full path,
// case-insensitively; we accept both.
import fs from 'node:fs';
import path from 'node:path';
import { walkFiles } from './util.js';

// Pre-compiled regular expressions at module scope to prevent re-compilation
// and garbage collection overhead during hot link checking loops across vault files.
const WIKILINK_RE = /!?\[\[([^[\]\n]+)\]\]/g;
const CODE_BLOCK_RE = /```[\s\S]*?```/g;
const INLINE_CODE_RE = /`[^`\n]*`/g;

function stripCode(text) {
  // Fast path: skip expensive code block stripping if there are no backticks.
  if (!text.includes('`')) return text;
  return text
    .replace(CODE_BLOCK_RE, '')
    .replace(INLINE_CODE_RE, '');
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
    const rawText = fs.readFileSync(path.join(vaultDir, rel), 'utf8');
    // Fast path: skip parsing files that contain no wikilinks at all.
    if (!rawText.includes('[[')) continue;

    const text = stripCode(rawText);
    WIKILINK_RE.lastIndex = 0;
    let m;
    while ((m = WIKILINK_RE.exec(text)) !== null) {
      let target = m[1];
      // Fast target extraction using indexOf/slice to avoid split array allocations
      const pipeIdx = target.indexOf('|');
      if (pipeIdx !== -1) target = target.slice(0, pipeIdx);
      const hashIdx = target.indexOf('#');
      if (hashIdx !== -1) target = target.slice(0, hashIdx);

      target = target.trim();
      if (target === '') continue; // [[#heading]] self-link

      if (target.endsWith('.md') || target.endsWith('.MD')) {
        target = target.slice(0, -3);
      } else if (target.toLowerCase().endsWith('.md')) {
        target = target.slice(0, -3);
      }

      if (!names.has(target.toLowerCase())) dangling.push({ file: rel, target });
    }
  }
  return dangling;
}
