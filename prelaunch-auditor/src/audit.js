import { extract } from './html.js';
import { sortFindings, summarize, CATEGORY_ORDER } from './findings.js';
import * as seo from './checks/seo.js';
import * as a11y from './checks/a11y.js';
import * as perf from './checks/perf.js';
import * as security from './checks/security.js';
import * as content from './checks/content.js';
import * as analytics from './checks/analytics.js';

export const CATEGORIES = { seo, a11y, perf, security, content, analytics };

const lowerHeaders = (headers = {}) =>
  Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));

/**
 * Run the audit against an adapter (live or fixture).
 * Adapter interface:
 *   baseUrl: string
 *   pages(): Promise<[{ url, path, status, headers, html }]>
 *   resource(pathOrUrl): Promise<{ status, headers, body }>   (never throws)
 *   perfRuns(formFactor, n): Promise<[{ lcp_ms, tbt_ms, cls, performance_score }] | null>
 */
export async function runAudit(adapter, config) {
  const rawPages = await adapter.pages();
  const pages = rawPages.map((p) => ({
    ...p,
    headers: lowerHeaders(p.headers),
    doc: extract(p.html),
  }));

  const site = {
    baseUrl: adapter.baseUrl,
    pages,
    config,
    resource: async (p) => {
      const res = await adapter.resource(p);
      return { status: 0, headers: {}, body: '', ...res, headers: lowerHeaders(res?.headers) };
    },
    perfRuns: (formFactor, n) => adapter.perfRuns(formFactor, n),
  };

  const enabled = config.only?.length
    ? CATEGORY_ORDER.filter((c) => config.only.includes(c))
    : [...CATEGORY_ORDER];

  let findings = [];
  for (const cat of enabled) {
    findings = findings.concat(await CATEGORIES[cat].run(site));
  }
  findings = sortFindings(findings);
  const summary = summarize(findings);

  return {
    baseUrl: adapter.baseUrl,
    environment: config.environment,
    categories: enabled,
    pagesAudited: pages.map((p) => p.url),
    summary,
    pass: summary.blocker === 0,
    findings,
  };
}
