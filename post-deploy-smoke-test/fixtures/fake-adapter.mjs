// Fake fetch adapter for tests and offline CLI runs. Serves canned responses
// from the JSON file named by SMOKE_FIXTURE_RESPONSES, keyed by URL pathname.
// Entries may set:
//   auth: true  -> 401 unless the request carries an Authorization header
//   hang: true  -> never resolves (exercises the hard per-check timeout)
import { readFileSync } from 'node:fs';

export function makeFakeAdapter(map) {
  return {
    async fetch(req) {
      const { pathname } = new URL(req.url);
      const entry = map[pathname];
      if (!entry) {
        return { status: 404, headers: {}, body: 'fixture: no such path', durationMs: 5 };
      }
      if (entry.hang) return new Promise(() => {});
      if (entry.auth && !req.headers.authorization) {
        return {
          status: 401,
          headers: { 'content-type': 'application/json' },
          body: '{"code":"rest_not_logged_in","message":"You are not currently logged in."}',
          durationMs: 5,
        };
      }
      return {
        status: entry.status,
        headers: entry.headers ?? {},
        body: entry.body ?? '',
        durationMs: entry.durationMs ?? 10,
      };
    },
  };
}

export async function fetchUrl(req) {
  const file = process.env.SMOKE_FIXTURE_RESPONSES;
  if (!file) throw new Error('SMOKE_FIXTURE_RESPONSES env var not set');
  const map = JSON.parse(readFileSync(file, 'utf8'));
  return makeFakeAdapter(map).fetch(req);
}

export default { fetch: fetchUrl };
