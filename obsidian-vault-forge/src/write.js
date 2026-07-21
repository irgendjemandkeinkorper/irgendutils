// Apply a plan to disk, idempotently and without ever clobbering human edits.
//
// Rule per file:
//   - target missing            -> create
//   - target byte-identical      -> skip (unchanged)
//   - target differs, overwrite  -> overwrite (machine-owned files only)
//   - target differs, --update   -> write sibling "<name>.new.<ext>", keep human copy
//   - target differs, no --update-> leave untouched, warn
// This guarantees the acceptance criterion: --update leaves every human-edited
// note byte-identical.
import fs from 'node:fs';
import path from 'node:path';

function newSibling(rel) {
  const ext = path.extname(rel);
  return `${rel.slice(0, rel.length - ext.length)}.new${ext}`;
}

/**
 * @returns {{path, action}[]} where action is one of
 *   create | unchanged | overwrite | new-sibling | keep | dir
 */
export function applyPlan(vaultRoot, plan, { update = false, dryRun = false } = {}) {
  const actions = [];
  const ensureDir = (abs) => {
    if (!dryRun) fs.mkdirSync(abs, { recursive: true });
  };

  ensureDir(vaultRoot);
  for (const dir of plan.dirs || []) {
    ensureDir(path.join(vaultRoot, dir));
    actions.push({ path: dir + '/', action: 'dir' });
  }

  for (const f of plan.files) {
    const abs = path.join(vaultRoot, f.path);
    const exists = fs.existsSync(abs);

    if (!exists) {
      write(abs, f.content, dryRun, ensureDir);
      actions.push({ path: f.path, action: 'create' });
      continue;
    }

    const current = fs.readFileSync(abs, 'utf8');
    if (current === f.content) {
      actions.push({ path: f.path, action: 'unchanged' });
    } else if (f.overwrite) {
      write(abs, f.content, dryRun, ensureDir);
      actions.push({ path: f.path, action: 'overwrite' });
    } else if (update) {
      const rel = newSibling(f.path);
      write(path.join(vaultRoot, rel), f.content, dryRun, ensureDir);
      actions.push({ path: rel, action: 'new-sibling' });
    } else {
      actions.push({ path: f.path, action: 'keep' });
    }
  }

  return actions;
}

function write(abs, content, dryRun, ensureDir) {
  if (dryRun) return;
  ensureDir(path.dirname(abs));
  fs.writeFileSync(abs, content);
}
