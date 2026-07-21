// Media handling: build a src -> { id, url } map.
// mode 'link' (default) keeps external URLs; mode 'import' uploads each image
// through the given WP adapter (WP-CLI or REST) and records the attachment.

export async function resolveMediaMap(sources, { mode = 'link', adapter, log } = {}) {
  const map = new Map();
  if (mode !== 'import') return map;
  if (!adapter || typeof adapter.importMedia !== 'function') {
    throw new Error('--media import requires a WordPress adapter (rest or wpcli)');
  }
  for (const src of sources) {
    log?.(`media import: ${src}`);
    const result = await adapter.importMedia(src);
    if (result && result.url) map.set(src, { id: result.id ?? null, url: result.url });
  }
  return map;
}
