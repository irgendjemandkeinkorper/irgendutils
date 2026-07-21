import { daysUntil, issue, worstStatus } from '../util.js';
import { tightestThreshold } from './tls.js';

// Evaluate registrar (RDAP) expiry info for a registered domain.
// info: { expiry: ISO date, registrar?, error? }
export function evaluateDomain(info, { domain, now = Date.now(), warnDays = [60, 30, 14] } = {}) {
  if (!info || info.error) {
    // A failed lookup is not a breach by itself — flag amber so someone looks.
    return {
      status: 'amber',
      error: info?.error ?? 'no data',
      issues: [issue('amber', 'rdap_error', `RDAP lookup failed for ${domain} (${info?.error ?? 'no data'})`)],
    };
  }
  const issues = [];
  const daysLeft = daysUntil(info.expiry, now);
  let warnThreshold = null;
  if (daysLeft === null) {
    issues.push(issue('amber', 'rdap_error', `RDAP response for ${domain} had no expiry date`));
  } else if (daysLeft <= 0) {
    issues.push(issue('red', 'domain_expired', `domain registration for ${domain} expired ${-daysLeft} day(s) ago`));
  } else {
    warnThreshold = tightestThreshold(daysLeft, warnDays);
    if (warnThreshold !== null) {
      issues.push(
        issue('amber', 'domain_expiry', `domain ${domain} registration expires in ${daysLeft} day(s) (${warnThreshold}-day warning)`, {
          threshold: warnThreshold,
        })
      );
    }
  }
  return {
    status: worstStatus(issues.map((i) => i.severity)),
    domain,
    expiry: info.expiry ?? null,
    days_left: daysLeft,
    warn_threshold: warnThreshold,
    registrar: info.registrar ?? null,
    issues,
  };
}
