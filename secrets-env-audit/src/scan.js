// Part A — secret scan: walk roots (respecting ignore) and optionally the
// git history (via an injected git adapter, so tests never need real repos).

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, basename, resolve } from 'node:path';
import { homedir } from 'node:os';
import { scanText, parseAllowlist, selectRules, CONFIDENCE_RANK, SEVERITY_RANK } from './rules.js';

const MAX_FILE_SIZE = 2 * 1024 * 1024;
const DEFAULT_IGNORE = ['.git', 'node_modules', 'report'];

export function expandPath(p, baseDir = process.cwd()) {
  if (!p) return p;
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  return resolve(baseDir, p);
}

function globToRegex(glob) {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]');
  return new RegExp(`^${esc}$`);
}

export function makeIgnoreMatcher(patterns = []) {
  const all = [...new Set([...DEFAULT_IGNORE, ...patterns])];
  const segmentNames = new Set();
  const pathPrefixes = [];
  const globs = [];
  for (const p of all) {
    if (p.includes('*') || p.includes('?')) globs.push(globToRegex(p));
    else if (p.includes('/')) pathPrefixes.push(p.replace(/\/+$/, ''));
    else segmentNames.add(p);
  }
  return function ignored(relPath) {
    const segments = relPath.split('/');
    if (segments.some((s) => segmentNames.has(s))) return true;
    if (pathPrefixes.some((pre) => relPath === pre || relPath.startsWith(pre + '/'))) return true;
    const base = basename(relPath);
    return globs.some((re) => re.test(base) || re.test(relPath));
  };
}

export function listFiles(root, ignored) {
  const out = [];
  (function walk(dir) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      const rel = relative(root, full).split('\\').join('/');
      if (ignored(rel)) continue;
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) out.push({ full, rel });
    }
  })(root);
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

function isBinary(buf) {
  const len = Math.min(buf.length, 8000);
  for (let i = 0; i < len; i++) if (buf[i] === 0) return true;
  return false;
}

export function scanWorktree(root, { rules, allowlist, ignore = [] } = {}) {
  const ignored = makeIgnoreMatcher(ignore);
  const findings = [];
  for (const { full, rel } of listFiles(root, ignored)) {
    if (basename(rel).endsWith('.example')) continue; // placeholder key lists, by design
    let buf;
    try {
      buf = readFileSync(full);
    } catch {
      continue;
    }
    if (buf.length > MAX_FILE_SIZE || isBinary(buf)) continue;
    findings.push(...scanText(buf.toString('utf8'), { file: rel, rules, allowlist, location: 'worktree' }));
  }
  return findings;
}

// Parse `git log -p` output: scan only ADDED lines, tracking the commit,
// file, and new-file line number from hunk headers.
export function scanHistoryLog(logText, { rules, allowlist, ignore = [] } = {}) {
  const ignored = makeIgnoreMatcher(ignore);
  const findings = [];
  let commit = null;
  let file = null;
  let newLine = 0;
  for (const line of String(logText).split(/\r?\n/)) {
    let m;
    if ((m = line.match(/^commit ([0-9a-f]{7,40})/))) {
      commit = m[1].slice(0, 8);
      file = null;
    } else if ((m = line.match(/^\+\+\+ b\/(.+)$/))) {
      file = m[1];
      if (ignored(file)) file = null;
    } else if (line.startsWith('+++')) {
      file = null; // e.g. "+++ /dev/null"
    } else if ((m = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/))) {
      newLine = parseInt(m[1], 10);
    } else if (file && line.startsWith('+')) {
      findings.push(...scanText(line.slice(1), { file, rules, allowlist, location: 'history', commit, startLine: newLine }));
      newLine++;
    } else if (file && line.startsWith(' ')) {
      newLine++;
    }
  }
  return findings;
}

// Merge worktree + history findings for the same secret in the same file:
// location becomes "both".
export function mergeFindings(findings) {
  const byKey = new Map();
  for (const f of findings) {
    const key = `${f.file}|${f.rule}|${f.fingerprint}`;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, { ...f });
    } else {
      if (prev.location !== f.location) prev.location = 'both';
      if (f.location === 'worktree') {
        prev.line = f.line; // prefer the live line number
      } else if (f.commit && !prev.commit) {
        prev.commit = f.commit;
      }
    }
  }
  return [...byKey.values()].sort(
    (a, b) =>
      (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0) ||
      (CONFIDENCE_RANK[b.confidence] ?? 0) - (CONFIDENCE_RANK[a.confidence] ?? 0) ||
      String(a.file).localeCompare(String(b.file))
  );
}

export function loadAllowlist(path) {
  if (!path || !existsSync(path)) return new Set();
  return parseAllowlist(readFileSync(path, 'utf8'));
}

// Full Part A run. `gitAdapter` is injected: { isRepo(root), logPatches(root) }.
export function runScan(config, { gitAdapter = null, baseDir = process.cwd() } = {}) {
  const scan = config.scan ?? {};
  const rules = selectRules(config.rules);
  const roots = (scan.roots ?? ['.']).map((r) => expandPath(r, baseDir));
  const ignore = scan.ignore ?? [];
  const allowlist = loadAllowlist(scan.allowlist_file ? expandPath(scan.allowlist_file, baseDir) : null);
  const findings = [];
  const warnings = [];
  for (const root of roots) {
    if (!existsSync(root) || !statSync(root).isDirectory()) {
      warnings.push(`scan root not found: ${root}`);
      continue;
    }
    findings.push(...scanWorktree(root, { rules, allowlist, ignore }));
    if (scan.include_git_history && gitAdapter) {
      if (gitAdapter.isRepo(root)) {
        try {
          findings.push(...scanHistoryLog(gitAdapter.logPatches(root), { rules, allowlist, ignore }));
        } catch (err) {
          warnings.push(`git history scan failed for ${root}: ${err.message}`);
        }
      } else {
        warnings.push(`not a git repo, history skipped: ${root}`);
      }
    }
  }
  return { findings: mergeFindings(findings), warnings };
}
