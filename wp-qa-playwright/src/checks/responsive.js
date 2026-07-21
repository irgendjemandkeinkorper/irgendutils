// Responsive check: no horizontal scroll at mobile widths, tap targets don't
// overlap, and the nav collapses where expected. Pure — takes per-viewport
// metrics measured by the adapter:
//   { "360": { scrollWidth, viewportWidth, navCollapsed, tapTargets: [{label,x,y,w,h}] }, ... }

export const MOBILE_MAX_WIDTH = 768;

export function checkResponsive(viewports = {}) {
  const findings = [];
  const push = (severity, message, details) =>
    findings.push({ check: 'responsive', severity, message, ...(details ? { details } : {}) });

  for (const [key, m] of Object.entries(viewports)) {
    const width = Number(key);
    const viewportWidth = m.viewportWidth ?? width;

    if (width <= MOBILE_MAX_WIDTH && m.scrollWidth != null && m.scrollWidth > viewportWidth + 1) {
      push('error', `Horizontal scroll at ${width}px: content width ${m.scrollWidth}px exceeds viewport ${viewportWidth}px`, {
        viewport: width,
        scrollWidth: m.scrollWidth,
      });
    }

    for (const [a, b] of findOverlaps(m.tapTargets || [])) {
      push('warn', `Tap targets overlap at ${width}px: "${a.label ?? 'target'}" and "${b.label ?? 'target'}"`, {
        viewport: width,
        targets: [a.label, b.label],
      });
    }

    if (width <= MOBILE_MAX_WIDTH && m.navCollapsed === false) {
      push('error', `Navigation did not collapse at ${width}px`, { viewport: width });
    }
  }
  return findings;
}

export function findOverlaps(targets) {
  const overlaps = [];
  for (let i = 0; i < targets.length; i++) {
    for (let j = i + 1; j < targets.length; j++) {
      const a = targets[i];
      const b = targets[j];
      const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ix > 1 && iy > 1) overlaps.push([a, b]);
    }
  }
  return overlaps;
}
