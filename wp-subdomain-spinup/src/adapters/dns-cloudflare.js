// Cloudflare DNS adapter. Needs CLOUDFLARE_API_TOKEN in the environment
// (Zone.DNS edit permission for the zone). Only Node built-ins (fetch).
//
// Gotcha (from CLAUDE.md): proxied records can mask TLS/origin errors —
// records are created UNPROXIED (grey cloud) so verification hits the origin.

const API = 'https://api.cloudflare.com/client/v4';

export function createDnsAdapter(config, { log = () => {} } = {}) {
  const zone = config.dns.zone;
  let zoneId;

  function token() {
    const t = process.env.CLOUDFLARE_API_TOKEN;
    if (!t) throw new Error('Missing CLOUDFLARE_API_TOKEN env var (see .env.example).');
    return t;
  }

  async function cf(path, opts = {}) {
    log('dns.cloudflare', { method: opts.method ?? 'GET', path });
    const res = await fetch(`${API}${path}`, {
      method: opts.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${token()}`,
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json();
    if (!data.success) {
      throw new Error(`Cloudflare API error: ${JSON.stringify(data.errors)}`);
    }
    return data.result;
  }

  async function getZoneId() {
    if (zoneId) return zoneId;
    const zones = await cf(`/zones?name=${encodeURIComponent(zone)}`);
    if (!zones.length) throw new Error(`Cloudflare zone not found: ${zone}`);
    return (zoneId = zones[0].id);
  }

  async function findRecord(fqdn) {
    const id = await getZoneId();
    const records = await cf(`/zones/${id}/dns_records?name=${encodeURIComponent(fqdn)}`);
    return records[0] ?? null;
  }

  return {
    provider: 'cloudflare',

    async recordExists(fqdn) {
      return Boolean(await findRecord(fqdn));
    },

    async createRecord(fqdn, target) {
      const id = await getZoneId();
      await cf(`/zones/${id}/dns_records`, {
        method: 'POST',
        body: { type: 'CNAME', name: fqdn, content: target, ttl: 300, proxied: false },
      });
    },

    async deleteRecord(fqdn) {
      const record = await findRecord(fqdn);
      if (!record) return;
      const id = await getZoneId();
      await cf(`/zones/${id}/dns_records/${record.id}`, { method: 'DELETE' });
    },

    async resolves(fqdn) {
      const { promises: dns } = await import('node:dns');
      try {
        await dns.lookup(fqdn);
        return true;
      } catch {
        return false;
      }
    },
  };
}
