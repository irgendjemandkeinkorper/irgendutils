import { finding } from '../findings.js';

export const id = 'analytics';
export const label = 'Analytics / consent';

const ANALYTICS_RE = /googletagmanager\.com|google-analytics\.com|gtag\s*\(|plausible\.io|matomo|_paq|fathom|usefathom\.com|umami|segment\.com|analytics\.js/i;
const CONSENT_RE = /cookieconsent|cookie-consent|cookie_consent|complianz|cookieyes|borlabs|consentmanager|cookiebot|osano|klaro|usercentrics|iubenda/i;

export async function run(site) {
  const F = [];
  const prod = site.config.environment === 'production';
  const allHtml = site.pages.map((p) => p.doc.raw).join('\n');

  const waived = site.config.analytics?.waived === true;
  const hasTag = ANALYTICS_RE.test(allHtml);

  if (waived) {
    F.push(finding('analytics', 'tracking-waived', 'info',
      'Analytics check explicitly waived in config (analytics.waived: true).',
      'No action needed — remove the waiver if tracking is added later.'));
  } else if (hasTag) {
    F.push(finding('analytics', 'tracking-present', 'info',
      'An analytics/tracking tag was detected.',
      'Verify events arrive in the analytics property for THIS (production) domain after launch.', site.baseUrl));
  } else {
    F.push(finding('analytics', 'tracking-missing', prod ? 'blocker' : 'warning',
      'No analytics/tracking tag detected on any audited page.',
      'Install the analytics tag (GA4/GTM/Plausible/Matomo...), or set analytics.waived: true in the config to accept launching without tracking.', site.baseUrl));
  }

  if (site.config.consent?.required === true) {
    if (CONSENT_RE.test(allHtml)) {
      F.push(finding('analytics', 'consent-present', 'info',
        'A cookie-consent solution was detected.',
        'Manually verify that tracking only fires after consent is given.', site.baseUrl));
    } else {
      F.push(finding('analytics', 'consent-missing', 'blocker',
        'Cookie consent is required (consent.required: true) but no consent banner/CMP was detected.',
        'Install and configure a consent management platform before enabling tracking.', site.baseUrl));
    }
  }

  return F;
}
