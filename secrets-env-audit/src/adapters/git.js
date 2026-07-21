// Real git adapter — only loaded (lazily) when a scan with
// include_git_history runs against real roots. Tests use a fake.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export function createGitAdapter() {
  return {
    isRepo(root) {
      return existsSync(join(root, '.git'));
    },
    logPatches(root) {
      return execFileSync(
        'git',
        ['-C', root, 'log', '-p', '--all', '--unified=0', '--no-color', '--no-textconv'],
        { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }
      );
    },
  };
}
