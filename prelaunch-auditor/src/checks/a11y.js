import { finding } from '../findings.js';
import { contrastRatio } from '../html.js';

export const id = 'a11y';
export const label = 'Accessibility';

export async function run(site) {
  const F = [];

  for (const p of site.pages) {
    const d = p.doc;

    const missingAlt = d.images.filter((img) => img.alt === null);
    if (missingAlt.length > 0) {
      F.push(finding('a11y', 'img-missing-alt', 'blocker',
        `${missingAlt.length} image(s) missing alt text (e.g. ${missingAlt[0].src || 'inline image'}).`,
        'Add descriptive alt attributes; use alt="" only for purely decorative images.', p.url));
    }

    if (d.unlabeledControls.length > 0) {
      const names = d.unlabeledControls.map((c) => `${c.type}:${c.name}`).join(', ');
      F.push(finding('a11y', 'form-missing-label', 'blocker',
        `${d.unlabeledControls.length} form field(s) without an accessible label (${names}).`,
        'Associate a <label for=...> with each field, or add aria-label/aria-labelledby.', p.url));
    }

    if (!d.lang) {
      F.push(finding('a11y', 'missing-lang', 'warning',
        'The <html> element has no lang attribute.',
        'Add lang="en" (or the site language) to the <html> element.', p.url));
    }

    if (!d.landmarks.main && !d.landmarks.nav) {
      F.push(finding('a11y', 'missing-landmarks', 'warning',
        'No landmark regions found (<main>, <nav>, or ARIA roles).',
        'Wrap primary content in <main> and navigation in <nav> so screen readers can jump between regions.', p.url));
    }

    for (const pair of d.inlineColorPairs) {
      const ratio = contrastRatio(pair.fg, pair.bg);
      if (ratio !== null && ratio < 4.5) {
        F.push(finding('a11y', 'low-contrast', 'warning',
          `Text/background contrast ${ratio.toFixed(2)}:1 is below 4.5:1 (${pair.fg} on ${pair.bg}).`,
          'Darken the text or lighten the background to reach at least 4.5:1 for body text.', p.url));
      }
    }

    const css = d.styleBlocks.join('\n');
    if (/:focus[^{}]*\{[^}]*outline\s*:\s*(none|0)/i.test(css)) {
      F.push(finding('a11y', 'focus-outline-removed', 'warning',
        'CSS removes the focus outline (outline: none on :focus) with no visible replacement detected.',
        'Provide a visible :focus style (outline or box-shadow) for keyboard users.', p.url));
    }
  }

  F.push(finding('a11y', 'automated-only', 'info',
    'Accessibility results are automated checks only — not a substitute for a manual audit with assistive technology.',
    'Schedule a manual keyboard + screen-reader pass before launch.'));

  return F;
}
