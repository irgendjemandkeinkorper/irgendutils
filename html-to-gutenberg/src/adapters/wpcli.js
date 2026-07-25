// WP-CLI adapter — optional optimization path. Runs `wp` locally, or over SSH
// when wp.ssh ("user@host" or "user@host:/webroot") is configured.

import { execFile } from 'node:child_process';

const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

export function createWpCliAdapter({ ssh = null, wpPath = null, siteUrl = null, log = () => {} }) {
  let dest = null;
  let path = wpPath;
  if (ssh) {
    const idx = ssh.indexOf(':');
    dest = idx === -1 ? ssh : ssh.slice(0, idx);
    if (idx !== -1) path = ssh.slice(idx + 1);
  }

  function run(args, input = null) {
    const wpArgs = [
      ...(path ? [`--path=${path}`] : []),
      ...(siteUrl ? [`--url=${siteUrl}`] : []),
      ...args,
    ];
    log(`wp ${wpArgs.join(' ')}${dest ? ` (via ${dest})` : ''}`);
    const [cmd, cmdArgs] = dest
      ? ['ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', dest, 'wp', ...wpArgs.map(shq)]]
      : ['wp', wpArgs];
    return new Promise((resolve, reject) => {
      const child = execFile(cmd, cmdArgs, { maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) reject(new Error(`wp ${args[0] ?? ''} failed: ${stderr || err.message}`));
        else resolve(stdout.trim());
      });
      if (input != null) {
        child.stdin.write(input);
        child.stdin.end();
      }
    });
  }

  return {
    name: 'wpcli',

    async createPage({ title, status = 'draft', content }) {
      const id = await run(
        ['post', 'create', '-', '--post_type=page', `--post_title=${title}`,
          `--post_status=${status}`, '--porcelain'],
        content
      );
      const url = await run(['post', 'get', id, '--field=link']);
      return { id: Number(id), url };
    },

    async importMedia(src) {
      const id = await run(['media', 'import', src, '--porcelain']);
      const url = await run(['post', 'get', id, '--field=guid']);
      return { id: Number(id), url };
    },
  };
}
