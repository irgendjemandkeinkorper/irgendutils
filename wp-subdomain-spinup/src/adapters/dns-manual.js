// Manual DNS "provider": we never mutate anything — the engine prints the
// record for the user to add and we only answer "does it resolve yet?".

import { promises as dns } from 'node:dns';

export function createDnsAdapter(config, { log = () => {} } = {}) {
  return {
    provider: 'manual',

    async recordExists(fqdn) {
      return this.resolves(fqdn);
    },

    async resolves(fqdn) {
      log('dns.lookup', { fqdn });
      try {
        await dns.lookup(fqdn);
        return true;
      } catch {
        return false;
      }
    },

    async createRecord() {
      throw new Error('manual DNS provider cannot create records — add the record yourself');
    },

    async deleteRecord() {
      throw new Error('manual DNS provider cannot delete records — remove the record yourself');
    },
  };
}
