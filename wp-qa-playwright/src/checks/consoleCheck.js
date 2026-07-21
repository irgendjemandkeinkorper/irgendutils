// Console + network check. Any error-level console message or failed request
// during load is a finding.

export function checkConsole(messages = [], failedRequests = []) {
  const findings = [];
  for (const m of messages) {
    const type = String(m.type || '').toLowerCase();
    if (type === 'error') {
      findings.push({ check: 'console', severity: 'error', message: `Console error: ${m.text}` });
    } else if (type === 'warning' || type === 'warn') {
      findings.push({ check: 'console', severity: 'warn', message: `Console warning: ${m.text}` });
    }
  }
  for (const r of failedRequests) {
    findings.push({
      check: 'console',
      severity: 'error',
      message: `Failed request during load: ${r.url}${r.reason ? ` (${r.reason})` : ''}`,
      details: { url: r.url, ...(r.reason ? { reason: r.reason } : {}) },
    });
  }
  return findings;
}
