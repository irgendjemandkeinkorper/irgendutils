import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { loadConfig } from './config.js';

// --- Robots.txt Parser ---
export class RobotsParser {
  constructor(userAgent = 'SiteMigrationScraper') {
    this.userAgent = userAgent;
    this.disallowedPaths = [];
  }

  parse(content) {
    const lines = content.split(/\r?\n/);
    let activeUserAgentMatch = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const colonIdx = trimmed.indexOf(':');
      if (colonIdx === -1) continue;

      const key = trimmed.slice(0, colonIdx).trim().toLowerCase();
      const value = trimmed.slice(colonIdx + 1).trim();

      if (key === 'user-agent') {
        const ua = value.toLowerCase();
        activeUserAgentMatch = (ua === '*' || ua.includes(this.userAgent.toLowerCase()));
      } else if (activeUserAgentMatch) {
        if (key === 'disallow') {
          if (value) {
            this.disallowedPaths.push(value);
          }
        }
      }
    }
  }

  isAllowed(urlPath) {
    for (const disallow of this.disallowedPaths) {
      // Standard prefix match
      const prefix = disallow.replace(/\*$/, '');
      if (urlPath.startsWith(prefix)) {
        return false;
      }
    }
    return true;
  }
}

// --- Utility Helpers ---

/**
 * Normalizes a URL path to a deterministic page slug.
 * e.g. "/about-us/" -> "about-us"
 * e.g. "/" -> "index"
 */
export function getPageSlug(urlPath) {
  let pathname = urlPath;
  try {
    const url = new URL(urlPath);
    pathname = url.pathname;
  } catch {
    // Already a pathname
  }

  let cleaned = pathname.replace(/^\/+|\/+$/g, '');
  if (cleaned === '') {
    return 'index';
  }

  const segments = cleaned.split('/').map(seg => {
    return seg
      .toLowerCase()
      .replace(/[^a-z0-9-_.]/g, '-') // Allow dots (e.g. file extensions) but strip others
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '');
  }).filter(Boolean);

  if (segments.length === 0) {
    return 'index';
  }
  return segments.join('/');
}

/**
 * Normalizes a URL to a relative path starting with '/'
 */
export function getRelativePath(urlStr, startUrl) {
  try {
    const url = new URL(urlStr);
    let rel = url.pathname;
    if (url.search) {
      rel += url.search;
    }
    return rel === '' ? '/' : rel;
  } catch {
    return urlStr;
  }
}

/**
 * In-browser content isolation, boilerplate stripping, element normalization,
 * metadata extraction, and HTML-to-Markdown compilation.
 */
async function extractPageData(page, config) {
  return await page.evaluate((cfg) => {
    const { content_selector, strip_selectors } = cfg;

    // 1. Isolate content
    const selectors = content_selector.split(',').map(s => s.trim());
    let mainEl = null;
    for (const sel of selectors) {
      mainEl = document.querySelector(sel);
      if (mainEl) break;
    }

    // Fallbacks
    if (!mainEl) {
      const fallbacks = ['article', 'main', '.entry-content', '.post-content', '#content', '.content', 'body'];
      for (const fb of fallbacks) {
        mainEl = document.querySelector(fb);
        if (mainEl) break;
      }
    }

    if (!mainEl) {
      throw new Error('Could not find main content element');
    }

    // Clone element to prevent mutating the actual active page DOM
    const clone = mainEl.cloneNode(true);

    // 2. Strip boilerplate selectors
    for (const stripSel of strip_selectors) {
      clone.querySelectorAll(stripSel).forEach(el => el.remove());
    }

    // Helper to resolve URLs absolutely
    const resolveUrl = (href) => {
      if (!href) return '';
      try {
        return new URL(href, document.baseURI).href;
      } catch {
        return href;
      }
    };

    // 3. Normalize link and image URLs inside the clone
    clone.querySelectorAll('a').forEach(a => {
      const absolute = resolveUrl(a.getAttribute('href'));
      if (absolute) {
        a.setAttribute('href', absolute);
      }
    });

    clone.querySelectorAll('img').forEach(img => {
      const absolute = resolveUrl(img.getAttribute('src'));
      if (absolute) {
        img.setAttribute('src', absolute);
      }
    });

    // 4. In-Browser HTML-to-Markdown Serializer
    function nodeToMarkdown(node) {
      if (node.nodeType === 3) { // Text node
        return node.textContent;
      }
      if (node.nodeType !== 1) { // Not element
        return '';
      }

      const tagName = node.tagName.toLowerCase();

      // Handle code block pre separately to preserve internal structure/whitespace
      if (tagName === 'pre') {
        return `\n\`\`\`\n${node.textContent.trim()}\n\`\`\`\n`;
      }

      let childrenMarkdown = '';
      for (const child of node.childNodes) {
        childrenMarkdown += nodeToMarkdown(child);
      }

      switch (tagName) {
        case 'h1': return `\n# ${childrenMarkdown.trim()}\n`;
        case 'h2': return `\n## ${childrenMarkdown.trim()}\n`;
        case 'h3': return `\n### ${childrenMarkdown.trim()}\n`;
        case 'h4': return `\n#### ${childrenMarkdown.trim()}\n`;
        case 'h5': return `\n##### ${childrenMarkdown.trim()}\n`;
        case 'h6': return `\n###### ${childrenMarkdown.trim()}\n`;
        case 'p': return `\n${childrenMarkdown.trim()}\n\n`;
        case 'br': return `\n`;
        case 'strong':
        case 'b': return `**${childrenMarkdown}**`;
        case 'em':
        case 'i': return `*${childrenMarkdown}*`;
        case 'code': return `\`${childrenMarkdown}\``;
        case 'li': return `* ${childrenMarkdown.trim()}\n`;
        case 'ul': return `\n${childrenMarkdown}\n`;
        case 'ol': {
          let olMarkdown = '\n';
          let index = 1;
          for (const child of node.children) {
            if (child.tagName.toLowerCase() === 'li') {
              olMarkdown += `${index++}. ${nodeToMarkdown(child).replace(/^\*\s+/, '').trim()}\n`;
            }
          }
          return olMarkdown + '\n';
        }
        case 'a': {
          const href = node.getAttribute('href') || '';
          return `[${childrenMarkdown.trim()}](${href})`;
        }
        case 'img': {
          const src = node.getAttribute('src') || '';
          const alt = node.getAttribute('alt') || '';
          return `![${alt}](${src})`;
        }
        case 'blockquote': return `\n> ${childrenMarkdown.trim().replace(/\n/g, '\n> ')}\n`;
        case 'div':
        case 'section':
        case 'article':
        case 'main': return `\n${childrenMarkdown}\n`;
        default: return childrenMarkdown;
      }
    }

    // Convert clone element to markdown and clean up spacing
    let markdown = nodeToMarkdown(clone);
    markdown = markdown
      .replace(/\r?\n{3,}/g, '\n\n') // replace 3+ consecutive newlines with 2
      .trim();

    const cleanHtml = clone.innerHTML.trim();

    // 5. Metadata gathering
    const pageTitle = document.title || '';
    const h1El = document.querySelector('h1');
    const h1Text = h1El ? h1El.textContent.trim() : '';

    const metaDescEl = document.querySelector('meta[name="description"]');
    const metaDesc = metaDescEl ? metaDescEl.getAttribute('content') || '' : '';

    const canonicalEl = document.querySelector('link[rel="canonical"]');
    const canonical = canonicalEl ? canonicalEl.getAttribute('href') || '' : '';

    // Headings inside the main element
    const headings = [];
    clone.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(h => {
      headings.push({
        tag: h.tagName.toLowerCase(),
        text: h.textContent.trim()
      });
    });

    // Images referenced in the content
    const images = [];
    clone.querySelectorAll('img').forEach(img => {
      const src = resolveUrl(img.getAttribute('src'));
      if (src) {
        images.push({
          src,
          alt: img.getAttribute('alt') || '',
          width: img.naturalWidth || parseInt(img.getAttribute('width'), 10) || 0,
          height: img.naturalHeight || parseInt(img.getAttribute('height'), 10) || 0
        });
      }
    });

    // Outbound links from this page (we'll filter same-origin on the Node side)
    const links = [];
    clone.querySelectorAll('a').forEach(a => {
      const href = resolveUrl(a.getAttribute('href'));
      if (href) {
        links.push(href);
      }
    });

    return {
      title: pageTitle,
      h1: h1Text,
      metaDesc,
      canonical,
      headings,
      images,
      links,
      html: cleanHtml,
      markdown
    };
  }, config);
}

// --- Main Scraper Class ---
export class Scraper {
  constructor(configPath = null, cliOverrides = {}) {
    this.config = loadConfig(configPath, cliOverrides);
    this.visitedUrls = new Set();
    this.queuedUrls = [];
    this.scrapedPages = {}; // relativePath -> data
    this.errors = {}; // url -> error message
    this.redirects = {}; // relativeSource -> relativeTarget
    this.robotsParsers = {}; // domain -> RobotsParser instance
  }

  /**
   * Safe check if a domain allows a given path via robots.txt
   */
  async checkRobots(urlObj) {
    const origin = urlObj.origin;
    if (!this.robotsParsers[origin]) {
      const parser = new RobotsParser();
      try {
        const response = await fetch(`${origin}/robots.txt`);
        if (response.ok) {
          const content = await response.text();
          parser.parse(content);
        }
      } catch {
        // robots.txt missing or request failed, proceed with empty rules
      }
      this.robotsParsers[origin] = parser;
    }
    return this.robotsParsers[origin].isAllowed(urlObj.pathname);
  }

  /**
   * Filter and normalize URLs to only allow internal same-origin / allowed domains links
   */
  isUrlAllowed(urlStr) {
    try {
      const url = new URL(urlStr);
      // Check query denylist
      if (this.config.query_denylist.length > 0) {
        for (const p of this.config.query_denylist) {
          if (url.searchParams.has(p)) return false;
        }
      }
      // Check allowed domains
      return this.config.allow_domains.includes(url.hostname);
    } catch {
      return false;
    }
  }

  /**
   * Support Resumable runs: restore scraped states from existing output files
   */
  async tryResume() {
    const pagesDir = path.join(this.config.output, 'pages');
    if (!fs.existsSync(pagesDir)) return;

    console.log('Checking for previously scraped pages to resume...');
    const walkDirs = (dir) => {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          const metaPath = path.join(fullPath, 'meta.json');
          if (fs.existsSync(metaPath)) {
            try {
              const metaContent = fs.readFileSync(metaPath, 'utf8');
              const meta = JSON.parse(metaContent);
              if (meta.url) {
                const relPath = getRelativePath(meta.url, this.config.start_urls[0]);

                // Add to processed
                this.visitedUrls.add(meta.url);
                this.scrapedPages[relPath] = {
                  url: meta.url,
                  title: meta.title,
                  h1: meta.h1,
                  metaDesc: meta.metaDesc,
                  canonical: meta.canonical,
                  headings: meta.headings || [],
                  images: meta.images || [],
                  links: meta.links || [],
                  slug: meta.slug
                };
                console.log(`Resumed: ${meta.url} (loaded from disk)`);
              }
            } catch {
              // Ignore corrupt/invalid cached meta
            }
          }
          walkDirs(fullPath);
        }
      }
    };
    walkDirs(pagesDir);
  }

  /**
   * Run the crawl/scraping process
   */
  async run(singleUrl = null) {
    // 1. Initial State
    if (singleUrl) {
      this.queuedUrls.push({ url: singleUrl, depth: 0 });
    } else {
      // Try to resume first
      await this.tryResume();

      for (const u of this.config.start_urls) {
        if (!this.visitedUrls.has(u)) {
          this.queuedUrls.push({ url: u, depth: 0 });
        }
      }
    }

    if (this.queuedUrls.length === 0) {
      console.log('No new URLs to scrape.');
      await this.saveManifest();
      return;
    }

    // 2. Launch browser
    const browser = await chromium.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const browserContext = await browser.newContext({
      userAgent: 'SiteMigrationScraper/1.0 (+https://github.com/irgendutils/site-migration-scraper)'
    });

    try {
      while (this.queuedUrls.length > 0) {
        // Enforce max page cap
        const successfulCount = Object.keys(this.scrapedPages).length;
        if (!singleUrl && successfulCount >= this.config.max_pages) {
          console.log(`Reached maximum page limit of ${this.config.max_pages}. Stopping crawl.`);
          break;
        }

        const { url: currentUrl, depth } = this.queuedUrls.shift();

        if (this.visitedUrls.has(currentUrl)) {
          continue;
        }
        this.visitedUrls.add(currentUrl);

        // Check Robots.txt
        const urlObj = new URL(currentUrl);
        const allowedByRobots = await this.checkRobots(urlObj);
        if (!allowedByRobots) {
          console.warn(`Blocked by robots.txt: ${currentUrl}`);
          this.errors[currentUrl] = 'Blocked by robots.txt';
          continue;
        }

        // Apply Rate Limit Delay
        if (successfulCount > 0 && this.config.rate_limit_ms > 0) {
          await new Promise(resolve => setTimeout(resolve, this.config.rate_limit_ms));
        }

        console.log(`Scraping [depth ${depth}]: ${currentUrl}...`);
        const page = await browserContext.newPage();

        try {
          // Listen to HTTP redirects
          let responseRedirected = null;
          page.on('response', response => {
            const status = response.status();
            if (status >= 300 && status < 400) {
              const fromUrl = response.url();
              const toUrl = response.headers()['location'];
              if (toUrl) {
                const absToUrl = new URL(toUrl, fromUrl).href;
                const fromRel = getRelativePath(fromUrl, this.config.start_urls[0]);
                const toRel = getRelativePath(absToUrl, this.config.start_urls[0]);
                if (fromRel !== toRel) {
                  this.redirects[fromRel] = toRel;
                }
              }
            }
          });

          const response = await page.goto(currentUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 15000
          });

          const finalUrl = page.url();
          if (finalUrl !== currentUrl) {
            const currentRel = getRelativePath(currentUrl, this.config.start_urls[0]);
            const finalRel = getRelativePath(finalUrl, this.config.start_urls[0]);
            if (currentRel !== finalRel) {
              this.redirects[currentRel] = finalRel;
            }
          }

          if (!response || !response.ok()) {
            const status = response ? response.status() : 'No response';
            throw new Error(`Failed to load page: HTTP ${status}`);
          }

          // Extract Page Data
          const data = await extractPageData(page, this.config);
          const currentRel = getRelativePath(currentUrl, this.config.start_urls[0]);

          // Handle Canonical URLs
          if (data.canonical) {
            const absoluteCanonical = new URL(data.canonical, finalUrl).href;
            if (absoluteCanonical !== finalUrl) {
              const canonicalRel = getRelativePath(absoluteCanonical, this.config.start_urls[0]);
              this.redirects[currentRel] = canonicalRel;

              // If same allowed origin and not visited, queue canonical url and skip saving this non-canonical page
              if (this.isUrlAllowed(absoluteCanonical)) {
                if (!this.visitedUrls.has(absoluteCanonical) && !this.queuedUrls.some(q => q.url === absoluteCanonical)) {
                  this.queuedUrls.push({ url: absoluteCanonical, depth });
                }
                console.log(`Skipping duplicate non-canonical URL ${currentUrl} -> points to canonical ${absoluteCanonical}`);
                await page.close();
                continue;
              }
            }
          }

          // Add to successful crawled set
          const pageSlug = getPageSlug(currentUrl);
          this.scrapedPages[currentRel] = {
            url: currentUrl,
            title: data.title,
            h1: data.h1,
            metaDesc: data.metaDesc,
            canonical: data.canonical,
            headings: data.headings,
            images: data.images,
            links: data.links,
            slug: pageSlug
          };

          // Save page artifact outputs
          await this.savePageArtifacts(pageSlug, data);

          // Queue outbound internal links if not single page and depth limit not reached
          if (!singleUrl && depth < this.config.max_depth) {
            for (const outbound of data.links) {
              if (this.isUrlAllowed(outbound)) {
                if (!this.visitedUrls.has(outbound) && !this.queuedUrls.some(q => q.url === outbound)) {
                  this.queuedUrls.push({ url: outbound, depth: depth + 1 });
                }
              }
            }
          }

        } catch (err) {
          console.error(`Error scraping ${currentUrl}: ${err.message}`);
          this.errors[currentUrl] = err.message;
        } finally {
          await page.close();
        }

        if (singleUrl) {
          break; // Stop immediately for --single
        }
      }
    } finally {
      await browserContext.close();
      await browser.close();
    }

    // Save final manifest
    await this.saveManifest();
  }

  /**
   * Write HTML, Markdown, and metadata JSON files for a crawled page
   */
  async savePageArtifacts(pageSlug, data) {
    const pageDir = path.join(this.config.output, 'pages', pageSlug);
    fs.mkdirSync(pageDir, { recursive: true });

    if (this.config.formats.includes('html')) {
      fs.writeFileSync(path.join(pageDir, 'content.html'), data.html, 'utf8');
    }
    if (this.config.formats.includes('markdown')) {
      fs.writeFileSync(path.join(pageDir, 'content.md'), data.markdown, 'utf8');
    }
    if (this.config.formats.includes('json')) {
      const meta = {
        url: this.visitedUrls.has(this.config.start_urls[0]) ? this.config.start_urls[0] : '', // placeholder
        title: data.title,
        h1: data.h1,
        metaDesc: data.metaDesc,
        canonical: data.canonical,
        slug: pageSlug,
        headings: data.headings,
        images: data.images,
        links: data.links
      };
      // Try to backfill exact visited URL
      for (const [rel, val] of Object.entries(this.scrapedPages)) {
        if (val.slug === pageSlug) {
          meta.url = val.url;
          break;
        }
      }
      fs.writeFileSync(path.join(pageDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');
    }
  }

  /**
   * Generate and write the site-level manifest.json file
   */
  async saveManifest() {
    fs.mkdirSync(this.config.output, { recursive: true });

    // Build consolidated image inventory
    const imagesInventory = {};
    for (const [relPath, pageData] of Object.entries(this.scrapedPages)) {
      for (const img of pageData.images || []) {
        if (!imagesInventory[img.src]) {
          imagesInventory[img.src] = {
            src: img.src,
            alt: img.alt,
            width: img.width,
            height: img.height,
            pages: []
          };
        }
        if (!imagesInventory[img.src].pages.includes(relPath)) {
          imagesInventory[img.src].pages.push(relPath);
        }
        // Take maximum dimensions seen or first non-zero
        if (img.width > imagesInventory[img.src].width) imagesInventory[img.src].width = img.width;
        if (img.height > imagesInventory[img.src].height) imagesInventory[img.src].height = img.height;
        if (img.alt && !imagesInventory[img.src].alt) imagesInventory[img.src].alt = img.alt;
      }
    }

    // Build internal link graph (filtered to only internal paths)
    const linkGraph = {};
    for (const [relPath, pageData] of Object.entries(this.scrapedPages)) {
      const internalOutbound = (pageData.links || [])
        .filter(link => this.isUrlAllowed(link))
        .map(link => getRelativePath(link, this.config.start_urls[0]))
        .filter(rel => rel !== relPath); // remove self-links
      linkGraph[relPath] = Array.from(new Set(internalOutbound));
    }

    // Build and resolve Redirect Map
    // Ensure no self-redirects, no duplicate source keys, and resolve chains
    const cleanRedirects = {};
    for (const [src, target] of Object.entries(this.redirects)) {
      if (src === target) continue;

      // Trace chain to prevent intermediate hops
      let finalTarget = target;
      const seen = new Set([src, target]);
      while (this.redirects[finalTarget] && !seen.has(this.redirects[finalTarget])) {
        finalTarget = this.redirects[finalTarget];
        seen.add(finalTarget);
      }

      if (src !== finalTarget) {
        cleanRedirects[src] = finalTarget;
      }
    }

    const manifest = {
      urls: Object.keys(this.scrapedPages).sort(),
      links: linkGraph,
      images: Object.values(imagesInventory).sort((a, b) => a.src.localeCompare(b.src)),
      redirects: cleanRedirects,
      errors: this.errors
    };

    fs.writeFileSync(
      path.join(this.config.output, 'manifest.json'),
      JSON.stringify(manifest, null, 2),
      'utf8'
    );

    console.log(`Saved site manifest to ${path.join(this.config.output, 'manifest.json')}`);
  }
}
