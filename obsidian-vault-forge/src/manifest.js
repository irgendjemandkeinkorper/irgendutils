// Load and validate a project.yml manifest into the normalized shape the forge
// and note builders consume. Fail loudly on missing required fields.
import fs from 'node:fs';
import { parseYAML } from './yaml.js';
import { slugify } from './util.js';

export class ManifestError extends Error {}

/** Parse + normalize a manifest object (already-parsed YAML). */
export function normalizeManifest(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ManifestError('manifest must be a YAML mapping');
  }
  const name = str(raw.name);
  if (!name) throw new ManifestError('manifest is missing required field: name');

  const slug = str(raw.slug) || slugify(name);
  if (!slug) throw new ManifestError(`could not derive a slug from name "${name}"`);

  const stakeholders = asArray(raw.stakeholders).map((s, i) => {
    if (!s || typeof s !== 'object') {
      throw new ManifestError(`stakeholders[${i}] must be a mapping`);
    }
    if (!str(s.name)) throw new ManifestError(`stakeholders[${i}] is missing: name`);
    return { name: str(s.name), role: str(s.role), email: str(s.email) };
  });

  return {
    name,
    slug,
    client: str(raw.client),
    status: str(raw.status) || 'active',
    siteUrls: asArray(raw.site_urls).map(str).filter(Boolean),
    stakeholders,
    links: isPlainObject(raw.links) ? mapValues(raw.links, str) : {},
    tags: asArray(raw.tags).map(str).filter(Boolean),
  };
}

/** Read project.yml from disk and normalize it. */
export function loadManifest(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    throw new ManifestError(`cannot read manifest: ${file} (${err.code || err.message})`);
  }
  let raw;
  try {
    raw = parseYAML(text);
  } catch (err) {
    throw new ManifestError(`invalid YAML in ${file}: ${err.message}`);
  }
  return normalizeManifest(raw);
}

function str(v) {
  return v == null ? '' : String(v).trim();
}
function asArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}
function isPlainObject(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}
function mapValues(obj, fn) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = fn(v);
  return out;
}
