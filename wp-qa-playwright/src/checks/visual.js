// Visual regression comparator. Pure pixel math on {width, height, data: RGBA
// Buffer} images — screenshots come from the adapter (real Playwright or fake).

/** Return a copy of img with the given rects blacked out (masking dynamic regions). */
export function applyMasks(img, rects = []) {
  if (!rects.length) return img;
  const data = Buffer.from(img.data);
  for (const r of rects) {
    const x0 = Math.max(0, Math.floor(r.x));
    const y0 = Math.max(0, Math.floor(r.y));
    const x1 = Math.min(img.width, Math.ceil(r.x + r.w));
    const y1 = Math.min(img.height, Math.ceil(r.y + r.h));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * img.width + x) * 4;
        data[i] = 0;
        data[i + 1] = 0;
        data[i + 2] = 0;
        data[i + 3] = 255;
      }
    }
  }
  return { width: img.width, height: img.height, data };
}

/**
 * Compare two RGBA images. Pixels outside the overlap (dimension mismatch)
 * count as different. Returns diff stats plus a diff overlay image (matching
 * pixels dimmed grayscale, differing pixels red).
 */
export function compareImages(a, b, { tolerance = 0 } = {}) {
  const width = Math.max(a.width, b.width);
  const height = Math.max(a.height, b.height);
  const totalPixels = width * height;
  const diffData = Buffer.alloc(totalPixels * 4);
  let diffPixels = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const d = (y * width + x) * 4;
      const inA = x < a.width && y < a.height;
      const inB = x < b.width && y < b.height;
      let different;
      let gray = 0;
      if (inA && inB) {
        const ia = (y * a.width + x) * 4;
        const ib = (y * b.width + x) * 4;
        different =
          Math.abs(a.data[ia] - b.data[ib]) > tolerance ||
          Math.abs(a.data[ia + 1] - b.data[ib + 1]) > tolerance ||
          Math.abs(a.data[ia + 2] - b.data[ib + 2]) > tolerance;
        gray = (a.data[ia] + a.data[ia + 1] + a.data[ia + 2]) / 3;
      } else {
        different = true;
      }
      if (different) {
        diffPixels++;
        diffData[d] = 255;
        diffData[d + 1] = 45;
        diffData[d + 2] = 45;
      } else {
        const dim = Math.round(160 + gray * 0.35);
        diffData[d] = dim;
        diffData[d + 1] = dim;
        diffData[d + 2] = dim;
      }
      diffData[d + 3] = 255;
    }
  }

  return {
    width,
    height,
    diffPixels,
    totalPixels,
    diffPct: totalPixels === 0 ? 0 : (diffPixels / totalPixels) * 100,
    dimensionsMatch: a.width === b.width && a.height === b.height,
    diffImage: { width, height, data: diffData },
  };
}

/**
 * Run the visual check for one page across viewports.
 * shots / referenceShots: { "<viewport>": {width, height, data} }
 * maskRects: { "<viewport>": [{x,y,w,h}] } — applied to BOTH sides.
 * threshold: pixel_diff_pct (percent) above which the page fails.
 */
export function visualCheck({ shots = {}, referenceShots = {}, maskRects = {}, threshold, referenceLabel = 'template' }) {
  const findings = [];
  const viewports = {};
  for (const vp of Object.keys(shots)) {
    const reference = referenceShots[vp];
    if (!reference) {
      findings.push({
        check: 'visual',
        severity: 'info',
        message: `Viewport ${vp}: no ${referenceLabel} screenshot to compare against — skipped`,
      });
      continue;
    }
    const rects = maskRects[vp] || [];
    const cmp = compareImages(applyMasks(shots[vp], rects), applyMasks(reference, rects));
    viewports[vp] = cmp;
    if (cmp.diffPct > threshold) {
      findings.push({
        check: 'visual',
        severity: 'error',
        message: `Viewport ${vp}: pixel diff ${cmp.diffPct.toFixed(2)}% vs ${referenceLabel} exceeds threshold ${threshold}%`,
        details: { viewport: Number(vp), diffPct: round4(cmp.diffPct), threshold, reference: referenceLabel },
      });
    }
  }
  return { findings, viewports };
}

export function round4(n) {
  return Math.round(n * 10000) / 10000;
}
