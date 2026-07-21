// Tiny semver helper — just enough to classify a version jump as
// major / minor / patch. Tolerates loose versions ("v1.2", "6.4", "1.2.3-beta.1",
// composer-style "1.2.3.4"): missing parts are treated as 0, prerelease/build
// suffixes are ignored for jump classification.

export function parseVersion(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().replace(/^v/i, '');
  const m = s.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[.\-+].*)?$/);
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2] ?? 0),
    patch: Number(m[3] ?? 0),
  };
}

// -1 if a < b, 0 if equal, 1 if a > b (on major.minor.patch only).
export function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return null;
  for (const k of ['major', 'minor', 'patch']) {
    if (pa[k] < pb[k]) return -1;
    if (pa[k] > pb[k]) return 1;
  }
  return 0;
}

// Classify the jump from `current` to `latest`:
// 'major' | 'minor' | 'patch' | 'none' (already up to date or ahead) | 'unknown'.
export function diffType(current, latest) {
  const a = parseVersion(current);
  const b = parseVersion(latest);
  if (!a || !b) return 'unknown';
  if (b.major !== a.major) return b.major > a.major ? 'major' : 'none';
  if (b.minor !== a.minor) return b.minor > a.minor ? 'minor' : 'none';
  if (b.patch !== a.patch) return b.patch > a.patch ? 'patch' : 'none';
  return 'none';
}
