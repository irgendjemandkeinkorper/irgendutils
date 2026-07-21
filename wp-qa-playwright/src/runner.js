// Orchestrates a QA run: captures the template (once) and each target through
// the injected adapter, runs every enabled check against the pure check
// modules, applies thresholds, and returns findings + visual artifacts. No disk
// I/O and no network here — everything goes through the adapter, so the whole
// pipeline runs offline against the fake adapter in tests.

import { extractStructure, extractLinks } from './html.js';
import { structuralDiff } from './checks/structural.js';
import { checkLinks } from './checks/links.js';
import { checkConsole } from './checks/consoleCheck.js';
import { checkResponsive } from './checks/responsive.js';
import { visualCheck } from './checks/visual.js';
import { checkWpHygiene } from './checks/wpHygiene.js';
import { resolveAuth } from './config.js';

// Checks that need the template/reference captured for comparison.
const NEEDS_TEMPLATE = new Set(['structural', 'visual', 'wp_hygiene']);

/** Fetch a status for each unique link URL through the adapter (deduped). */
export async function collectLinkStatuses(adapter, links) {
  const statuses = {};
  for (const link of links) {
    if (statuses[link.url]) continue;
    statuses[link.url] = await adapter.fetchStatus(link.url);
  }
  return statuses;
}

/**
 * Run all enabled checks for one target.
 * ctx: { templateStructure, referenceShots, referenceLabel, templateWpInfo, auth }
 * Returns { target, finalUrl, pass, findings[], perCheck, visualArtifacts, checksRun }.
 */
export async function runTarget(adapter, cfg, targetUrl, ctx = {}) {
  const checks = cfg.checks;
  const findings = [];
  const perCheck = {};
  const visualArtifacts = {};

  const capture = await adapter.capturePage(targetUrl, {
    viewports: cfg.viewports,
    maskSelectors: cfg.mask_selectors,
    consentSelector: cfg.consent_selector,
  });
  const pageUrl = capture.finalUrl || targetUrl;

  if (checks.includes('structural')) {
    if (ctx.templateStructure) {
      findings.push(...structuralDiff(ctx.templateStructure, extractStructure(capture.html)));
    } else {
      findings.push(skip('structural', 'no template configured to compare structure against'));
    }
  }

  if (checks.includes('visual')) {
    const reference = ctx.referenceShots || {};
    const label = ctx.referenceLabel || 'template';
    if (Object.keys(reference).length === 0) {
      findings.push(skip('visual', `no ${label} screenshots to compare against (set template_url or capture a baseline)`));
    } else {
      const { findings: vf, viewports: vp } = visualCheck({
        shots: capture.screenshots,
        referenceShots: reference,
        maskRects: capture.maskRects,
        threshold: cfg.thresholds.pixel_diff_pct,
        referenceLabel: label,
      });
      findings.push(...vf);
      perCheck.visual = mapValues(vp, (c) => ({ diffPct: c.diffPct, dimensionsMatch: c.dimensionsMatch }));
      for (const v of Object.keys(capture.screenshots)) {
        visualArtifacts[v] = {
          target: capture.screenshots[v],
          reference: reference[v] || null,
          diff: vp[v]?.diffImage || null,
          diffPct: vp[v]?.diffPct ?? null,
          referenceLabel: label,
        };
      }
    }
  }

  if (checks.includes('links')) {
    const links = extractLinks(capture.html, pageUrl);
    const statuses = await collectLinkStatuses(adapter, links);
    const { findings: lf, brokenCount } = checkLinks(links, statuses, { pageUrl });
    findings.push(...lf);
    perCheck.links = { total: links.length, broken: brokenCount, threshold: cfg.thresholds.max_broken_links };
    if (brokenCount > cfg.thresholds.max_broken_links) {
      findings.push({
        check: 'links',
        severity: 'error',
        message: `${brokenCount} broken link/asset(s) exceed the max_broken_links threshold of ${cfg.thresholds.max_broken_links}`,
        details: { broken: brokenCount, threshold: cfg.thresholds.max_broken_links },
      });
    }
  }

  if (checks.includes('console')) {
    findings.push(...checkConsole(capture.console, capture.failedRequests));
  }

  if (checks.includes('responsive')) {
    findings.push(...checkResponsive(capture.viewports));
  }

  if (checks.includes('wp_hygiene')) {
    const targetWp = await adapter.fetchWpInfo(targetUrl, ctx.auth || null);
    findings.push(...checkWpHygiene(targetWp, ctx.templateWpInfo || null));
    perCheck.wp_hygiene = { restAvailable: targetWp?.restAvailable !== false };
  }

  return {
    target: targetUrl,
    finalUrl: pageUrl,
    pass: !findings.some((f) => f.severity === 'error'),
    findings,
    perCheck,
    visualArtifacts,
    checksRun: [...checks],
  };
}

/**
 * Full run across all targets. Captures the template once and reuses it.
 * opts: { env, log, baselines: { [targetUrl]: { "<vp>": image } } }
 * Returns { pass, results[], template_url, checks, thresholds }.
 */
export async function runQa(cfg, adapter, opts = {}) {
  const env = opts.env ?? process.env;
  const log = opts.log ?? (() => {});
  const baselines = opts.baselines ?? {};
  const auth = resolveAuth(cfg, env);

  const base = { auth };
  const needsTemplate = cfg.checks.some((c) => NEEDS_TEMPLATE.has(c));
  if (needsTemplate && cfg.template_url) {
    log(`Capturing template ${cfg.template_url}`);
    const t = await adapter.capturePage(cfg.template_url, {
      viewports: cfg.viewports,
      maskSelectors: cfg.mask_selectors,
      consentSelector: cfg.consent_selector,
    });
    base.templateStructure = extractStructure(t.html);
    base.referenceShots = t.screenshots;
    base.referenceLabel = 'template';
    if (cfg.checks.includes('wp_hygiene')) {
      base.templateWpInfo = await adapter.fetchWpInfo(cfg.template_url, auth);
    }
  }

  const results = [];
  for (const target of cfg.targets) {
    const ctx = { ...base };
    // With no template reference, fall back to a stored baseline for this site.
    if ((!ctx.referenceShots || Object.keys(ctx.referenceShots).length === 0) && baselines[target]) {
      ctx.referenceShots = baselines[target];
      ctx.referenceLabel = 'baseline';
    }
    log(`Checking ${target}`);
    results.push(await runTarget(adapter, cfg, target, ctx));
  }

  return {
    pass: results.every((r) => r.pass),
    results,
    template_url: cfg.template_url,
    checks: [...cfg.checks],
    thresholds: cfg.thresholds,
  };
}

export function severityCounts(findings) {
  const counts = { error: 0, warn: 0, info: 0 };
  for (const f of findings) counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  return counts;
}

function skip(check, reason) {
  return { check, severity: 'info', message: `${check} skipped: ${reason}`, skipped: true };
}

function mapValues(obj, fn) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = fn(v);
  return out;
}
