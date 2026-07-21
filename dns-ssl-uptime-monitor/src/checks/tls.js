import { daysUntil, issue, nameMatches, worstStatus } from '../util.js';

const WEAK_PROTOCOLS = new Set(['SSLv2', 'SSLv3', 'TLSv1', 'TLSv1.1']);

// The tightest (smallest) warn threshold the cert has crossed, or null.
// Escalation model: each run warns only at the tightest crossed threshold, so a
// cert first seen at 5 days out fires the 7-day warning now and the 1-day warning
// once it gets there — the 30/14-day levels never fire for it (no alert backfill,
// no alert fatigue).
export function tightestThreshold(daysLeft, warnDays = []) {
  let best = null;
  for (const t of warnDays) {
    const n = Number(t);
    if (Number.isFinite(n) && daysLeft <= n && (best === null || n < best)) best = n;
  }
  return best;
}

// Evaluate certificate info (from an adapter) for one host.
// info: { valid_from, valid_to, subject_cn, alt_names[], issuer_cn,
//         self_signed, chain_valid, protocol, error? }
export function evaluateTls(
  info,
  { host, now = Date.now(), warnDays = [30, 14, 7, 1], allowSelfSigned = false } = {}
) {
  if (!info || info.error) {
    const msg = `TLS handshake failed (${info?.error ?? 'no data'})`;
    return { status: 'red', error: info?.error ?? 'no data', issues: [issue('red', 'tls_error', msg)] };
  }
  const issues = [];
  const daysLeft = daysUntil(info.valid_to, now);

  const names = [
    ...(info.alt_names ?? []),
    ...(info.subject_cn ? [info.subject_cn] : []),
  ];
  const hostnameMatch = names.some((n) => nameMatches(n, host));
  if (!hostnameMatch) {
    issues.push(
      issue('red', 'hostname_mismatch', `certificate does not cover ${host} (names: ${names.join(', ') || 'none'})`)
    );
  }

  if (info.self_signed) {
    if (!allowSelfSigned) {
      issues.push(issue('red', 'self_signed', 'self-signed certificate on a production target'));
    }
  } else if (info.chain_valid === false) {
    issues.push(
      issue('red', 'chain_invalid', `certificate chain does not validate (${info.chain_error ?? 'missing/expired intermediate?'})`)
    );
  }

  let warnThreshold = null;
  if (daysLeft === null) {
    issues.push(issue('amber', 'cert_no_expiry', 'could not read certificate expiry'));
  } else if (daysLeft <= 0) {
    issues.push(issue('red', 'cert_expired', `certificate expired ${-daysLeft} day(s) ago`));
  } else {
    warnThreshold = tightestThreshold(daysLeft, warnDays);
    if (warnThreshold !== null) {
      issues.push(
        issue('amber', 'cert_expiry', `certificate expires in ${daysLeft} day(s) (${warnThreshold}-day warning)`, {
          threshold: warnThreshold,
        })
      );
    }
  }

  if (info.protocol && WEAK_PROTOCOLS.has(info.protocol)) {
    issues.push(issue('amber', 'weak_protocol', `weak TLS protocol negotiated: ${info.protocol}`));
  }

  return {
    status: worstStatus(issues.map((i) => i.severity)),
    days_left: daysLeft,
    warn_threshold: warnThreshold,
    hostname_match: hostnameMatch,
    chain_valid: info.chain_valid !== false,
    self_signed: !!info.self_signed,
    protocol: info.protocol ?? null,
    issuer: info.issuer_cn ?? null,
    valid_to: info.valid_to ?? null,
    issues,
  };
}
