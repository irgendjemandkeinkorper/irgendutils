// Optional Playwright adapter for the rare check that needs JS rendering.
// Used only for checks marked `browser: true` in smoke.yml, and only loaded
// then. Playwright is NOT a dependency of this package — install it yourself
// (`npm i -D playwright`) if you need browser checks; everything else runs
// without it.

export async function fetchUrl(req) {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    return {
      error:
        'check has browser: true but playwright is not installed — run `npm i -D playwright` (or drop the flag)',
    };
  }

  const started = Date.now();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ extraHTTPHeaders: req.headers });
    const resp = await page.goto(req.url, {
      timeout: req.timeoutMs,
      waitUntil: 'domcontentloaded',
    });
    const body = await page.content();
    return {
      status: resp?.status() ?? 0,
      headers: resp?.headers() ?? {},
      body,
      durationMs: Date.now() - started,
    };
  } catch (err) {
    return { error: err.message, durationMs: Date.now() - started };
  } finally {
    await browser.close();
  }
}

export default { fetch: fetchUrl };
