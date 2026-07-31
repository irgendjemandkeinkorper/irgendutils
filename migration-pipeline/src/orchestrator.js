import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { loadPipelineManifest, generateSubConfigs } from './config.js';
import { loadState, saveState, RunLogger } from './runlog.js';
import { stringifyYaml } from './yaml.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const monorepoRoot = path.resolve(__dirname, '../../');

function executeCommand(cmd, args, logger) {
  logger.info(`Running: node ${cmd} ${args.join(' ')}`);

  const res = spawnSync('node', [cmd, ...args], {
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' }
  });

  if (res.stdout) {
    const lines = res.stdout.split(/\r?\n/);
    for (const line of lines) {
      if (line.trim()) logger.info(`[stdout] ${line}`);
    }
  }

  if (res.stderr) {
    const lines = res.stderr.split(/\r?\n/);
    for (const line of lines) {
      if (line.trim()) logger.warn(`[stderr] ${line}`);
    }
  }

  return res;
}

export function runPipeline(manifestPath, options = {}) {
  const manifest = loadPipelineManifest(manifestPath);
  const baseOutputDir = path.resolve(`./out/${manifest.slug}`);

  // Initialize Logger
  const logger = new RunLogger(baseOutputDir, true);
  logger.stage(`=== Starting Pipeline Run for project: ${manifest.name} ===`);

  if (options.dryRun) {
    logger.info('--- DRY RUN MODE (No mutations or commands will be executed) ---');
  }

  // Generate sub-configs
  const configs = generateSubConfigs(manifest, baseOutputDir);
  logger.info(`Generated tool configs in: ${path.join(baseOutputDir, 'configs')}`);

  // Load current pipeline state
  const state = loadState(manifest.slug, baseOutputDir);

  const allStages = ['scrape', 'convert', 'vault', 'spinup', 'qa', 'audit'];
  let stagesToRun = [...allStages];

  // Apply stage selection
  if (options.stages && options.stages.length > 0) {
    stagesToRun = allStages.filter(s => options.stages.includes(s));
  }

  // Apply rerun-from-stage
  if (options.rerunFromStage) {
    const idx = allStages.indexOf(options.rerunFromStage);
    if (idx === -1) {
      throw new Error(`Invalid rerun-from-stage: "${options.rerunFromStage}". Must be one of: ${allStages.join(', ')}`);
    }
    stagesToRun = allStages.slice(idx);
    // Reset state for these stages
    for (const stage of stagesToRun) {
      state.stages[stage].status = 'pending';
      state.stages[stage].artifacts = [];
    }
  }

  // Apply resume logic
  if (options.resume) {
    const firstFailedOrPending = allStages.find(s => {
      const st = state.stages[s];
      return st.status === 'failed' || st.status === 'pending';
    });
    if (firstFailedOrPending) {
      const idx = allStages.indexOf(firstFailedOrPending);
      stagesToRun = allStages.slice(idx);
      logger.info(`Resuming pipeline from stage: ${firstFailedOrPending}`);
    } else {
      logger.info('All stages are already completed. Nothing to resume.');
      stagesToRun = [];
    }
  }

  logger.info(`Stages planned for execution: ${stagesToRun.join(', ')}`);

  // Handle dry-run output
  if (options.dryRun) {
    logger.stage('=== DRY RUN PLAN ===');
    for (const stage of allStages) {
      const planned = stagesToRun.includes(stage) ? '[PLAN TO RUN]' : '[SKIP]';
      logger.info(`${planned} Stage: ${stage}`);
      if (stage === 'scrape') {
        logger.info(`  Mutation check: None (Read-only crawl of ${manifest.scraper.start_urls.join(', ')})`);
      } else if (stage === 'convert') {
        const isPush = manifest.html_to_gutenberg.push && options.apply;
        logger.info(`  Mutation check: ${isPush ? 'WILL PUSH blocks to WordPress' : 'Offline block conversion only (read-only)'}`);
      } else if (stage === 'vault') {
        logger.info(`  Mutation check: Writes files inside ${manifest.vault_forge.output_dir}`);
      } else if (stage === 'spinup') {
        const isApply = options.apply;
        logger.info(`  Mutation check: ${isApply ? 'WILL PROVISION subdomain: ' + manifest.subdomain_spinup.subdomain : 'Dry-run plan only (read-only)'}`);
      } else if (stage === 'qa') {
        logger.info(`  Mutation check: Read-only QA run against ${manifest.qa.target_url}`);
      } else if (stage === 'audit') {
        logger.info(`  Mutation check: Read-only audit run against ${manifest.qa.target_url}`);
      }
    }
    logger.stage('=== Dry Run Complete ===');
    return { success: true, dryRun: true };
  }

  let finalSuccess = true;

  for (const stage of allStages) {
    if (!stagesToRun.includes(stage)) {
      if (state.stages[stage].status !== 'completed') {
        state.stages[stage].status = 'skipped';
      }
      continue;
    }

    logger.stage(`>>> Stage: ${stage} <<<`);
    state.stages[stage].status = 'running';
    state.stages[stage].startedAt = new Date().toISOString();
    saveState(baseOutputDir, state);

    const startTime = Date.now();
    let stageSuccess = true;
    let artifacts = [];

    try {
      if (stage === 'scrape') {
        // Run site scraper
        const cliPath = path.join(monorepoRoot, 'site-migration-scraper/src/cli.js');
        const args = ['run', '--config', configs.scraper];
        if (options.offline) {
          args.push('--single'); // emulates safe local page-run
        }
        const res = executeCommand(cliPath, args, logger);
        if (res.status !== 0) {
          stageSuccess = false;
        } else {
          artifacts.push(path.join(manifest.scraper.output_dir, 'manifest.json'));
        }
      }
      else if (stage === 'convert') {
        // Run html-to-gutenberg conversion page-by-page
        const scrapedPagesDir = path.join(manifest.scraper.output_dir, 'pages');
        if (!fs.existsSync(scrapedPagesDir)) {
          logger.error(`Scraped pages directory does not exist: ${scrapedPagesDir}. Did 'scrape' stage run successfully?`);
          stageSuccess = false;
        } else {
          const pages = fs.readdirSync(scrapedPagesDir);
          logger.info(`Found scraped pages for conversion: ${pages.join(', ')}`);

          for (const page of pages) {
            const pageHtml = path.join(scrapedPagesDir, page, 'content.html');
            if (fs.existsSync(pageHtml)) {
              logger.info(`Converting page: ${page}`);
              const cliPath = path.join(monorepoRoot, 'html-to-gutenberg/src/cli.js');
              const args = ['convert', pageHtml, '-o', path.join(scrapedPagesDir, page, 'blocks.html'), '--config', configs.h2g];
              if (manifest.html_to_gutenberg.push && options.apply) {
                args.push('--push');
                if (manifest.html_to_gutenberg.status) {
                  args.push('--status', manifest.html_to_gutenberg.status);
                }
              }
              const res = executeCommand(cliPath, args, logger);
              if (res.status !== 0) {
                stageSuccess = false;
              } else {
                artifacts.push(path.join(scrapedPagesDir, page, 'blocks.html'));
              }
            }
          }
        }
      }
      else if (stage === 'vault') {
        // Scaffold Obsidian Vault
        const cliPath = path.join(monorepoRoot, 'obsidian-vault-forge/src/cli.js');
        const args = ['forge', configs.vault, '-o', manifest.vault_forge.output_dir];
        const res = executeCommand(cliPath, args, logger);
        if (res.status !== 0) {
          stageSuccess = false;
        } else {
          artifacts.push(path.join(manifest.vault_forge.output_dir, manifest.slug));
        }
      }
      else if (stage === 'spinup') {
        // Spinup Subdomain
        const cliPath = path.join(monorepoRoot, 'wp-subdomain-spinup/src/cli.js');
        const args = ['create', manifest.subdomain_spinup.subdomain, '--config', configs.spinup];
        if (options.apply) {
          args.push('--apply');
        }
        const res = executeCommand(cliPath, args, logger);
        if (res.status !== 0) {
          stageSuccess = false;
        } else {
          artifacts.push(`Subdomain: ${manifest.subdomain_spinup.subdomain}`);
        }
      }
      else if (stage === 'qa') {
        // Run QA playwright
        const cliPath = path.join(monorepoRoot, 'wp-qa-playwright/src/cli.js');
        const qaConfigPath = configs.qa;

        // Handle offline / fixture override
        if (options.offline) {
          // Write a specific offline config file that uses adapter: fake and fixture
          const offlineQaConfig = {
            template_url: manifest.qa.template_url,
            targets: [manifest.qa.target_url],
            viewports: manifest.qa.viewports,
            thresholds: manifest.qa.thresholds,
            checks: manifest.qa.checks,
            adapter: 'fake',
            fixture: path.join(monorepoRoot, 'wp-qa-playwright/fixtures/capture.json'),
            report_dir: manifest.qa.report_dir
          };
          const offlineConfigPath = path.join(baseOutputDir, 'configs', 'qa.offline.config.yml');
          fs.writeFileSync(offlineConfigPath, stringifyYaml(offlineQaConfig));

          const args = ['run', '--config', offlineConfigPath, '-o', manifest.qa.report_dir];
          const res = executeCommand(cliPath, args, logger);
          if (res.status !== 0) {
            stageSuccess = false;
          } else {
            artifacts.push(manifest.qa.report_dir);
          }
        } else {
          const args = ['run', '--config', qaConfigPath, '-o', manifest.qa.report_dir];
          const res = executeCommand(cliPath, args, logger);
          if (res.status !== 0) {
            stageSuccess = false;
          } else {
            artifacts.push(manifest.qa.report_dir);
          }
        }
      }
      else if (stage === 'audit') {
        // Run prelaunch audit
        const cliPath = path.join(monorepoRoot, 'prelaunch-auditor/src/cli.js');
        const args = ['run', '--config', configs.audit, '-o', manifest.auditor.report_dir];

        if (options.offline) {
          args.push('--fixture', path.join(monorepoRoot, 'prelaunch-auditor/test/fixtures/clean'));
        } else {
          args.push(manifest.qa.target_url);
        }

        const res = executeCommand(cliPath, args, logger);
        if (res.status !== 0) {
          stageSuccess = false;
        } else {
          artifacts.push(manifest.auditor.report_dir);
        }
      }
    } catch (err) {
      logger.error(`Exception during stage "${stage}": ${err.message}\n${err.stack}`);
      stageSuccess = false;
    }

    const duration = Date.now() - startTime;
    state.stages[stage].duration_ms = duration;
    state.stages[stage].completedAt = new Date().toISOString();
    state.stages[stage].artifacts = artifacts;

    if (stageSuccess) {
      state.stages[stage].status = 'completed';
      state.lastCompletedStage = stage;
      logger.info(`Stage "${stage}" completed successfully in ${duration}ms.`);
    } else {
      state.stages[stage].status = 'failed';
      saveState(baseOutputDir, state);
      finalSuccess = false;
      logger.error(`Stage "${stage}" FAILED! Aborting pipeline.`);

      // Print Teardown Guidance
      printTeardownGuidance(stage, manifest, configs, logger);
      break;
    }

    saveState(baseOutputDir, state);
  }

  // Final summary
  state.history.push({
    timestamp: new Date().toISOString(),
    success: finalSuccess,
    stages: stagesToRun
  });
  saveState(baseOutputDir, state);

  printSummary(state, manifest, logger);

  return { success: finalSuccess, state };
}

function printTeardownGuidance(stage, manifest, configs, logger) {
  logger.stage('=== Teardown / Recovery Guidance ===');
  if (stage === 'spinup') {
    logger.warn('Provisioning subdomain failed.');
    logger.info(`To tear down or retry creating the subdomain cleanly, run:`);
    logger.info(`  node wp-subdomain-spinup/src/cli.js teardown ${manifest.subdomain_spinup.subdomain} -c ${configs.spinup} --apply`);
  } else if (stage === 'convert' && manifest.html_to_gutenberg.push) {
    logger.warn('HTML to Gutenberg conversion failed during push/execution.');
    logger.info(`Draft pages may have been partially pushed to WordPress.`);
    logger.info(`Please check WP-Admin pages panel for: ${manifest.subdomain_spinup.rest.base_url}/wp-admin/edit.php?post_type=page`);
  } else {
    logger.info(`No active or automated teardown step required for stage: "${stage}". Inspect run.log for details.`);
  }
}

function printSummary(state, manifest, logger) {
  logger.stage('=== Pipeline Run Summary ===');
  let hasReports = false;

  for (const [stage, data] of Object.entries(state.stages)) {
    const duration = data.duration_ms ? `${(data.duration_ms / 1000).toFixed(2)}s` : '0s';
    const statusColor = data.status === 'completed' ? 'PASS' : data.status === 'failed' ? 'FAIL' : data.status.toUpperCase();
    logger.info(`Stage: ${stage.padEnd(8)} | Status: ${statusColor.padEnd(9)} | Duration: ${duration}`);

    if (data.status === 'completed' && data.artifacts && data.artifacts.length > 0) {
      hasReports = true;
      for (const art of data.artifacts) {
        logger.info(`  Artifact: ${art}`);
      }
    }
  }

  if (hasReports) {
    logger.stage('=== Stage Reports & Links ===');
    if (state.stages.vault.status === 'completed') {
      logger.info(`Obsidian Vault:   ${manifest.vault_forge.output_dir}/${manifest.slug}`);
    }
    if (state.stages.qa.status === 'completed') {
      logger.info(`QA HTML Report:   ${manifest.qa.report_dir}/index.html`);
    }
    if (state.stages.audit.status === 'completed') {
      logger.info(`Audit Scorecard:  ${manifest.auditor.report_dir}/scorecard.html`);
    }
  }
}
