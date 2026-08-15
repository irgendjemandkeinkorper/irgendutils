#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { runPipeline } from './orchestrator.js';

function printHelp() {
  console.log(`pipeline — End-to-End Site Migration Pipeline Orchestrator

Usage:
  pipeline run <manifest.yml> [options]

Subcommands:
  run                         Run the entire migration workflow end to end

Options:
  --stage <list>              Comma-separated subset of stages to run:
                              scrape, convert, vault, spinup, qa, audit
  --dry-run                   Show execution plan and mutations, write nothing
  --resume                    Resume pipeline from the first failed stage,
                              skipping successfully completed stages
  --rerun-from-stage <stage>  Rerun starting from the specified stage,
                              skipping previous completed stages
  --apply                     Actually mutate. Without it, stateful/destructive
                              stages run in dry-run/preview mode.
  --offline                   Run completely offline using local fake/fixture adapters
  -h, --help                  Show this help

Exit codes:
  0 = all stages passed
  1 = at least one stage failed
  2 = usage or configuration error
`);
}

function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h') || args.length === 0) {
    printHelp();
    process.exit(0);
  }

  const cmd = args[0];
  if (cmd !== 'run') {
    console.error(`Error: Unknown subcommand "${cmd}"`);
    printHelp();
    process.exit(2);
  }

  let manifestPath = null;
  const options = {
    stages: [],
    dryRun: false,
    resume: false,
    rerunFromStage: null,
    apply: false,
    offline: false
  };

  // Parse arguments
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--resume') {
      options.resume = true;
    } else if (arg === '--apply') {
      options.apply = true;
    } else if (arg === '--offline') {
      options.offline = true;
    } else if (arg === '--stage') {
      if (!args[i + 1]) {
        console.error('Error: --stage requires a list of stages');
        process.exit(2);
      }
      options.stages = args[i + 1].split(',').map(s => s.trim());
      i++;
    } else if (arg === '--rerun-from-stage') {
      if (!args[i + 1]) {
        console.error('Error: --rerun-from-stage requires a stage name');
        process.exit(2);
      }
      options.rerunFromStage = args[i + 1].trim();
      i++;
    } else if (!arg.startsWith('-')) {
      manifestPath = arg;
    } else {
      console.error(`Error: Unknown option "${arg}"`);
      printHelp();
      process.exit(2);
    }
  }

  if (!manifestPath) {
    console.error('Error: Missing required manifest.yml file');
    printHelp();
    process.exit(2);
  }

  if (!fs.existsSync(manifestPath)) {
    console.error(`Error: Manifest file not found: ${manifestPath}`);
    process.exit(2);
  }

  try {
    const result = runPipeline(manifestPath, options);
    if (result.success) {
      process.exit(0);
    } else {
      process.exit(1);
    }
  } catch (err) {
    console.error(`\x1b[31mError running pipeline: ${err.message}\x1b[0m`);
    process.exit(2);
  }
}

main();
