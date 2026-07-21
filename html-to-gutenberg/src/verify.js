// Render verification. The adapter (adapters/playwright.js in real use,
// a stub in tests) opens the page in the block editor and reports back.

export async function runVerify(target, { adapter, expectedCounts = null, log } = {}) {
  if (!adapter || typeof adapter.open !== 'function') {
    throw new Error('verify requires a render adapter');
  }
  log?.(`opening ${target} via ${adapter.name || 'adapter'}`);
  const session = await adapter.open(target);
  try {
    const warnings = await adapter.getInvalidBlockWarnings(session);
    const blocks = await adapter.listBlocks(session);
    const consoleErrors = adapter.getConsoleErrors ? await adapter.getConsoleErrors(session) : [];

    const counts = new Map();
    for (const b of blocks) counts.set(b.name, (counts.get(b.name) || 0) + 1);

    const mismatches = [];
    if (expectedCounts) {
      const names = new Set([...expectedCounts.keys(), ...counts.keys()]);
      for (const name of names) {
        const want = expectedCounts.get(name) || 0;
        const got = counts.get(name) || 0;
        if (want !== got) mismatches.push(`${name}: expected ${want}, editor has ${got}`);
      }
    }

    return {
      ok: warnings.length === 0 && mismatches.length === 0 && consoleErrors.length === 0,
      warnings,
      mismatches,
      consoleErrors,
      counts,
    };
  } finally {
    if (typeof adapter.close === 'function') await adapter.close(session);
  }
}
