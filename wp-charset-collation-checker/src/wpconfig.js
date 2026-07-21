// Tiny wp-config.php reader — extracts define('DB_CHARSET', ...) etc. without
// a real PHP parser. Tolerates whitespace variations and either quote style.

const DEFINE_RE =
  /define\s*\(\s*(['"])(DB_CHARSET|DB_COLLATE|DB_NAME|DB_USER|DB_HOST)\1\s*,\s*(['"])((?:\\.|(?!\3).)*)\3\s*\)/g;

export function parseWpConfig(phpSource) {
  const out = {};
  for (const m of String(phpSource).matchAll(DEFINE_RE)) {
    out[m[2]] = m[4].replace(/\\(['"\\])/g, '$1');
  }
  return out;
}

/**
 * Cross-check the site's own charset settings against the intended target.
 * Returns an array of human-readable warning strings (empty = consistent).
 */
export function checkWpConfigAgainstTarget(wp, targetCharset, targetCollation) {
  const warnings = [];
  const charset = (wp.DB_CHARSET ?? '').toLowerCase();
  const collate = (wp.DB_COLLATE ?? '').toLowerCase();

  if (!('DB_CHARSET' in wp)) {
    warnings.push('wp-config.php does not define DB_CHARSET — WordPress will fall back to its default.');
  } else if (charset !== targetCharset.toLowerCase()) {
    const note =
      charset === 'utf8' || charset === 'utf8mb3'
        ? ' (MySQL utf8 is only 3 bytes — it cannot store emoji; utf8mb4 is real UTF-8)'
        : '';
    warnings.push(
      `wp-config.php DB_CHARSET is '${wp.DB_CHARSET}' but the target charset is '${targetCharset}'${note}. ` +
        'Update DB_CHARSET or new writes will keep using the wrong connection charset.'
    );
  }

  if (collate && !collate.startsWith(targetCharset.toLowerCase())) {
    warnings.push(
      `wp-config.php DB_COLLATE is '${wp.DB_COLLATE}' which does not belong to charset '${targetCharset}' ` +
        `(expected something like '${targetCollation}').`
    );
  }
  return warnings;
}
