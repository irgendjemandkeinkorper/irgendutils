import fs from 'fs';
import path from 'path';

// Parse CSV content using a robust custom parser
export function parseCSV(content) {
  const lines = [];
  let row = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    const next = content[i + 1];

    if (inQuotes) {
      if (char === '"') {
        if (next === '"') {
          current += '"';
          i++; // skip next quote
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        row.push(current);
        current = '';
      } else if (char === '\r' || char === '\n') {
        row.push(current);
        current = '';
        if (row.length > 0 && (row.length > 1 || row[0] !== '')) {
          lines.push(row);
        }
        row = [];
        if (char === '\r' && next === '\n') {
          i++; // skip LF
        }
      } else {
        current += char;
      }
    }
  }
  if (row.length > 0 || current !== '') {
    row.push(current);
    lines.push(row);
  }
  return lines;
}

// Custom CSV stringifier
export function stringifyCSV(rows) {
  return rows.map(row => {
    return row.map(field => {
      const str = String(field ?? '');
      if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    }).join(',');
  }).join('\n');
}

// Robust path normalizer
export function normalizePath(urlOrPath) {
  if (!urlOrPath) return '';
  let str = String(urlOrPath).trim();

  // Strip protocol and domain if present to get path
  try {
    if (str.startsWith('http://') || str.startsWith('https://')) {
      const parsed = new URL(str);
      str = parsed.pathname + parsed.search;
    }
  } catch (e) {
    // Treat as path if URL parsing fails
  }

  // Split path from query parameters
  let [pathname, search] = str.split('?');

  // Percent-decode path safely
  try {
    pathname = decodeURIComponent(pathname);
  } catch (e) {
    // Keep original if decoding fails
  }

  // NFC Unicode normalization
  pathname = pathname.normalize('NFC');

  // Case-insensitive comparisons are standard, so match on lowercase pathname
  pathname = pathname.toLowerCase();

  // Strip trailing slashes, but keep single slash root
  if (pathname.endsWith('/') && pathname !== '/') {
    pathname = pathname.slice(0, -1);
  }

  // Ensure leading slash
  if (!pathname.startsWith('/')) {
    pathname = '/' + pathname;
  }

  // Normalize query parameters (sort for deterministic matching)
  let queryStr = '';
  if (search) {
    try {
      const params = new URLSearchParams(search);
      params.sort();
      queryStr = params.toString();
      if (queryStr) {
        queryStr = '?' + queryStr;
      }
    } catch (e) {
      queryStr = '?' + search;
    }
  }

  return pathname + queryStr;
}

export function cleanTitle(title) {
  if (!title) return '';
  return String(title)
    .toLowerCase()
    .replace(/[^\w\s\d]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getSlugFromUrl(url) {
  if (!url) return '';
  try {
    const pathname = url.startsWith('http') ? new URL(url).pathname : url;
    const segments = pathname.split('/').filter(Boolean);
    const last = segments[segments.length - 1] || '';
    return last.toLowerCase().replace(/\.[^/.]+$/, ""); // Strip extensions e.g. .html
  } catch (e) {
    return '';
  }
}

function getTitleFromUrl(url) {
  const slug = getSlugFromUrl(url);
  return slug
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function parseSitemapXml(content) {
  const urls = [];
  const locRegex = /<loc>(.*?)<\/loc>/g;
  let match;
  while ((match = locRegex.exec(content)) !== null) {
    urls.push(match[1].trim());
  }
  return urls;
}

export function parseOverrides(overridesPath) {
  if (!overridesPath) return {};
  const content = fs.readFileSync(overridesPath, 'utf8').trim();
  const ext = path.extname(overridesPath).toLowerCase();

  const overrides = {}; // Key: normalizedSourcePath, Value: { target, status }

  if (ext === '.json') {
    const data = JSON.parse(content);
    if (Array.isArray(data)) {
      data.forEach(item => {
        const source = item.source || item.old_path || item.old;
        const target = item.target || item.new_path || item.new;
        const status = item.status || 301;
        if (source) {
          overrides[normalizePath(source)] = { target, status: Number(status) };
        }
      });
    } else {
      // Map format { "/old": "/new" } or { "/old": { "target": "/new", "status": 301 } }
      Object.entries(data).forEach(([source, val]) => {
        if (typeof val === 'string') {
          overrides[normalizePath(source)] = { target: val, status: 301 };
        } else if (val && typeof val === 'object') {
          overrides[normalizePath(source)] = {
            target: val.target || 'gone',
            status: Number(val.status || 301)
          };
        }
      });
    }
  } else if (ext === '.csv') {
    const rows = parseCSV(content);
    if (rows.length > 0) {
      const header = rows[0].map(h => h.trim().toLowerCase());
      const sourceIdx = header.findIndex(h => ['source', 'old_path', 'old', 'source_path'].includes(h));
      const targetIdx = header.findIndex(h => ['target', 'new_path', 'new', 'target_path'].includes(h));
      const statusIdx = header.findIndex(h => ['status', 'redirect_status', 'code'].includes(h));

      const startIdx = (sourceIdx !== -1 && targetIdx !== -1) ? 1 : 0;
      const sCol = sourceIdx !== -1 ? sourceIdx : 0;
      const tCol = targetIdx !== -1 ? targetIdx : 1;
      const stCol = statusIdx !== -1 ? statusIdx : -1;

      for (let i = startIdx; i < rows.length; i++) {
        const row = rows[i];
        if (row.length > sCol) {
          const source = row[sCol];
          const target = row[tCol] || '';
          const status = stCol !== -1 && row[stCol] ? Number(row[stCol]) : 301;
          if (source) {
            overrides[normalizePath(source)] = { target, status };
          }
        }
      }
    }
  }
  return overrides;
}

export function parseDestinationFile(filePath) {
  if (!filePath) return [];
  const content = fs.readFileSync(filePath, 'utf8').trim();
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.xml') {
    return parseSitemapXml(content).map(url => ({
      url,
      slug: getSlugFromUrl(url),
      title: getTitleFromUrl(url),
    }));
  }

  if (ext === '.json') {
    const data = JSON.parse(content);
    let rawPages = [];
    if (Array.isArray(data)) {
      rawPages = data;
    } else if (data && Array.isArray(data.pages)) {
      rawPages = data.pages;
    } else if (data && Array.isArray(data.urls)) {
      rawPages = data.urls;
    }

    return rawPages.map(item => {
      if (typeof item === 'string') {
        return {
          url: item,
          slug: getSlugFromUrl(item),
          title: getTitleFromUrl(item),
        };
      }
      return {
        url: item.url || '',
        slug: item.slug || getSlugFromUrl(item.url),
        title: item.title || getTitleFromUrl(item.url),
        canonical: item.canonical || '',
      };
    });
  }

  // Plain text list of URLs
  return content
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .map(url => ({
      url,
      slug: getSlugFromUrl(url),
      title: getTitleFromUrl(url),
    }));
}

export async function generateRedirectMap({ sourcePath, destPath, overridesPath }) {
  // Read Source Manifest
  const sourceContent = fs.readFileSync(sourcePath, 'utf8');
  const sourceData = JSON.parse(sourceContent);

  let sourcePages = [];
  if (Array.isArray(sourceData)) {
    sourcePages = sourceData;
  } else if (sourceData && Array.isArray(sourceData.pages)) {
    sourcePages = sourceData.pages;
  } else if (sourceData && Array.isArray(sourceData.urls)) {
    sourcePages = sourceData.urls;
  } else {
    throw new Error('Unsupported source manifest format. Expected JSON array or object with "pages"/"urls".');
  }

  // Parse destination files
  const destinations = destPath ? parseDestinationFile(destPath) : [];

  // Parse manual overrides
  const overrides = overridesPath ? parseOverrides(overridesPath) : {};

  // Pre-normalize destinations and build lookup indexes for fast O(1) matching
  const pathIndex = new Map();
  const slugIndex = new Map();
  const titleIndex = new Map();

  const normalizedDestinations = destinations.map(dest => {
    const normPath = normalizePath(dest.url);
    const item = { ...dest, normalizedPath: normPath };

    if (normPath) {
      let list = pathIndex.get(normPath);
      if (!list) {
        list = [];
        pathIndex.set(normPath, list);
      }
      list.push(item);
    }

    if (dest.slug) {
      let list = slugIndex.get(dest.slug);
      if (!list) {
        list = [];
        slugIndex.set(dest.slug, list);
      }
      list.push(item);
    }

    const cleanedTitle = cleanTitle(dest.title);
    if (cleanedTitle) {
      let list = titleIndex.get(cleanedTitle);
      if (!list) {
        list = [];
        titleIndex.set(cleanedTitle, list);
      }
      list.push(item);
    }

    return item;
  });

  const redirectMap = [];
  const stats = {
    total: 0,
    exact: 0,
    confident: 0,
    ambiguous: 0,
    missing: 0,
    overrides: 0,
  };

  for (const page of sourcePages) {
    const rawUrl = page.url || page;
    if (!rawUrl) continue;

    stats.total++;
    const normSource = normalizePath(rawUrl);

    // Check manual override first
    if (overrides[normSource]) {
      const over = overrides[normSource];
      let target = over.target;
      let classification = 'exact';
      let strategy = 'override';
      let notes = 'Manual override applied';
      let status = over.status || 301;

      if (target === 'gone' || target === '410') {
        target = '';
        status = 410;
        classification = 'exact';
        notes = 'Manual override: Content is gone (410)';
      }

      redirectMap.push({
        source: rawUrl,
        target,
        status,
        classification,
        strategy,
        notes,
      });
      stats.overrides++;
      if (classification === 'exact') stats.exact++;
      else stats.confident++;
      continue;
    }

    // Prepare source page info for matching
    const title = page.title || getTitleFromUrl(rawUrl);
    const slug = page.slug || getSlugFromUrl(rawUrl);
    const canonical = page.canonical || '';

    // Collect matching candidates via fast O(1) index lookups, maintaining strategy priority per destination
    const candidates = [];
    const matchedDestsForPage = new Set();

    const exactMatches = pathIndex.get(normSource);
    if (exactMatches) {
      for (let k = 0; k < exactMatches.length; k++) {
        const dest = exactMatches[k];
        candidates.push({ dest, score: 100, strategy: 'exact_path' });
        matchedDestsForPage.add(dest);
      }
    }

    if (canonical) {
      const normCanonical = normalizePath(canonical);
      if (normCanonical) {
        const canonicalMatches = pathIndex.get(normCanonical);
        if (canonicalMatches) {
          for (let k = 0; k < canonicalMatches.length; k++) {
            const dest = canonicalMatches[k];
            if (!matchedDestsForPage.has(dest)) {
              candidates.push({ dest, score: 90, strategy: 'canonical' });
              matchedDestsForPage.add(dest);
            }
          }
        }
      }
    }

    if (slug) {
      const slugMatches = slugIndex.get(slug);
      if (slugMatches) {
        for (let k = 0; k < slugMatches.length; k++) {
          const dest = slugMatches[k];
          if (!matchedDestsForPage.has(dest)) {
            candidates.push({ dest, score: 80, strategy: 'slug' });
            matchedDestsForPage.add(dest);
          }
        }
      }
    }

    const normTitle = cleanTitle(title);
    if (normTitle) {
      const titleMatches = titleIndex.get(normTitle);
      if (titleMatches) {
        for (let k = 0; k < titleMatches.length; k++) {
          const dest = titleMatches[k];
          if (!matchedDestsForPage.has(dest)) {
            candidates.push({ dest, score: 70, strategy: 'title' });
            matchedDestsForPage.add(dest);
          }
        }
      }
    }

    // If no destination file is provided or no candidates found, classify as missing
    if (candidates.length === 0) {
      redirectMap.push({
        source: rawUrl,
        target: '',
        status: 404,
        classification: 'missing',
        strategy: 'none',
        notes: destPath ? 'No match found in destination sitemap' : 'No destination sitemap/manifest provided',
      });
      stats.missing++;
      continue;
    }

    // De-duplicate candidates by destination URL, keeping highest score for each destination
    const uniqueDestsMap = new Map();
    for (const cand of candidates) {
      const existing = uniqueDestsMap.get(cand.dest.url);
      if (!existing || cand.score > existing.score) {
        uniqueDestsMap.set(cand.dest.url, cand);
      }
    }
    const uniqueCandidates = Array.from(uniqueDestsMap.values());

    // Sort unique candidates by score descending
    uniqueCandidates.sort((a, b) => b.score - a.score);

    const highestScore = uniqueCandidates[0].score;
    const topCandidates = uniqueCandidates.filter(c => c.score === highestScore);

    if (topCandidates.length > 1) {
      // Multiple candidates match with the same highest score -> Ambiguous!
      // Collect the matched candidate URLs
      const matchUrls = topCandidates.map(c => c.dest.url);
      redirectMap.push({
        source: rawUrl,
        target: '',
        status: 301,
        classification: 'ambiguous',
        strategy: topCandidates[0].strategy,
        notes: `Ambiguous match. Multiple destinations with same highest strategy score: ${matchUrls.join(', ')}`,
      });
      stats.ambiguous++;
    } else {
      // Single best candidate
      const best = topCandidates[0];
      const classification = best.score === 100 ? 'exact' : 'confident';

      // If exact path matches and target URL matches source URL exactly (meaning path didn't change and hosts are same),
      // we can still output it but classify it as exact.
      redirectMap.push({
        source: rawUrl,
        target: best.dest.url,
        status: 301,
        classification,
        strategy: best.strategy,
        notes: `Matched via ${best.strategy}`,
      });

      if (classification === 'exact') {
        stats.exact++;
      } else {
        stats.confident++;
      }
    }
  }

  // Generate CSV string representation of redirect map
  const csvRows = [
    ['source', 'target', 'status', 'classification', 'strategy', 'notes']
  ];
  for (const entry of redirectMap) {
    csvRows.push([
      entry.source,
      entry.target,
      entry.status,
      entry.classification,
      entry.strategy,
      entry.notes
    ]);
  }
  const csv = stringifyCSV(csvRows);

  return {
    map: redirectMap,
    csv,
    stats,
  };
}
