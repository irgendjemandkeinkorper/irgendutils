import fs from 'node:fs';
import path from 'node:path';
import { getRelativePath, resolveRulesForPath } from './config.js';

// Documented Finding Priority Scores and Severities
export const FINDING_TYPES = {
  ORPHAN: {
    type: 'orphan_page',
    label: 'Orphan Page',
    severity: 'Critical',
    score: 100,
    description: 'The page has no inbound links from other crawled pages (and is not a configured entry page).',
  },
  DUPLICATE_TITLE: {
    type: 'duplicate_title',
    label: 'Duplicate Title',
    severity: 'High',
    score: 80,
    description: 'Multiple pages have the exact same title.',
  },
  DUPLICATE_DESC: {
    type: 'duplicate_description',
    label: 'Duplicate Meta Description',
    severity: 'Medium-High',
    score: 60,
    description: 'Multiple pages have the exact same meta description.',
  },
  STALE_CONTENT: {
    type: 'stale_content',
    label: 'Stale Content',
    severity: 'Medium',
    score: 50,
    description: 'The content is older than the configured freshness threshold.',
  },
  MULTIPLE_H1: {
    type: 'multiple_h1s',
    label: 'Multiple H1s',
    severity: 'Medium',
    score: 40,
    description: 'The page has more than one H1 heading.',
  },
  MISSING_H1: {
    type: 'missing_h1',
    label: 'Missing H1',
    severity: 'Medium',
    score: 40,
    description: 'The page has no H1 headings.',
  },
  THIN_CONTENT: {
    type: 'thin_content',
    label: 'Thin Content',
    severity: 'Medium-Low',
    score: 30,
    description: 'Word count of the core substantive content is below the configured threshold.',
  },
  NON_SEQUENTIAL_HEADINGS: {
    type: 'non_sequential_headings',
    label: 'Non-Sequential Headings',
    severity: 'Low',
    score: 20,
    description: 'Headings skip hierarchy levels (e.g., H2 followed directly by H4).',
  },
  NO_HEADINGS: {
    type: 'no_headings',
    label: 'No Headings',
    severity: 'Low',
    score: 20,
    description: 'The page has no headings.',
  },
  UNKNOWN_DATE: {
    type: 'unknown_date',
    label: 'Unknown Date',
    severity: 'Low',
    score: 10,
    description: 'The last modified or publish date is missing or invalid.',
  },
};

/** Helper to walk files recursively */
function walk(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      walk(filePath, fileList);
    } else {
      fileList.push(filePath);
    }
  }
  return fileList;
}

/**
 * Loads pages from a scraper output directory or a single JSON manifest file.
 */
export function loadSourceData(targetPath) {
  if (!fs.existsSync(targetPath)) {
    throw new Error(`Target path "${targetPath}" does not exist.`);
  }

  const stat = fs.statSync(targetPath);

  if (stat.isDirectory()) {
    // Look for pages/ directory
    const pagesDir = path.join(targetPath, 'pages');
    if (!fs.existsSync(pagesDir)) {
      // If there's no pages/ directory, check if the directory contains a sitemap manifest directly
      const manifestPath = path.join(targetPath, 'manifest.json');
      if (fs.existsSync(manifestPath)) {
        return loadSingleManifest(manifestPath);
      }
      throw new Error(`Target directory "${targetPath}" contains neither a "pages/" directory nor a "manifest.json" file.`);
    }

    const allFiles = walk(pagesDir);
    const metaFiles = allFiles.filter((f) => path.basename(f) === 'meta.json');
    const pages = [];

    for (const metaFile of metaFiles) {
      const pageDir = path.dirname(metaFile);
      let meta = {};
      try {
        meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
      } catch (e) {
        // Skip unparseable meta files or treat as empty
      }

      // Read substantive content from content.md, fallback to content.html
      let content = '';
      const mdPath = path.join(pageDir, 'content.md');
      const htmlPath = path.join(pageDir, 'content.html');

      if (fs.existsSync(mdPath)) {
        content = fs.readFileSync(mdPath, 'utf8');
      } else if (fs.existsSync(htmlPath)) {
        content = fs.readFileSync(htmlPath, 'utf8');
      }

      pages.push({
        url: meta.url || meta.canonical || `/${path.relative(pagesDir, pageDir)}`,
        title: meta.title || '',
        metaDesc: meta.metaDesc || meta.description || meta.meta_description || '',
        date: meta.date || meta.modified || meta.publishDate || meta.published || null,
        headings: meta.headings || (meta.h1 ? [`H1: ${meta.h1}`] : []),
        content,
        links: meta.links || meta.outbound || [],
        slug: meta.slug || path.basename(pageDir),
      });
    }

    return pages;
  } else {
    // It's a single file
    return loadSingleManifest(targetPath);
  }
}

function loadSingleManifest(filePath) {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    let rawPages = [];

    if (Array.isArray(raw)) {
      rawPages = raw;
    } else if (raw && Array.isArray(raw.pages)) {
      rawPages = raw.pages;
    } else if (raw && Array.isArray(raw.urls)) {
      // Simple sitemap list of URLs
      rawPages = raw.urls.map((u) => (typeof u === 'string' ? { url: u } : u));
    } else {
      throw new Error('Manifest JSON must be an array of pages or an object containing a "pages" array.');
    }

    return rawPages.map((p, idx) => ({
      url: p.url || p.canonical || `/page-${idx}`,
      title: p.title || '',
      metaDesc: p.metaDesc || p.description || p.meta_description || '',
      date: p.date || p.modified || p.publishDate || p.published || null,
      headings: p.headings || (p.h1 ? [`H1: ${p.h1}`] : []),
      content: p.content || '',
      links: p.links || p.outbound || [],
      slug: p.slug || `page-${idx}`,
    }));
  } catch (err) {
    throw new Error(`Failed to load manifest file from "${filePath}": ${err.message}`);
  }
}

/**
 * Normalizes text for comparison (e.g. for duplicates check)
 */
function normalizeText(text) {
  return String(text || '').trim().toLowerCase();
}

/**
 * Clean HTML tags and count words using a fast single-pass character scan loop.
 * Avoids regex allocation and string slicing in hot loops.
 */
export function calculateWordCount(content) {
  if (!content) return 0;
  let count = 0;
  let inTag = false;
  let inWord = false;
  for (let i = 0; i < content.length; i++) {
    const ch = content.charCodeAt(i);
    if (ch === 60 /* < */) {
      inTag = true;
      inWord = false;
    } else if (ch === 62 /* > */) {
      inTag = false;
    } else if (!inTag) {
      // Handles standard ASCII whitespace (ch <= 32) and non-breaking space (160)
      if (ch <= 32 || ch === 160 || ch === 5760 || (ch >= 8192 && ch <= 8202) || ch === 8239 || ch === 8287 || ch === 12288) {
        inWord = false;
      } else {
        if (!inWord) {
          count++;
          inWord = true;
        }
      }
    }
  }
  return count;
}

/**
 * Checks a heading structure list
 * Returns array of { type, message } findings
 */
export function checkHeadingStructure(headings) {
  const findings = [];
  if (!headings || headings.length === 0) {
    findings.push({
      ...FINDING_TYPES.NO_HEADINGS,
      message: 'Page has no headings.',
    });
    return findings;
  }

  // Find H1s
  // Expected headings format: "H1: Main Title" or "H2: Section" etc.
  const h1s = headings.filter((h) => /^h1\b/i.test(String(h).trim()));

  if (h1s.length === 0) {
    findings.push({
      ...FINDING_TYPES.MISSING_H1,
      message: 'Page is missing an H1 heading.',
    });
  } else if (h1s.length > 1) {
    findings.push({
      ...FINDING_TYPES.MULTIPLE_H1,
      message: `Page has multiple H1 headings (${h1s.length} found).`,
    });
  }

  // Non-sequential hierarchy check
  let lastLevel = 0;
  for (const heading of headings) {
    const match = String(heading).trim().match(/^h([1-6])\b/i);
    if (match) {
      const level = parseInt(match[1], 10);
      if (lastLevel > 0 && level > lastLevel + 1) {
        findings.push({
          ...FINDING_TYPES.NON_SEQUENTIAL_HEADINGS,
          message: `Heading hierarchy skipped from H${lastLevel} to H${level} ("${heading}").`,
        });
      }
      lastLevel = level;
    }
  }

  return findings;
}

/**
 * Runs freshness, thin-content, heading, duplicate, and orphan checks
 */
export function runAnalysis(pages, config, options = {}) {
  const currentDate = options.currentDate ? new Date(options.currentDate) : new Date();
  if (isNaN(currentDate.getTime())) {
    throw new Error(`Invalid current date override: "${options.currentDate}"`);
  }

  // 1. Exclude any pages that are configured to be excluded and prepare results
  const pageResults = [];
  for (const page of pages) {
    const relativePath = getRelativePath(page.url);
    const rules = resolveRulesForPath(config, page.url);
    if (!rules.exclude) {
      pageResults.push({
        url: page.url,
        relativePath,
        title: page.title,
        metaDesc: page.metaDesc,
        date: page.date,
        wordCount: calculateWordCount(page.content),
        headings: page.headings,
        links: page.links,
        rules, // Keep resolved rules for references
        findings: [],
        priorityScore: 0,
      });
    }
  }

  // Map of normalized relative paths to indices for easy lookup
  const pathMap = new Map();
  pageResults.forEach((p, idx) => {
    pathMap.set(p.relativePath, idx);
  });

  // 2. Freshness & Thin Content checks
  for (const p of pageResults) {
    const rules = p.rules;

    // Freshness check
    if (!p.date) {
      p.findings.push({
        ...FINDING_TYPES.UNKNOWN_DATE,
        message: 'Last modified/publish date is unknown.',
      });
    } else {
      const parsedDate = new Date(p.date);
      if (isNaN(parsedDate.getTime())) {
        p.findings.push({
          ...FINDING_TYPES.UNKNOWN_DATE,
          message: `Last modified/publish date is invalid or unreliable: "${p.date}".`,
        });
      } else {
        const ageInDays = (currentDate - parsedDate) / (1000 * 60 * 60 * 24);
        if (ageInDays > rules.freshness_threshold_days) {
          p.findings.push({
            ...FINDING_TYPES.STALE_CONTENT,
            message: `Content is stale. Last updated ${Math.floor(ageInDays)} days ago (threshold: ${rules.freshness_threshold_days} days).`,
            date: p.date,
            ageInDays: Math.floor(ageInDays),
          });
        }
      }
    }

    // Thin content check
    if (p.wordCount < rules.thin_content_threshold) {
      p.findings.push({
        ...FINDING_TYPES.THIN_CONTENT,
        message: `Content is thin (${p.wordCount} words, threshold: ${rules.thin_content_threshold} words).`,
        wordCount: p.wordCount,
      });
    }

    // Headings checks
    const headingFindings = checkHeadingStructure(p.headings);
    p.findings.push(...headingFindings);
  }

  // 3. Duplicate metadata checks (Titles & Meta Descriptions)
  const titleGroups = new Map();
  const descGroups = new Map();

  pageResults.forEach((p, idx) => {
    const normTitle = normalizeText(p.title);
    if (normTitle) {
      if (!titleGroups.has(normTitle)) titleGroups.set(normTitle, []);
      titleGroups.get(normTitle).push(idx);
    }

    const normDesc = normalizeText(p.metaDesc);
    if (normDesc) {
      if (!descGroups.has(normDesc)) descGroups.set(normDesc, []);
      descGroups.get(normDesc).push(idx);
    }
  });

  // Flag duplicate titles
  for (const [title, indices] of titleGroups.entries()) {
    if (indices.length > 1) {
      for (const idx of indices) {
        const p = pageResults[idx];
        p.findings.push({
          ...FINDING_TYPES.DUPLICATE_TITLE,
          message: `Duplicate title found with ${indices.length - 1} other page(s): "${p.title}"`,
          duplicateValue: p.title,
          sharedWith: indices.filter((i) => i !== idx).map((i) => pageResults[i].url),
        });
      }
    }
  }

  // Flag duplicate descriptions
  for (const [desc, indices] of descGroups.entries()) {
    if (indices.length > 1) {
      for (const idx of indices) {
        const p = pageResults[idx];
        p.findings.push({
          ...FINDING_TYPES.DUPLICATE_DESC,
          message: `Duplicate meta description found with ${indices.length - 1} other page(s): "${p.metaDesc}"`,
          duplicateValue: p.metaDesc,
          sharedWith: indices.filter((i) => i !== idx).map((i) => pageResults[i].url),
        });
      }
    }
  }

  // 4. Internal Link Graph & Orphan Page check
  // Initialize inbound links sets
  const inboundLinksMap = new Map();
  pageResults.forEach((p) => {
    inboundLinksMap.set(p.relativePath, new Set());
  });

  // Populate inbound link sets
  for (const p of pageResults) {
    const links = p.links || [];
    for (const link of links) {
      const relLink = getRelativePath(link);
      // If the link points to an active page on the same site
      if (pathMap.has(relLink) && relLink !== p.relativePath) {
        inboundLinksMap.get(relLink).add(p.relativePath);
      }
    }
  }

  // Check orphans
  for (const p of pageResults) {
    const inLinks = inboundLinksMap.get(p.relativePath);
    p.inboundCount = inLinks.size;
    p.inboundLinks = Array.from(inLinks);

    // If no inbound links, check if it's a configured entry page
    if (inLinks.size === 0) {
      const rules = p.rules;
      const entryPagesNormalized = (rules.entry_pages || []).map(getRelativePath);

      if (!entryPagesNormalized.includes(p.relativePath)) {
        p.findings.push({
          ...FINDING_TYPES.ORPHAN,
          message: 'Page is an orphan with no internal inbound links.',
        });
      }
    }
  }

  // 5. Priority score calculation & sorting
  for (const p of pageResults) {
    // Sum active finding scores
    p.priorityScore = p.findings.reduce((sum, f) => sum + f.score, 0);

    // Sort findings inside page by score descending
    p.findings.sort((a, b) => b.score - a.score);

    // Clean up temporary internal rules reference
    delete p.rules;
  }

  // Sort page results by priority score descending, then relative path alphabetically
  pageResults.sort((a, b) => {
    if (b.priorityScore !== a.priorityScore) {
      return b.priorityScore - a.priorityScore;
    }
    return a.relativePath.localeCompare(b.relativePath);
  });

  // Collect all findings at a global level for reports
  const allFindings = [];
  for (const p of pageResults) {
    for (const f of p.findings) {
      allFindings.push({
        url: p.url,
        relativePath: p.relativePath,
        pageTitle: p.title,
        ...f,
      });
    }
  }

  return {
    pages: pageResults,
    findings: allFindings,
    summary: {
      totalPages: pageResults.length,
      totalFindings: allFindings.length,
      criticalCount: allFindings.filter((f) => f.severity === 'Critical').length,
      highCount: allFindings.filter((f) => f.severity === 'High').length,
      mediumHighCount: allFindings.filter((f) => f.severity === 'Medium-High').length,
      mediumCount: allFindings.filter((f) => f.severity === 'Medium').length,
      mediumLowCount: allFindings.filter((f) => f.severity === 'Medium-Low').length,
      lowCount: allFindings.filter((f) => f.severity === 'Low').length,
    },
  };
}
