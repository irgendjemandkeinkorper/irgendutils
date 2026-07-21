// Real HTTP adapter — lazily imported by the CLI only when a live run happens.
// Uses Node 18+ global fetch. Never followed redirects (so 301/302 checks see
// the raw response), sends a no-cache header, and honors the hard timeout via
// AbortController. TLS problems (expired cert, hostname mismatch) surface as
// error responses and fail the check.

export async function fetchUrl(req) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), req.timeoutMs);
  try {
    const res = await fetch(req.url, {
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        'user-agent': 'irgendutils-smoke/1.0 (+post-deploy-smoke-test)',
        'cache-control': 'no-cache',
        ...req.headers,
      },
    });
    const body = await res.text();
    return {
      status: res.status,
      headers: Object.fromEntries(res.headers.entries()),
      body,
      durationMs: Date.now() - started,
    };
  } catch (err) {
    const durationMs = Date.now() - started;
    if (controller.signal.aborted) return { timedOut: true, durationMs };
    const cause = err?.cause?.message ?? err?.cause?.code;
    return { error: cause ? `${err.message} (${cause})` : err.message, durationMs };
  } finally {
    clearTimeout(timer);
  }
}

export default { fetch: fetchUrl };
