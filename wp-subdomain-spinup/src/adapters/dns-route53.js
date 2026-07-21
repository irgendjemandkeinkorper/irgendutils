// Route 53 DNS adapter. Shells out to the AWS CLI (lazily — this module is
// only imported when dns.provider is route53) so we stay dependency-free.
// Credentials come from the usual AWS env vars / profile.

import { execFile } from 'node:child_process';

function aws(args, log) {
  log('dns.route53', { args });
  return new Promise((resolve, reject) => {
    execFile('aws', [...args, '--output', 'json'], (err, stdout, stderr) => {
      if (err) reject(new Error(`aws ${args[0]} failed: ${stderr || err.message}`));
      else resolve(stdout ? JSON.parse(stdout) : null);
    });
  });
}

export function createDnsAdapter(config, { log = () => {} } = {}) {
  const zone = config.dns.zone;
  let zoneId;

  async function getZoneId() {
    if (zoneId) return zoneId;
    const out = await aws(
      ['route53', 'list-hosted-zones-by-name', '--dns-name', zone, '--max-items', '1'],
      log
    );
    const hz = out.HostedZones?.[0];
    if (!hz || !hz.Name.startsWith(zone)) throw new Error(`Route53 zone not found: ${zone}`);
    return (zoneId = hz.Id.replace('/hostedzone/', ''));
  }

  async function findRecord(fqdn) {
    const id = await getZoneId();
    const out = await aws(
      ['route53', 'list-resource-record-sets', '--hosted-zone-id', id,
        '--start-record-name', `${fqdn}.`, '--max-items', '1'],
      log
    );
    const rec = out.ResourceRecordSets?.[0];
    return rec && rec.Name === `${fqdn}.` ? rec : null;
  }

  async function change(action, fqdn, target) {
    const id = await getZoneId();
    const batch = {
      Changes: [{
        Action: action,
        ResourceRecordSet: {
          Name: `${fqdn}.`, Type: 'CNAME', TTL: 300,
          ResourceRecords: [{ Value: target }],
        },
      }],
    };
    await aws(
      ['route53', 'change-resource-record-sets', '--hosted-zone-id', id,
        '--change-batch', JSON.stringify(batch)],
      log
    );
  }

  return {
    provider: 'route53',

    async recordExists(fqdn) {
      return Boolean(await findRecord(fqdn));
    },

    async createRecord(fqdn, target) {
      await change('UPSERT', fqdn, target);
    },

    async deleteRecord(fqdn) {
      const rec = await findRecord(fqdn);
      if (!rec) return;
      await change('DELETE', fqdn, rec.ResourceRecords?.[0]?.Value ?? '');
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
