// Backup gate for `convert --apply`: the conversion rewrites bytes on disk,
// so it refuses to run unless a fresh, non-empty dump file exists.

import { statSync } from 'node:fs';

/**
 * @param {{ path?: string, maxAgeHours?: number, now?: number }} opts
 * @returns {{ ok: boolean, reason?: string, ageHours?: number, sizeBytes?: number }}
 */
export function checkBackup({ path, maxAgeHours = 24, now = Date.now() } = {}) {
  if (!path) {
    return {
      ok: false,
      reason:
        'no backup configured — set backup.path in config.yml or pass --backup <dump-file>. ' +
        'Refusing to convert without a verified backup.',
    };
  }
  let st;
  try {
    st = statSync(path);
  } catch {
    return { ok: false, reason: `backup file not found: ${path}. Take a fresh dump first.` };
  }
  if (!st.isFile() || st.size === 0) {
    return { ok: false, reason: `backup file is empty or not a file: ${path}` };
  }
  const ageHours = (now - st.mtimeMs) / 3_600_000;
  if (ageHours > maxAgeHours) {
    return {
      ok: false,
      reason:
        `backup is stale: ${path} is ${ageHours.toFixed(1)}h old (max ${maxAgeHours}h). ` +
        'Take a fresh dump first.',
      ageHours,
    };
  }
  return { ok: true, ageHours, sizeBytes: st.size };
}
