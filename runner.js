#!/usr/bin/env node
// root runner — Coordinates and runs irgendutils packages, ensuring contract compliance.

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const UTILITIES = [
  { id: 'wp-subdomain-spinup', name: '@irgendutils/wp-subdomain-spinup', path: 'wp-subdomain-spinup', bin: 'src/cli.js', migrated: true },
  { id: 'wp-qa-playwright', name: '@irgendutils/wp-qa-playwright', path: 'wp-qa-playwright', bin: 'src/cli.js', migrated: true },
  { id: 'prelaunch-auditor', name: '@irgendutils/prelaunch-auditor', path: 'prelaunch-auditor', bin: 'src/cli.js', migrated: true },
  { id: 'image-convert', name: '@irgendutils/image-convert', path: 'image-convert', bin: 'src/cli.js', migrated: true },
  { id: 'post-deploy-smoke-test', name: '@irgendutils/post-deploy-smoke-test', path: 'post-deploy-smoke-test', bin: 'src/cli.js', migrated: true },
  // Pending migration:
  { id: 'html-to-gutenberg', name: '@irgendutils/html-to-gutenberg', path: 'html-to-gutenberg', bin: 'src/cli.js', migrated: false },
  { id: 'obsidian-vault-forge', name: '@irgendutils/obsidian-vault-forge', path: 'obsidian-vault-forge', bin: 'src/cli.js', migrated: false },
  { id: 'site-migration-scraper', name: '@irgendutils/site-migration-scraper', path: 'site-migration-scraper', bin: 'src/cli.js', migrated: false },
  { id: 'sql-slow-query-analyzer', name: '@irgendutils/sql-slow-query-analyzer', path: 'sql-slow-query-analyzer', bin: 'src/cli.js', migrated: false },
  { id: 'wp-charset-collation-checker', name: '@irgendutils/wp-charset-collation-checker', path: 'wp-charset-collation-checker', bin: 'src/cli.js', migrated: false },
  { id: 'backup-restore-verifier', name: '@irgendutils/backup-restore-verifier', path: 'backup-restore-verifier', bin: 'src/cli.js', migrated: false },
  { id: 'dns-ssl-uptime-monitor', name: '@irgendutils/dns-ssl-uptime-monitor', path: 'dns-ssl-uptime-monitor', bin: 'src/cli.js', migrated: false },
  { id: 'dependency-update-digest', name: '@irgendutils/dependency-update-digest', path: 'dependency-update-digest', bin: 'src/cli.js', migrated: false },
  { id: 'secrets-env-audit', name: '@irgendutils/secrets-env-audit', path: 'secrets-env-audit', bin: 'src/cli.js', migrated: false },
  { id: 'repo-template', name: '@irgendutils/repo-template', path: 'repo-template', bin: 'src/create-repo.js', migrated: false },
];

const HELP = `irgendutils — Monorepo runner and contract orchestrator

Usage:
  node runner.js list                           List all utilities and migration status
  node runner.js run <utility> [args...]        Execute a utility and output standardized JSON
  node runner.js generate-checklist             Re-generate MIGRATION_CHECKLIST.md

Options:
  -h, --help                                    Show this help
`;

export function redactSecrets(obj, env = process.env) {
  const secretValues = new Set();
  const secretKeys = ['PASSWORD', 'SECRET', 'TOKEN', 'KEY', 'AUTH', 'PASS', 'PWD'];
  for (const [key, value] of Object.entries(env)) {
    if (value && value.length >= 3) {
      if (secretKeys.some(k => key.toUpperCase().includes(k))) {
        if (!key.toUpperCase().includes('PATH') && !key.toUpperCase().includes('FILE') && !key.toUpperCase().includes('DIR')) {
          secretValues.add(value);
        }
      }
    }
  }

  const redactString = (str) => {
    if (typeof str !== 'string') return str;
    let current = str;
    for (const secret of secretValues) {
      current = current.split(secret).join('[REDACTED]');
    }
    current = current.replace(/(https?:\/\/)([^:@]+):([^@]+)(@)/g, '$1$2:[REDACTED]$4');
    return current;
  };

  const redactValue = (val) => {
    if (val === null || val === undefined) return val;
    if (typeof val === 'string') return redactString(val);
    if (Array.isArray(val)) return val.map(redactValue);
    if (typeof val === 'object') {
      const copy = {};
      for (const [k, v] of Object.entries(val)) {
        if (secretKeys.some(key => k.toUpperCase().includes(key)) && typeof v === 'string') {
          copy[k] = '[REDACTED]';
        } else {
          copy[k] = redactValue(v);
        }
      }
      return copy;
    }
    return val;
  };

  return redactValue(obj);
}

function validateEnvelope(json) {
  const required = [
    'contract_version',
    'tool',
    'status',
    'summary',
    'results',
    'warnings',
    'errors',
    'timing',
    'artifacts'
  ];
  for (const field of required) {
    if (!(field in json)) {
      throw new Error(`Envelope missing required field: "${field}"`);
    }
  }
  if (json.contract_version !== '1.0.0') {
    throw new Error(`Envelope has invalid contract_version: "${json.contract_version}" (expected "1.0.0")`);
  }
  if (!json.tool || typeof json.tool !== 'object' || !json.tool.name || !json.tool.version) {
    throw new Error('Envelope has invalid or missing "tool" metadata object');
  }
  if (!['success', 'failure', 'error'].includes(json.status)) {
    throw new Error(`Envelope has invalid status: "${json.status}"`);
  }
  if (!json.summary || typeof json.summary !== 'object' || json.summary.total === undefined || json.summary.passed === undefined || json.summary.failed === undefined || json.summary.warnings === undefined) {
    throw new Error('Envelope has invalid or missing "summary" object');
  }
  if (!Array.isArray(json.results)) {
    throw new Error('Envelope field "results" must be an array');
  }
  if (!Array.isArray(json.warnings) || !Array.isArray(json.errors) || !Array.isArray(json.artifacts)) {
    throw new Error('Envelope fields "warnings", "errors", and "artifacts" must be arrays');
  }
  if (!json.timing || typeof json.timing !== 'object' || !('start_time' in json.timing) || !('end_time' in json.timing) || !('duration_ms' in json.timing)) {
    throw new Error('Envelope has invalid or missing "timing" object');
  }
}

function buildErrorEnvelope(toolName, errMessage, exitCode) {
  return redactSecrets({
    contract_version: '1.0.0',
    tool: {
      name: toolName,
      version: '1.0.0',
    },
    status: 'error',
    summary: {
      total: 0,
      passed: 0,
      failed: 0,
      warnings: 0,
    },
    results: [],
    warnings: [],
    errors: [errMessage],
    timing: {
      start_time: new Date().toISOString(),
      end_time: new Date().toISOString(),
      duration_ms: 0,
    },
    artifacts: [],
  });
}

function listUtilities() {
  console.log('irgendutils — Monorepo CLI Status Checklist\n');
  console.log(
    `  ${'Utility'.padEnd(35)} ${'Status'.padEnd(12)} ${'Path'}`,
  );
  console.log('  ' + '-'.repeat(75));
  for (const util of UTILITIES) {
    const status = util.migrated ? '✓ Migrated' : '  Pending';
    console.log(`  ${util.name.padEnd(35)} ${status.padEnd(12)} ${util.path}`);
  }
}

function generateChecklist() {
  const lines = [
    '# Irgendutils CLI Migration Checklist',
    '',
    'This is a generated checklist detailing the standardization progress of JSON outputs, error envelopes, and exit codes across the irgendutils monorepo CLI utilities.',
    '',
    '## Migration Status Summary',
    '',
  ];

  const migratedCount = UTILITIES.filter(u => u.migrated).length;
  const totalCount = UTILITIES.length;
  lines.push(`- **Total Utilities:** ${totalCount}`);
  lines.push(`- **Standardized:** ${migratedCount} / ${totalCount} (${Math.round((migratedCount / totalCount) * 100)}%)`);
  lines.push('');
  lines.push('## Standardized CLI Contract Details');
  lines.push('');
  lines.push('Every standardized utility must support a `--json` parameter. When `--json` is active:');
  lines.push('1. **Exit Codes:**');
  lines.push('   - `0` (Success): all checks passed / operations succeeded.');
  lines.push('   - `1` (Gate Failure): check failed or blocker triggered.');
  lines.push('   - `2` (Invalid Input / Usage / Configuration).');
  lines.push('   - `3` (Missing Dependency / Environment).');
  lines.push('   - `4` (Unexpected Crash / Fatal error).');
  lines.push('2. **Silence on stdout:** All logs, progress messages, and non-JSON output go to stderr (`console.error`). Only the standardized JSON contract goes to stdout.');
  lines.push('3. **Redaction:** Secrets loaded from the environment or config are redacted from output.');
  lines.push('');
  lines.push('## CLI Registry Checklists');
  lines.push('');

  for (const util of UTILITIES) {
    const checkbox = util.migrated ? '[x]' : '[ ]';
    lines.push(`### ${checkbox} ${util.name}`);
    lines.push('');
    lines.push(`- **Path:** \`${util.path}/\``);
    lines.push(`- **Compliance Status:** ${util.migrated ? 'Standardized and Contract Compliant' : 'Pending Migration'}`);
    if (util.migrated) {
      lines.push('- **Features Implemented:** Standardized envelope, correct exit codes, stdout isolation, secret redaction, contract unit test.');
    } else {
      lines.push('- **TODO:** Add `--json`, route progress to stderr, implement standard `buildResultsJson` envelope, ensure standardized exit codes.');
    }
    lines.push('');
  }

  const outPath = resolve(__dirname, 'MIGRATION_CHECKLIST.md');
  writeFileSync(outPath, lines.join('\n') + '\n');
  console.log(`Generated migration checklist at: ${outPath}`);
}

function runUtility(id, args) {
  const util = UTILITIES.find(u => u.id === id || u.name === id);
  if (!util) {
    console.error(`Error: unknown utility "${id}"`);
    process.exit(2);
  }

  const cliPath = resolve(__dirname, util.path, util.bin);
  if (!existsSync(cliPath)) {
    console.error(`Error: utility executable not found at ${cliPath}`);
    process.exit(3);
  }

  const startTime = new Date().toISOString();
  const startMs = Date.now();

  const child = spawnSync('node', [cliPath, ...args], {
    encoding: 'utf8',
    env: process.env,
  });

  const durationMs = Date.now() - startMs;
  const endTime = new Date().toISOString();

  // If stderr has content, write to our own stderr
  if (child.stderr) {
    process.stderr.write(child.stderr);
  }

  let finalEnvelope;
  if (child.status !== 0 && child.status !== 1) {
    // This is a usage, dependency, or unexpected failure.
    // Let's print a standardized error envelope to stdout.
    const errText = child.stderr || child.stdout || 'Process exited with error';
    finalEnvelope = buildErrorEnvelope(util.name, errText.trim(), child.status ?? 4);
    console.log(JSON.stringify(finalEnvelope, null, 2));
    process.exit(child.status ?? 4);
  }

  // Parse stdout as JSON
  try {
    const rawStdout = child.stdout ? child.stdout.trim() : '';
    // If output is not valid JSON, or contains non-JSON output, try to extract the JSON block
    let parsed;
    try {
      parsed = JSON.parse(rawStdout);
    } catch {
      const match = rawStdout.match(/\{[\s\S]*\}/);
      if (match) {
        parsed = JSON.parse(match[0]);
      } else {
        throw new Error(`Output is not valid JSON: ${rawStdout.substring(0, 200)}`);
      }
    }

    // Redact secrets
    finalEnvelope = redactSecrets(parsed);

    // Add standard timing fields if not present
    if (!finalEnvelope.timing) {
      finalEnvelope.timing = {
        start_time: startTime,
        end_time: endTime,
        duration_ms: durationMs,
      };
    }

    validateEnvelope(finalEnvelope);
    console.log(JSON.stringify(finalEnvelope, null, 2));
    process.exit(child.status);
  } catch (err) {
    // Output could not be parsed, or envelope is malformed
    finalEnvelope = buildErrorEnvelope(util.name, `Failed to parse standard contract JSON: ${err.message}. Raw output:\n${child.stdout}`, 4);
    console.log(JSON.stringify(finalEnvelope, null, 2));
    process.exit(4);
  }
}

function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '-h' || command === '--help') {
    console.log(HELP);
    process.exit(command ? 0 : 2);
  }

  if (command === 'list') {
    listUtilities();
    process.exit(0);
  } else if (command === 'generate-checklist') {
    generateChecklist();
    process.exit(0);
  } else if (command === 'run') {
    const utilId = args[1];
    if (!utilId) {
      console.error('Error: specify utility name (e.g., node runner.js run prelaunch-auditor)');
      process.exit(2);
    }
    runUtility(utilId, args.slice(2));
  } else {
    console.error(`Error: unknown command "${command}"`);
    console.log(HELP);
    process.exit(2);
  }
}

main();
