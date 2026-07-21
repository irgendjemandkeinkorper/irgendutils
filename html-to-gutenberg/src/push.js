// Push converted block markup to WordPress through an adapter
// (adapters/rest.js or adapters/wpcli.js — lazily loaded by the CLI).

export async function pushPage({ title, status = 'draft', content }, adapter, log) {
  if (!adapter || typeof adapter.createPage !== 'function') {
    throw new Error('push requires a WordPress adapter (rest or wpcli)');
  }
  log?.(`creating page "${title}" (status: ${status}) via ${adapter.name || 'adapter'}`);
  const result = await adapter.createPage({ title, status, content });
  if (!result || result.id == null) {
    throw new Error('adapter did not return a page id');
  }
  return result; // { id, url? }
}

export function titleFromMarkup(markup, fallback = 'Converted page') {
  const m = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(markup);
  if (!m) return fallback;
  return m[1].replace(/<[^>]+>/g, '').trim() || fallback;
}
