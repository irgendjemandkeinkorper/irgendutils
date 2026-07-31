#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn, execSync, spawnSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MANIFEST_PATH = path.join(__dirname, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));

const [,, command, ...args] = process.argv;

// Helper to check if file/folder exists
function exists(p) {
  return fs.existsSync(p);
}

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
};

// Formatting functions
function printHeader(text) {
  console.log(`\n${colors.bright}${colors.blue}=== ${text} ===${colors.reset}\n`);
}

function printSuccess(text) {
  console.log(`  ${colors.green}✔ ${text}${colors.reset}`);
}

function printWarning(text) {
  console.log(`  ${colors.yellow}⚠ ${text}${colors.reset}`);
}

function printError(text) {
  console.log(`  ${colors.red}✘ ${text}${colors.reset}`);
}

function printInfo(text) {
  console.log(`  ${colors.dim}i ${text}${colors.reset}`);
}

// Check if a global CLI binary is available
function hasGlobalBinary(bin) {
  try {
    const cmd = process.platform === 'win32' ? `where ${bin}` : `which ${bin}`;
    execSync(cmd, { stdio: 'ignore' });
    return true;
  } catch (e) {
    return false;
  }
}

// List Command
function runList() {
  printHeader('IRGENDUTILS UTILITY CATALOG');

  // Find longest fields for nice padding
  let maxName = 10;
  let maxMaturity = 10;
  let maxSafety = 10;

  Object.values(manifest).forEach(app => {
    if (app.name.length > maxName) maxName = app.name.length;
    if (app.maturity.length > maxMaturity) maxMaturity = app.maturity.length;
    if (app.safety.length > maxSafety) maxSafety = app.safety.length;
  });

  // Print Table Header
  const headName = 'Utility'.padEnd(maxName);
  const headMaturity = 'Maturity'.padEnd(maxMaturity);
  const headSafety = 'Safety Mode'.padEnd(maxSafety);
  const headPurpose = 'Purpose & Stack';

  console.log(`${colors.bright}${headName} │ ${headMaturity} │ ${headSafety} │ ${headPurpose}${colors.reset}`);
  console.log(`${'─'.repeat(maxName)}─┼─${'─'.repeat(maxMaturity)}─┼─${'─'.repeat(maxSafety)}─┼─${'─'.repeat(30)}`);

  Object.values(manifest).sort((a, b) => a.name.localeCompare(b.name)).forEach(app => {
    const nameColor = app.maturity.includes('Spec-only') ? colors.dim : colors.green;
    const nameStr = `${nameColor}${app.name.padEnd(maxName)}${colors.reset}`;

    let matColor = colors.reset;
    if (app.maturity === 'Production') matColor = colors.bright + colors.cyan;
    if (app.maturity === 'Beta') matColor = colors.yellow;
    if (app.maturity.includes('Spec-only')) matColor = colors.dim;
    const matStr = `${matColor}${app.maturity.padEnd(maxMaturity)}${colors.reset}`;

    let safeColor = colors.reset;
    if (app.safety === 'Read-only') safeColor = colors.green;
    if (app.safety.includes('Dry-run')) safeColor = colors.yellow;
    const safeStr = `${safeColor}${app.safety.padEnd(maxSafety)}${colors.reset}`;

    const stackStr = `${colors.dim}[${app.stack.join(', ')}]${colors.reset}`;

    console.log(`${nameStr} │ ${matStr} │ ${safeStr} │ ${app.purpose} ${stackStr}`);
    if (app.commands && app.commands.length > 0) {
      console.log(`${' '.repeat(maxName)} │ ${' '.repeat(maxMaturity)} │ ${' '.repeat(maxSafety)} │   ${colors.dim}Commands: ${app.commands.join(' | ')}${colors.reset}`);
    }
    console.log(`${colors.dim}${'-'.repeat(maxName + maxMaturity + maxSafety + 8)}${colors.reset}`);
  });

  console.log(`\nRun ${colors.bright}npm run doctor${colors.reset} to check configuration and prerequisites.`);
  console.log(`Run ${colors.bright}npm run run <app> -- [args]${colors.reset} to execute a utility.`);
}

// Doctor Command
function runDoctor() {
  printHeader('IRGENDUTILS DIAGNOSTIC HEALTH CHECK');

  // Verify Global Environment first
  console.log(`${colors.bright}Global System Environment:${colors.reset}`);

  const nodeVersion = process.version;
  printSuccess(`Node.js version: ${nodeVersion}`);

  const hasGit = hasGlobalBinary('git');
  if (hasGit) {
    printSuccess('Git binary is available');
  } else {
    printWarning('Git binary not found in PATH');
  }

  const hasNpm = hasGlobalBinary('npm');
  if (hasNpm) {
    printSuccess('npm binary is available');
  } else {
    printError('npm binary not found in PATH');
  }

  const globals = ['wp', 'ssh', 'mysql', 'composer'];
  globals.forEach(g => {
    const present = hasGlobalBinary(g);
    if (present) {
      printSuccess(`Global CLI: '${g}' is available`);
    } else {
      printInfo(`Global CLI: '${g}' is NOT available (may be needed for some WP/DB apps)`);
    }
  });

  console.log('');

  // Diagnostic checklist per application
  let warningsCount = 0;
  let errorsCount = 0;

  Object.values(manifest).sort((a, b) => a.name.localeCompare(b.name)).forEach(app => {
    const appPath = path.join(process.cwd(), app.name);

    console.log(`${colors.bright}${colors.cyan}${app.name}${colors.reset} [${app.maturity}]`);

    if (!exists(appPath)) {
      printWarning(`App directory '${app.name}' does not exist on disk.`);
      warningsCount++;
      console.log('');
      return;
    }

    const pkgPath = path.join(appPath, 'package.json');
    const hasPkg = exists(pkgPath);

    if (hasPkg) {
      // Check node_modules
      const nmPath = path.join(appPath, 'node_modules');
      if (exists(nmPath)) {
        printSuccess('Dependencies: Installed');
      } else {
        printWarning(`Dependencies: Missing. Run 'npm install --prefix ${app.name}'`);
        warningsCount++;
      }
    } else if (app.name !== 'quick-issue' && app.name !== 'site-migration-scraper') {
      printInfo('No package.json found (static or non-Node utility)');
    } else {
      printInfo('Static browser or spec-only utility');
    }

    // Check .env
    const envExamplePath = path.join(appPath, '.env.example');
    if (exists(envExamplePath)) {
      const envPath = path.join(appPath, '.env');
      if (exists(envPath)) {
        printSuccess('Environment: .env file configured');
      } else {
        printWarning(`Environment: .env is missing. Copy .env.example and fill in variables for '${app.name}'`);
        warningsCount++;
      }
    }

    // Check config files
    try {
      const files = fs.readdirSync(appPath);
      const examples = files.filter(f => f.includes('example') && (f.endsWith('.yml') || f.endsWith('.yaml') || f.endsWith('.json')));
      examples.forEach(ex => {
        const realFile = ex.replace('example.', '').replace('.example', '');
        const realPath = path.join(appPath, realFile);
        if (exists(realPath)) {
          printSuccess(`Configuration: '${realFile}' exists`);
        } else {
          printWarning(`Configuration: '${realFile}' is missing. Copy from '${ex}'`);
          warningsCount++;
        }
      });
    } catch(e) {}

    // Verify app-specific required global binaries
    if (app.prerequisites) {
      app.prerequisites.forEach(prereq => {
        if (prereq === 'node' || prereq === '.env' || prereq === 'config.yml' || prereq.endsWith('.yml')) {
          return;
        }
        const hasPrereq = hasGlobalBinary(prereq);
        if (hasPrereq) {
          printSuccess(`Required CLI tool: '${prereq}' is available`);
        } else {
          printWarning(`Required CLI tool: '${prereq}' is NOT found in PATH but is needed for this utility.`);
          warningsCount++;
        }
      });
    }

    console.log('');
  });

  printHeader('DIAGNOSTICS SUMMARY');
  console.log(`Total checks completed across ${Object.keys(manifest).length} utilities.`);
  if (errorsCount === 0 && warningsCount === 0) {
    console.log(`${colors.green}✔ All systems green! Everything is fully configured and ready.${colors.reset}\n`);
  } else {
    console.log(`${colors.yellow}⚠ Found ${warningsCount} warnings/suggestions. Follow the steps above to resolve them.${colors.reset}\n`);
  }
}

// Test Command
function runTest(targetApp) {
  printHeader('IRGENDUTILS AGGREGATE TEST RUNNER');

  const targets = [];
  if (targetApp && targetApp !== 'all') {
    if (!manifest[targetApp]) {
      printError(`Unknown app: ${targetApp}`);
      process.exit(1);
    }
    targets.push(targetApp);
  } else {
    // Collect all apps with package.json and a valid non-placeholder test script
    Object.keys(manifest).forEach(dir => {
      const pkgPath = path.join(process.cwd(), dir, 'package.json');
      if (exists(pkgPath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
          if (pkg.scripts && pkg.scripts.test && pkg.scripts.test !== "echo 'Add tests here'") {
            targets.push(dir);
          }
        } catch(e) {}
      }
    });
  }

  if (targets.length === 0) {
    printWarning('No testable utilities found.');
    process.exit(0);
  }

  console.log(`Executing tests in: ${targets.join(', ')}\n`);

  const results = [];
  let overallFailed = false;

  targets.forEach(dir => {
    console.log(`${colors.bright}${colors.blue}>>> Running tests in '${dir}'...${colors.reset}`);

    const child = spawnSync('npm', ['test', '--prefix', dir], {
      stdio: 'inherit',
      shell: true
    });

    const success = child.status === 0;
    if (!success) {
      overallFailed = true;
    }
    results.push({ dir, success, status: child.status });
    console.log('');
  });

  printHeader('AGGREGATE TEST SUMMARY');
  results.forEach(res => {
    if (res.success) {
      printSuccess(`[PASS] ${res.dir}`);
    } else {
      printError(`[FAIL] ${res.dir} (exit code: ${res.status})`);
    }
  });

  console.log('');
  if (overallFailed) {
    printError('One or more test suites failed.');
    process.exit(1);
  } else {
    printSuccess('All executed test suites passed successfully!');
    process.exit(0);
  }
}

// Run Command
function runExec(appName, appArgs) {
  if (!appName) {
    printError('Usage: npm run run <app> -- [args]');
    process.exit(1);
  }

  const app = manifest[appName];
  if (!app) {
    printError(`Unknown utility application: ${appName}`);
    process.exit(1);
  }

  const appPath = path.join(process.cwd(), appName);
  if (!exists(appPath)) {
    printError(`App directory '${appName}' does not exist on disk.`);
    process.exit(1);
  }

  // Resolve executable script from package.json bin configuration, or fall back to src/cli.js
  let binScript = 'src/cli.js';
  const pkgPath = path.join(appPath, 'package.json');
  if (exists(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.bin) {
        if (typeof pkg.bin === 'string') {
          binScript = pkg.bin;
        } else if (typeof pkg.bin === 'object') {
          binScript = Object.values(pkg.bin)[0];
        }
      }
    } catch (e) {}
  }

  const absoluteBinPath = path.resolve(appPath, binScript);
  if (!exists(absoluteBinPath)) {
    printError(`Executable script not found at path: ${absoluteBinPath}`);
    process.exit(1);
  }

  console.log(`${colors.bright}${colors.cyan}>>> Forwarding execution to: node ${appName}/${binScript} ${appArgs.join(' ')}${colors.reset}\n`);

  // Spawn the child process directly under Node.js, setting cwd to the app's directory
  // so relative paths, .env loader, config.yml reading work seamlessly!
  const child = spawn('node', [absoluteBinPath, ...appArgs], {
    cwd: appPath,
    stdio: 'inherit'
  });

  child.on('close', (code) => {
    process.exit(code === null ? 1 : code);
  });
}

// Route commands
if (command === 'list') {
  runList();
} else if (command === 'doctor') {
  runDoctor();
} else if (command === 'test') {
  const target = args[0] || 'all';
  runTest(target);
} else if (command === 'run') {
  const appName = args[0];
  const appArgs = args.slice(1);
  runExec(appName, appArgs);
} else {
  console.log(`Unknown command: ${command || '(none)'}`);
  console.log('Available commands: list, doctor, test, run');
  process.exit(1);
}
