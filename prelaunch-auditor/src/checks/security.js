import { finding } from '../findings.js';

export const id = 'security';
export const label = 'Security / hygiene';

const header = (headers, name) => headers?.[name.toLowerCase()] ?? null;
const isHttpUrl = (u) => /^http:\/\//i.test(u ?? '');

const DEBUG_RE = /\b(Warning|Notice|Fatal error|Deprecated|Parse error)\b\s*:?\s[\s\S]{0,160}? in \/\S+ on line \d+/;

export async function run(site) {
  const F = [];
  const base = new URL(site.baseUrl);
  const home = site.pages[0];

  // --- HTTPS enforcement ----------------------------------------------------
  if (base.protocol === 'http:') {
    F.push(finding('security', 'site-on-http', 'blocker',
      'Site base URL is plain HTTP.',
      'Install a TLS certificate and serve the site over HTTPS.', site.baseUrl));
  } else {
    const httpHome = await site.resource(`http://${base.host}/`);
    const loc = header(httpHome.headers, 'location') ?? '';
    const redirects = httpHome.status >= 300 && httpHome.status < 400 && loc.startsWith('https://');
    if (!redirects) {
      F.push(finding('security', 'no-https-redirect', 'blocker',
        `HTTP is not redirected to HTTPS (http://${base.host}/ returned ${httpHome.status}${loc ? ` -> ${loc}` : ''}).`,
        'Add a permanent 301 redirect from http:// to https:// at the web server or CDN.', `http://${base.host}/`));
    }
  }

  // --- Response headers on the homepage ------------------------------------
  if (home) {
    if (!header(home.headers, 'strict-transport-security')) {
      F.push(finding('security', 'missing-hsts', 'warning',
        'No Strict-Transport-Security (HSTS) header.',
        'Send "Strict-Transport-Security: max-age=31536000; includeSubDomains" once HTTPS is stable.', home.url));
    }
    if ((header(home.headers, 'x-content-type-options') ?? '').toLowerCase() !== 'nosniff') {
      F.push(finding('security', 'missing-x-content-type-options', 'warning',
        'No "X-Content-Type-Options: nosniff" header.',
        'Add the header to prevent MIME-type sniffing.', home.url));
    }
    const csp = header(home.headers, 'content-security-policy') ?? '';
    if (!header(home.headers, 'x-frame-options') && !/frame-ancestors/i.test(csp)) {
      F.push(finding('security', 'missing-frame-protection', 'warning',
        'No clickjacking protection (X-Frame-Options or CSP frame-ancestors).',
        'Add "X-Frame-Options: SAMEORIGIN" or a CSP frame-ancestors directive.', home.url));
    }
    if (!header(home.headers, 'referrer-policy')) {
      F.push(finding('security', 'missing-referrer-policy', 'info',
        'No Referrer-Policy header.',
        'Add "Referrer-Policy: strict-origin-when-cross-origin".', home.url));
    }
  }

  // --- Per-page checks ------------------------------------------------------
  for (const p of site.pages) {
    const d = p.doc;

    if (p.url.startsWith('https://')) {
      const activeMixed = [...d.scripts, ...d.iframes, ...d.stylesheets].filter(isHttpUrl);
      const passiveMixed = d.images.map((i) => i.src).filter(isHttpUrl);
      if (activeMixed.length > 0) {
        F.push(finding('security', 'mixed-content-active', 'blocker',
          `Active mixed content: ${activeMixed.length} script/style/iframe URL(s) loaded over http:// (e.g. ${activeMixed[0]}).`,
          'Load all scripts, styles and iframes over https:// (search-replace http:// asset URLs).', p.url));
      }
      if (passiveMixed.length > 0) {
        F.push(finding('security', 'mixed-content-passive', 'warning',
          `Passive mixed content: ${passiveMixed.length} image URL(s) loaded over http:// (e.g. ${passiveMixed[0]}).`,
          'Serve images over https://.', p.url));
      }
    }

    const wpVersion = d.generator?.match(/WordPress\s+([\d.]+)/i);
    if (wpVersion) {
      F.push(finding('security', 'wp-version-exposed', 'warning',
        `WordPress version ${wpVersion[1]} exposed via the generator meta tag.`,
        'Remove the generator tag (remove_action(\'wp_head\', \'wp_generator\')) so the exact version is not advertised.', p.url));
    }

    if (DEBUG_RE.test(d.text) || /<b>\s*(Warning|Notice|Fatal error|Deprecated)\s*<\/b>\s*:/i.test(d.raw)) {
      F.push(finding('security', 'debug-output', 'blocker',
        'PHP debug/error output is visible on the page.',
        'Set WP_DEBUG and WP_DEBUG_DISPLAY to false in wp-config.php and fix the underlying notice.', p.url));
    }
  }

  // --- WP endpoint hygiene --------------------------------------------------
  const readme = await site.resource('/readme.html');
  if (readme.status === 200) {
    F.push(finding('security', 'readme-exposed', 'warning',
      'WordPress readme.html is publicly accessible (leaks version info).',
      'Delete readme.html or block it at the web server.', new URL('/readme.html', site.baseUrl).href));
  }

  const xmlrpc = await site.resource('/xmlrpc.php');
  F.push(finding('security', 'xmlrpc-state', 'info',
    xmlrpc.status === 200 || xmlrpc.status === 405
      ? 'XML-RPC endpoint is enabled (xmlrpc.php responds). It is a common brute-force target.'
      : `XML-RPC endpoint appears disabled/blocked (HTTP ${xmlrpc.status}).`,
    xmlrpc.status === 200 || xmlrpc.status === 405
      ? 'Disable XML-RPC (block xmlrpc.php) unless Jetpack/pingbacks are actually needed.'
      : 'No action needed.', new URL('/xmlrpc.php', site.baseUrl).href));

  const users = await site.resource('/wp-json/wp/v2/users');
  if (users.status === 200) {
    let slugs = [];
    try { slugs = JSON.parse(users.body).map((u) => String(u.slug ?? '').toLowerCase()); } catch { /* not JSON */ }
    if (slugs.includes('admin')) {
      F.push(finding('security', 'default-admin-username', 'warning',
        'Default "admin" username is present (exposed via the REST users endpoint).',
        'Create a new administrator with a unique username, delete "admin", and consider restricting the users REST endpoint.', new URL('/wp-json/wp/v2/users', site.baseUrl).href));
    }
  }

  return F;
}
