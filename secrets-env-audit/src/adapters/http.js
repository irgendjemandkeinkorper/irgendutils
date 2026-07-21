// Real HTTP adapter — only loaded (lazily) when web-probe runs against
// live URLs. Tests use a fake. Uses Node's built-in fetch (Node >= 18).

export function createHttpAdapter({ timeoutMs = 8000 } = {}) {
  return {
    async fetch(url) {
      const res = await globalThis.fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'user-agent': 'secaudit/1.0 (+security self-audit)' },
      });
      const body = await res.text();
      return { status: res.status, body: body.slice(0, 64 * 1024) };
    },
  };
}
