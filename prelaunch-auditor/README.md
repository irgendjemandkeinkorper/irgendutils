# @irgendutils/prelaunch-auditor

Run an opinionated pre-launch audit across SEO, accessibility, performance, security headers, content readiness, and WordPress hygiene. It produces a single pass/fail scorecard with prioritized fixes, helping you answer the question: *"Is this site objectively ready to go live?"* before flipping DNS.

Unlike `@irgendutils/wp-qa-playwright` (which compares a staging site against a template/reference site to spot visual or structural drift), the **Pre-launch Auditor** evaluates a single site against absolute, industry-standard quality criteria.

## Install

Requires Node.js ≥ 18 ESM, Playwright, and Lighthouse.

```sh
cd prelaunch-auditor
npm install
npx playwright install chromium   # needed for rendering & accessibility scans
npm link                          # optional: `audit` on PATH
# or just: node src/cli.js
```

## Quickstart

1. **Configure:** Copy `audit.config.example.yml` to `audit.config.yml` and `budgets.example.json` to `budgets.json`.
2. **Audit a Staging Site:** Run all audits on your staging site:
   ```sh
   audit run https://staging.example.com
   ```
3. **Audit Production Site:** Specifying environment as `production` raises severity for stray staging indicators or `noindex` blocks:
   ```sh
   audit run https://example.com --env production
   ```

## Commands

```sh
audit run <url>                       # run all checks against target URL
audit run <url> --only seo,a11y        # run only specified check modules
audit run <url> --budget budgets.json # specify custom Lighthouse thresholds
```

Useful flags:
- `-c, --config <file>`: path to config file (default: `audit.config.yml`)
- `--env <staging|production>`: set the audit target environment (default: `staging`)
- `--only <modules>`: comma-separated list of checks to run
- `--budget <file>`: path to a Lighthouse performance budgets file

## The Auditing Modules

The auditor is organized into 6 distinct check modules:

### 1. Search Engine Optimization (`seo.js`)
- Validates the presence of a unique `<title>` and `<meta description>`.
- Asserts exactly one `<h1>` tag per page.
- Verifies a valid `<link rel="canonical">` element is present.
- Checks `robots.txt` and `sitemap.xml` availability and contents.
- **Environment Aware:** Asserts that `noindex` is present on `staging` (Warning if missing) but flags it as a **Blocker** on `production` (preventing accidental launch indexing blocks).

### 2. Accessibility (`a11y.js`)
- Runs **axe-core** checks inside the Playwright headless browser.
- Validates image alternative text (`alt` attributes).
- Asserts clean form labeling, accessible color contrast ratios, properly scoped DOM landmarks, focus ring visibility, and document language declaration (`<html lang="...">`).

### 3. Performance (`perf.js`)
- Runs **Lighthouse** audits inside Playwright across both Mobile and Desktop viewports.
- Aggregates metrics (using the median of 3–5 runs to account for network noise).
- Compares core metrics (LCP, CLS, TBT, and total Performance Score) against your configured `budgets.json` thresholds.
- Evaluates image compression formats (WebP/AVIF recommendation) and caching header setup.

### 4. Security (`security.js`)
- Confirms HTTPS is enforced and checks SSL certificate validity.
- Audits HTTP security headers (HSTS, Content-Security-Policy, X-Frame-Options, X-Content-Type-Options).
- Checks for **mixed content** (HTTP assets loaded on an HTTPS page).
- Verifies that sensitive WordPress vectors are not publicly exposed (e.g. WP version in meta tags, `readme.html` presence, or unblocked directory listings).

### 5. Content Readiness (`content.js`)
- Scans pages for placeholder texts such as `Lorem Ipsum`, "Sample Page", or "Hello World".
- Crawls internal anchors to find broken links or unresolved assets (404s).
- Confirms a standard favicon is linked.
- Hits a fake URL (e.g. `/this-page-does-not-exist-123`) to ensure a styled, user-friendly 404 page is returned with a 404 status.

### 6. Analytics & Consent (`analytics.js`)
- Confirms tracking tags (Google Analytics, Google Tag Manager, Meta Pixel, etc.) are present and properly formatted.
- Checks for GDPR/CCPA cookie consent CMP script wiring.
- Allows you to explicitly waive these checks in `audit.config.yml` if analytics are not configured yet.

## Configuration

### `audit.config.yml`
```yaml
environment: staging     # staging | production
runs: 3                 # number of Lighthouse performance runs to average
max_pages: 25           # maximum pages to crawl starting from homepage & sitemap

analytics:
  waived: false         # true if site does not require tracking tags
consent:
  required: false       # true if cookie consent banners are legally required
```

### `budgets.json`
```json
{
  "mobile": {
    "lcp_ms": 2500,
    "cls": 0.1,
    "tbt_ms": 300,
    "performance_score": 0.8
  },
  "desktop": {
    "lcp_ms": 1800,
    "cls": 0.1,
    "tbt_ms": 200,
    "performance_score": 0.9
  }
}
```

## Scorecard Report

Every run generates two files:
- `scorecard.html`: A responsive, human-friendly HTML dashboard listing findings. **Blockers** (critical launch-stopping issues) are prominently displayed at the top with clear, actionable remediation notes.
- `scorecard.json`: A structured representation of findings, ideal for CI/CD assertions.

## Gate a Launch (CI/CD)

The auditor exits with a non-zero exit code if any **Blocker** is present, making it suitable to gate deployment pipelines:

```sh
audit run https://staging.site.com --env production || {
  echo "Pre-launch audit failed with critical blockers! Launch aborted."
  exit 1
}
```

## Gotchas

- **Performance Noise:** Server-response latency and runner machine constraints can cause Lighthouse performance scores to drift between runs. The auditor aggregates multiple runs (default 3) and evaluates the *median* metrics to ensure stability.
- **WAF Blocks:** Aggressive Web Application Firewalls (such as Cloudflare Under Attack mode) can challenge or rate-limit the auditor. Ensure the auditing runner's IP address is allowlisted prior to running the test.
