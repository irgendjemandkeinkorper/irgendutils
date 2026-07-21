// Verification step: prove a generated vault is sound, not just that it was
// written. Runs the three acceptance checks — valid front-matter, zero dangling
// wikilinks, zero leaked secrets — and returns a structured pass/fail report.
import fs from 'node:fs';
import path from 'node:path';
import { parseFrontMatter } from './frontmatter.js';
import { checkLinks } from './linkcheck.js';
import { scanVault } from './secretscan.js';
import { walkFiles } from './util.js';
import { YAMLError } from './yaml.js';

const REQUIRED_KEYS = ['type', 'project', 'status', 'tags', 'created'];

/** Validate front-matter of every Markdown note in the vault. */
export function checkFrontMatter(vaultDir) {
  const problems = [];
  for (const rel of walkFiles(vaultDir, { ext: '.md' })) {
    // 99-Templates hold {{placeholder}} stubs, not filled notes — skip them.
    if (rel.startsWith('99-Templates' + path.sep) || rel.startsWith('99-Templates/')) continue;
    const text = fs.readFileSync(path.join(vaultDir, rel), 'utf8');
    let data;
    try {
      ({ data } = parseFrontMatter(text));
    } catch (err) {
      if (err instanceof YAMLError) {
        problems.push({ file: rel, issue: `unparseable front-matter: ${err.message}` });
        continue;
      }
      throw err;
    }
    if (data == null) {
      problems.push({ file: rel, issue: 'no front-matter block' });
      continue;
    }
    const missing = REQUIRED_KEYS.filter((k) => !(k in data));
    if (missing.length) problems.push({ file: rel, issue: `missing keys: ${missing.join(', ')}` });
  }
  return problems;
}

/** Run every check over a vault directory. */
export function verifyVault(vaultDir) {
  const frontmatter = checkFrontMatter(vaultDir);
  const dangling = checkLinks(vaultDir);
  const secrets = scanVault(vaultDir);
  return {
    ok: frontmatter.length === 0 && dangling.length === 0 && secrets.length === 0,
    frontmatter,
    dangling,
    secrets,
  };
}
