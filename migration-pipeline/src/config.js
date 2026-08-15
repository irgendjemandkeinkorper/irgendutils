import fs from 'fs';
import path from 'path';
import { parseYaml, stringifyYaml } from './yaml.js';

export function loadPipelineManifest(filepath) {
  if (!fs.existsSync(filepath)) {
    throw new Error(`Pipeline manifest not found: ${filepath}`);
  }
  const content = fs.readFileSync(filepath, 'utf8');
  const manifest = parseYaml(content);

  // Set top-level defaults
  manifest.name = manifest.name || 'Site Migration Project';
  manifest.slug = manifest.slug || manifest.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  manifest.client = manifest.client || 'Client';
  manifest.status = manifest.status || 'active';
  manifest.site_urls = manifest.site_urls || [];

  // Scraper Defaults
  manifest.scraper = manifest.scraper || {};
  manifest.scraper.start_urls = manifest.scraper.start_urls || manifest.site_urls;
  manifest.scraper.allow_domains = manifest.scraper.allow_domains || [];
  manifest.scraper.max_pages = manifest.scraper.max_pages || 50;
  manifest.scraper.max_depth = manifest.scraper.max_depth || 3;
  manifest.scraper.content_selector = manifest.scraper.content_selector || 'main, article, .entry-content';
  manifest.scraper.strip_selectors = manifest.scraper.strip_selectors || ['nav', 'footer', '.ads', '.cookie'];
  manifest.scraper.output_dir = manifest.scraper.output_dir || `./out/${manifest.slug}/scraped`;

  // Vault Forge Defaults
  manifest.vault_forge = manifest.vault_forge || {};
  manifest.vault_forge.output_dir = manifest.vault_forge.output_dir || `./out/${manifest.slug}/vaults`;
  manifest.vault_forge.stakeholders = manifest.vault_forge.stakeholders || [];
  manifest.vault_forge.links = manifest.vault_forge.links || {};
  manifest.vault_forge.tags = manifest.vault_forge.tags || ['wordpress', 'migration'];

  // Subdomain Spinup Defaults
  manifest.subdomain_spinup = manifest.subdomain_spinup || {};
  manifest.subdomain_spinup.mode = manifest.subdomain_spinup.mode || 'multisite';
  manifest.subdomain_spinup.subdomain = manifest.subdomain_spinup.subdomain || `${manifest.slug}-staging`;
  manifest.subdomain_spinup.network_url = manifest.subdomain_spinup.network_url || 'https://example.com';
  manifest.subdomain_spinup.wp_cli_ssh = manifest.subdomain_spinup.wp_cli_ssh || '';
  manifest.subdomain_spinup.template_slug = manifest.subdomain_spinup.template_slug || '_template';
  manifest.subdomain_spinup.rest = manifest.subdomain_spinup.rest || {};
  manifest.subdomain_spinup.rest.base_url = manifest.subdomain_spinup.rest.base_url || `https://${manifest.subdomain_spinup.subdomain}.example.com`;
  manifest.subdomain_spinup.rest.user = manifest.subdomain_spinup.rest.user || 'automation';
  manifest.subdomain_spinup.rest.app_password_env = manifest.subdomain_spinup.rest.app_password_env || 'WP_APP_PASSWORD';
  manifest.subdomain_spinup.dns = manifest.subdomain_spinup.dns || {};
  manifest.subdomain_spinup.dns.provider = manifest.subdomain_spinup.dns.provider || 'manual';
  manifest.subdomain_spinup.dns.zone = manifest.subdomain_spinup.dns.zone || 'example.com';

  // HTML to Gutenberg Defaults
  manifest.html_to_gutenberg = manifest.html_to_gutenberg || {};
  manifest.html_to_gutenberg.push = manifest.html_to_gutenberg.push !== undefined ? manifest.html_to_gutenberg.push : false;
  manifest.html_to_gutenberg.status = manifest.html_to_gutenberg.status || 'draft';
  manifest.html_to_gutenberg.media = manifest.html_to_gutenberg.media || 'link';
  manifest.html_to_gutenberg.strict = manifest.html_to_gutenberg.strict !== undefined ? manifest.html_to_gutenberg.strict : false;

  // QA Playwright Defaults
  manifest.qa = manifest.qa || {};
  manifest.qa.template_url = manifest.qa.template_url || 'https://_template.example.com/';
  manifest.qa.target_url = manifest.qa.target_url || manifest.subdomain_spinup.rest.base_url;
  manifest.qa.viewports = manifest.qa.viewports || [360, 768, 1280];
  manifest.qa.thresholds = manifest.qa.thresholds || {};
  manifest.qa.thresholds.pixel_diff_pct = manifest.qa.thresholds.pixel_diff_pct !== undefined ? manifest.qa.thresholds.pixel_diff_pct : 0.15;
  manifest.qa.thresholds.max_broken_links = manifest.qa.thresholds.max_broken_links !== undefined ? manifest.qa.thresholds.max_broken_links : 0;
  manifest.qa.checks = manifest.qa.checks || ['visual', 'links', 'console', 'headings', 'responsive', 'wp_hygiene'];
  manifest.qa.auth = manifest.qa.auth || {};
  manifest.qa.auth.user = manifest.qa.auth.user || 'automation';
  manifest.qa.auth.app_password_env = manifest.qa.auth.app_password_env || 'WP_APP_PASSWORD';
  manifest.qa.mask_selectors = manifest.qa.mask_selectors || [];
  manifest.qa.consent_selector = manifest.qa.consent_selector || '';
  manifest.qa.baseline_dir = manifest.qa.baseline_dir || `./out/${manifest.slug}/qa-baseline`;
  manifest.qa.report_dir = manifest.qa.report_dir || `./out/${manifest.slug}/qa-report`;
  manifest.qa.adapter = manifest.qa.adapter || 'playwright';
  manifest.qa.fixture = manifest.qa.fixture || '';

  // Auditor Defaults
  manifest.auditor = manifest.auditor || {};
  manifest.auditor.environment = manifest.auditor.environment || 'staging';
  manifest.auditor.runs = manifest.auditor.runs || 3;
  manifest.auditor.max_pages = manifest.auditor.max_pages || 25;
  manifest.auditor.analytics = manifest.auditor.analytics || {};
  manifest.auditor.analytics.waived = manifest.auditor.analytics.waived !== undefined ? manifest.auditor.analytics.waived : false;
  manifest.auditor.consent = manifest.auditor.consent || {};
  manifest.auditor.consent.required = manifest.auditor.consent.required !== undefined ? manifest.auditor.consent.required : false;
  manifest.auditor.report_dir = manifest.auditor.report_dir || `./out/${manifest.slug}/audit-report`;

  return manifest;
}

export function generateSubConfigs(manifest, baseOutputDir) {
  const configsDir = path.join(baseOutputDir, 'configs');
  fs.mkdirSync(configsDir, { recursive: true });

  const paths = {};

  // 1. Scraper config (scrape.yml)
  const scraperConfig = {
    start_urls: manifest.scraper.start_urls,
    allow_domains: manifest.scraper.allow_domains,
    max_pages: manifest.scraper.max_pages,
    max_depth: manifest.scraper.max_depth,
    content_selector: manifest.scraper.content_selector,
    strip_selectors: manifest.scraper.strip_selectors,
    output: manifest.scraper.output_dir,
    formats: ['html', 'markdown', 'json']
  };
  paths.scraper = path.join(configsDir, 'scrape.yml');
  fs.writeFileSync(paths.scraper, stringifyYaml(scraperConfig));

  // 2. Vault config (vault-project.yml)
  const vaultConfig = {
    name: manifest.name,
    client: manifest.client,
    slug: manifest.slug,
    status: manifest.status,
    site_urls: manifest.site_urls,
    stakeholders: manifest.vault_forge.stakeholders,
    links: manifest.vault_forge.links,
    tags: manifest.vault_forge.tags
  };
  paths.vault = path.join(configsDir, 'vault-project.yml');
  fs.writeFileSync(paths.vault, stringifyYaml(vaultConfig));

  // 3. Spinup config (spinup.config.yml)
  const spinupConfig = {
    mode: manifest.subdomain_spinup.mode,
    network_url: manifest.subdomain_spinup.network_url,
    wp_cli_ssh: manifest.subdomain_spinup.wp_cli_ssh,
    template_slug: manifest.subdomain_spinup.template_slug,
    rest: {
      base_url: manifest.subdomain_spinup.rest.base_url,
      user: manifest.subdomain_spinup.rest.user,
      app_password_env: manifest.subdomain_spinup.rest.app_password_env
    },
    dns: {
      provider: manifest.subdomain_spinup.dns.provider,
      zone: manifest.subdomain_spinup.dns.zone
    }
  };
  paths.spinup = path.join(configsDir, 'spinup.config.yml');
  fs.writeFileSync(paths.spinup, stringifyYaml(spinupConfig));

  // 4. QA config (qa.config.yml)
  const qaConfig = {
    template_url: manifest.qa.template_url,
    targets: [manifest.qa.target_url],
    viewports: manifest.qa.viewports,
    thresholds: {
      pixel_diff_pct: manifest.qa.thresholds.pixel_diff_pct,
      max_broken_links: manifest.qa.thresholds.max_broken_links
    },
    checks: manifest.qa.checks,
    auth: {
      user: manifest.qa.auth.user,
      app_password_env: manifest.qa.auth.app_password_env
    },
    mask_selectors: manifest.qa.mask_selectors,
    consent_selector: manifest.qa.consent_selector,
    baseline_dir: manifest.qa.baseline_dir,
    report_dir: manifest.qa.report_dir,
    adapter: manifest.qa.adapter,
    fixture: manifest.qa.fixture
  };
  paths.qa = path.join(configsDir, 'qa.config.yml');
  fs.writeFileSync(paths.qa, stringifyYaml(qaConfig));

  // 5. Auditor config (audit.config.yml)
  const auditConfig = {
    environment: manifest.auditor.environment,
    runs: manifest.auditor.runs,
    max_pages: manifest.auditor.max_pages,
    analytics: {
      waived: manifest.auditor.analytics.waived
    },
    consent: {
      required: manifest.auditor.consent.required
    }
  };
  paths.audit = path.join(configsDir, 'audit.config.yml');
  fs.writeFileSync(paths.audit, stringifyYaml(auditConfig));

  // 6. html-to-gutenberg config (h2g.config.yml)
  const h2gConfig = {
    wp: {
      mode: 'rest',
      base_url: manifest.subdomain_spinup.rest.base_url
    },
    media: {
      mode: manifest.html_to_gutenberg.media,
      base: manifest.scraper.start_urls[0] || 'https://example.com'
    },
    convert: {
      strict: manifest.html_to_gutenberg.strict
    }
  };
  paths.h2g = path.join(configsDir, 'h2g.config.yml');
  fs.writeFileSync(paths.h2g, stringifyYaml(h2gConfig));

  return paths;
}
