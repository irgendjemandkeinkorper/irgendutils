// REST adapter — the default access path (repo convention): create pages and
// import media over the WP REST API with an Application Password.

export function createRestAdapter({ baseUrl, user, appPassword, fetchImpl = fetch }) {
  if (!baseUrl) throw new Error('rest adapter needs wp.base_url (or WP_BASE_URL)');
  if (!user || !appPassword) {
    throw new Error('rest adapter needs WP_USER and WP_APP_PASSWORD (env or .env)');
  }
  const base = baseUrl.replace(/\/$/, '');
  const auth = 'Basic ' + Buffer.from(`${user}:${appPassword}`).toString('base64');

  async function req(path, init = {}) {
    const res = await fetchImpl(base + path, {
      ...init,
      headers: { Authorization: auth, ...(init.headers || {}) },
    });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 200);
      throw new Error(`${init.method || 'GET'} ${path} -> ${res.status} ${body}`);
    }
    return res.json();
  }

  return {
    name: 'rest',

    async createPage({ title, status = 'draft', content }) {
      const page = await req('/wp-json/wp/v2/pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, status, content }),
      });
      return { id: page.id, url: page.link };
    },

    async importMedia(src) {
      const download = await fetchImpl(src);
      if (!download.ok) throw new Error(`media fetch failed: ${src} -> ${download.status}`);
      const bytes = Buffer.from(await download.arrayBuffer());
      const filename = new URL(src, base).pathname.split('/').pop() || 'imported-media';
      const media = await req('/wp-json/wp/v2/media', {
        method: 'POST',
        headers: {
          'Content-Type': download.headers.get('content-type') || 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${filename.replace(/"/g, '')}"`,
        },
        body: bytes,
      });
      return { id: media.id, url: media.source_url };
    },
  };
}
