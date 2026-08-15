import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const eventName = process.env.GITHUB_EVENT_NAME || 'workflow_dispatch';
const allPackages = [];

function containsPythonTests(dir) {
  const testDirs = ['tests', 'test'];
  return testDirs.some((testDir) => {
    const full = path.join(dir, testDir);
    return fs.existsSync(full) && fs.readdirSync(full, { withFileTypes: true }).some((entry) =>
      entry.isFile() && entry.name.endsWith('.py'));
  });
}

// Discover all packages in the repo
const entries = fs.readdirSync('.', { withFileTypes: true });
for (const entry of entries) {
  if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'bash_scripts' && entry.name !== 'vault') {
    const pkgJsonPath = path.join(entry.name, 'package.json');
    if (fs.existsSync(pkgJsonPath)) {
      try {
        const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
        const testScript = pkgJson.scripts?.test;
        if (testScript && !testScript.includes('Add tests here')) {
          allPackages.push({
            name: entry.name,
            dir: entry.name,
            language: 'node',
          });
        }
      } catch (err) {
        console.error(`Error reading ${pkgJsonPath}:`, err);
      }
    } else if (containsPythonTests(entry.name)) {
      allPackages.push({
        name: entry.name,
        dir: entry.name,
        language: 'python',
      });
    }
  }
}

let changedPackages = [];

if (eventName === 'workflow_dispatch') {
  console.log('Event is workflow_dispatch, including all implemented packages.');
  changedPackages = allPackages;
} else {
  try {
    let gitDiffCmd = 'git diff --name-only HEAD~1';
    if (eventName === 'pull_request') {
      const baseRef = process.env.GITHUB_BASE_REF || 'main';
      console.log(`Pull request target branch: ${baseRef}`);
      try {
        execSync(`git fetch origin ${baseRef} --depth=1`, { stdio: 'ignore' });
        gitDiffCmd = `git diff --name-only origin/${baseRef}...HEAD`;
      } catch (e) {
        console.warn(`Could not fetch origin/${baseRef}, falling back to local diff:`, e.message);
        gitDiffCmd = `git diff --name-only ${baseRef}...HEAD`;
      }
    } else {
      const beforeRef = process.env.GITHUB_BEFORE_REF;
      if (beforeRef && beforeRef !== '0000000000000000000000000000000000000000') {
        gitDiffCmd = `git diff --name-only ${beforeRef}...HEAD`;
      }
    }

    console.log(`Running: ${gitDiffCmd}`);
    const diffOutput = execSync(gitDiffCmd, { encoding: 'utf8' });
    const changedFiles = diffOutput.split('\n').map(f => f.trim()).filter(Boolean);
    console.log('Changed files:', changedFiles);

    // If any global/common configurations or workflows changed, run all tests
    const runAll = changedFiles.some(f =>
      f.startsWith('.github/') ||
      f === 'package.json' ||
      f.startsWith('scripts/')
    );

    if (runAll) {
      console.log('Global configuration or workflow files changed. Running all tests.');
      changedPackages = allPackages;
    } else {
      const changedDirs = new Set(changedFiles.map(f => f.split('/')[0]));
      changedPackages = allPackages.filter(p => changedDirs.has(p.dir));
    }
  } catch (err) {
    console.error('Error determining changed files, falling back to all packages:', err);
    changedPackages = allPackages;
  }
}

console.log('Target packages for test execution:', changedPackages.map(p => p.dir));

// Output for GitHub Actions matrix
const matrix = {
  include: changedPackages.map(p => ({ package: p.dir, language: p.language }))
};

const githubOutput = process.env.GITHUB_OUTPUT;
if (githubOutput) {
  fs.appendFileSync(githubOutput, `matrix=${JSON.stringify(matrix)}\n`);
  fs.appendFileSync(githubOutput, `has_tests=${changedPackages.length > 0 ? 'true' : 'false'}\n`);
  console.log('Wrote matrix to GITHUB_OUTPUT.');
} else {
  console.log('GITHUB_OUTPUT environment variable not set. Print JSON matrix directly:');
  console.log(JSON.stringify(matrix, null, 2));
  console.log(`has_tests: ${changedPackages.length > 0}`);
}
