import { issue, worstStatus } from '../util.js';

// Evaluate DNS answers gathered from one or more resolvers.
// data: { resolvers: { <name>: { nxdomain?, error?, records: { A: [..], ... } } } }
// expect: { type, value } or an array of such (value may be a string or list).
export function evaluateDns(data, { host, expect = null } = {}) {
  const resolverNames = Object.keys(data?.resolvers ?? {});
  if (!resolverNames.length) {
    return { status: 'red', issues: [issue('red', 'dns_error', `no resolver data for ${host}`)] };
  }
  const entries = resolverNames.map((name) => ({ name, ...data.resolvers[name] }));
  const answering = entries.filter((e) => !e.error && !e.nxdomain);
  const issues = [];

  if (!answering.length) {
    if (entries.some((e) => e.nxdomain)) {
      issues.push(issue('red', 'nxdomain', `${host} does not resolve (NXDOMAIN on all resolvers)`));
    } else {
      issues.push(issue('red', 'dns_error', `all resolvers failed for ${host}`));
    }
    return { status: 'red', records: {}, issues };
  }

  const primary = answering[0];
  const records = primary.records ?? {};
  const expects = expect ? (Array.isArray(expect) ? expect : [expect]) : [];

  for (const ex of expects) {
    const type = String(ex.type ?? 'A').toUpperCase();
    const actual = normalize(records[type]);
    const wanted = (Array.isArray(ex.value) ? ex.value : [ex.value]).map(String);
    const missing = wanted.filter((w) => !actual.some((a) => a === w || a.includes(w)));
    if (missing.length) {
      issues.push(
        issue(
          'red',
          'drift',
          `${type} drift for ${host}: expected ${wanted.join(', ')}, got ${actual.length ? actual.join(', ') : '(no record)'}`,
          { type }
        )
      );
    }
  }

  // Propagation: disagreement between resolvers is info, not alarm (TTL caching).
  const compareTypes = expects.length
    ? [...new Set(expects.map((e) => String(e.type ?? 'A').toUpperCase()))]
    : ['A'];
  const disagreeing = [];
  for (const e of answering.slice(1)) {
    for (const type of compareTypes) {
      if (fingerprint(e.records?.[type]) !== fingerprint(records[type])) {
        disagreeing.push(e.name);
        break;
      }
    }
  }
  if (entries.some((e) => e.nxdomain) || disagreeing.length) {
    const who = [...disagreeing, ...entries.filter((e) => e.nxdomain).map((e) => e.name)];
    issues.push(
      issue('info', 'propagation', `resolvers disagree (${[...new Set(who)].join(', ')}) — likely DNS propagation/TTL, re-check later`)
    );
  }

  return {
    status: worstStatus(issues.map((i) => i.severity)),
    resolver: primary.name,
    records,
    issues,
  };
}

function normalize(list) {
  if (!Array.isArray(list)) return [];
  return list.map((r) => {
    if (typeof r === 'string') return r;
    if (Array.isArray(r)) return r.join(''); // TXT chunk arrays
    if (r && typeof r === 'object') {
      if (r.exchange) return `${r.priority ?? ''} ${r.exchange}`.trim(); // MX
      if (r.value) return String(r.value);
    }
    return String(r);
  });
}

function fingerprint(list) {
  return normalize(list).map((s) => s.toLowerCase()).sort().join('|');
}
