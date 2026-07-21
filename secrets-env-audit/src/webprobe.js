// Part C — web exposure probe: check classic exposed-config paths via an
// injected HTTP adapter ({ fetch(url) -> { status, body } }), so tests run
// offline against a fake adapter.

const DEFAULT_PATHS = ['/.env', '/wp-config.php.bak', '/.git/config', '/config.php~'];

export function looksLikeConfig(body) {
  const text = String(body ?? '');
  if (!text.trim()) return false;
  if (/<(!doctype|html|head|body)\b/i.test(text)) return false; // HTML error/soft-404 page
  let signals = 0;
  if (/^\s*(export\s+)?[A-Z][A-Z0-9_]*\s*=/m.test(text)) signals += 2; // .env-style line
  if (/define\s*\(\s*['"]/.test(text)) signals += 2; // wp-config style
  if (/^\s*\[(core|remote|branch)/m.test(text)) signals += 2; // .git/config style
  if (/<\?php/.test(text)) signals += 1;
  if (/(password|passwd|secret|token|api[_-]?key|db_)/i.test(text)) signals += 1;
  return signals >= 2;
}

export async function runWebProbe(config, { httpAdapter }) {
  const cfg = config.web_probe ?? {};
  const urls = cfg.urls ?? [];
  const paths = cfg.paths ?? DEFAULT_PATHS;
  const findings = [];
  const warnings = [];
  const checked = [];
  for (const base of urls) {
    for (const path of paths) {
      const url = String(base).replace(/\/+$/, '') + path;
      let res;
      try {
        res = await httpAdapter.fetch(url);
      } catch (err) {
        warnings.push(`probe failed for ${url}: ${err.message}`);
        continue;
      }
      checked.push({ url, status: res.status });
      if (res.status === 200 && looksLikeConfig(res.body)) {
        findings.push({
          part: 'web_probe',
          rule: 'exposed_config',
          severity: 'high',
          confidence: 'high',
          url,
          status: res.status,
          masked: `${url} returned 200 with config-looking content (content not reproduced here)`,
          remediation: `Block ${path} at the web server (deny dotfiles/backup files), remove the file from the docroot, and rotate every credential it contains.`,
        });
      } else if (res.status === 200) {
        findings.push({
          part: 'web_probe',
          rule: 'reachable_path',
          severity: 'low',
          confidence: 'low',
          url,
          status: res.status,
          masked: `${url} returned 200 but content does not look like config (possible soft-404)`,
          remediation: `Verify ${path} really is a catch-all page; sensitive paths should return 403/404.`,
        });
      }
    }
  }
  return { findings, warnings, checked };
}
