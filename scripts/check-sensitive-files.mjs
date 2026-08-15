#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root }).toString().split('\0').filter(Boolean);
const findings = [];

for (const file of tracked) {
  const base = path.basename(file).toLowerCase();
  const envFile = base === '.env' || (base.startsWith('.env.') && base !== '.env.example');
  if (envFile) findings.push(`${file}: tracked environment file`);
  if (base.endsWith('.pem') || base.endsWith('.key')) findings.push(`${file}: tracked private-key material`);

  if (base === 'config.yml') {
    const example = path.join(path.dirname(file), 'config.example.yml');
    if (fs.existsSync(path.join(root, example)) || tracked.includes(example)) {
      findings.push(`${file}: tracked config.yml has an example sibling`);
    }
  }
}

if (findings.length) {
  console.error('Sensitive tracked-file guard failed:');
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log(`Sensitive tracked-file guard passed (${tracked.length} tracked files checked).`);
