// Link/asset status check. Pure: takes extracted links plus a map of
// url -> {status, redirectChain[], error?} and classifies findings.
// Individual broken links are warnings; the caller applies max_broken_links
// as the failing threshold.

export function checkLinks(links, statuses, { pageUrl } = {}) {
  const findings = [];
  let brokenCount = 0;
  const pageIsHttps = typeof pageUrl === 'string' && pageUrl.startsWith('https:');
  const push = (severity, message, details) =>
    findings.push({ check: 'links', severity, message, ...(details ? { details } : {}) });

  for (const link of links) {
    const label = `${link.type} ${link.url}`;

    if (pageIsHttps && link.url.startsWith('http:')) {
      if (link.type === 'anchor') {
        push('warn', `Insecure link on https page: ${label}`, { url: link.url, type: link.type });
      } else {
        push('error', `Mixed content: ${label} loaded over http on an https page`, { url: link.url, type: link.type });
      }
    }

    const st = statuses[link.url];
    if (!st) {
      brokenCount++;
      push('warn', `No response recorded for ${label}`, { url: link.url, type: link.type });
      continue;
    }
    if (st.error) {
      brokenCount++;
      push('warn', `Request failed for ${label}: ${st.error}`, { url: link.url, type: link.type, error: st.error });
      continue;
    }
    if (st.status >= 400) {
      brokenCount++;
      push('warn', `HTTP ${st.status} for ${label}`, { url: link.url, type: link.type, status: st.status });
    }
    const chain = st.redirectChain || [];
    if (chain.length >= 2) {
      push('warn', `Redirect chain (${chain.length} hops) for ${label}`, { url: link.url, chain });
    } else if (chain.length === 1) {
      push('info', `Redirect for ${label} -> ${chain[0]}`, { url: link.url, chain });
    }
  }

  return { findings, brokenCount };
}
