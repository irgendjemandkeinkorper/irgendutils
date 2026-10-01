export function parseArgs(args = []) {
  const flags = {
    config: 'config.yml',
    withSmoke: false,
    retainOnFailure: false,
    command: 'run',
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--with-smoke') {
      flags.withSmoke = true;
    } else if (arg === '--retain-on-failure') {
      flags.retainOnFailure = true;
    } else if (arg === '-c' || arg === '--config') {
      flags.config = args[++i] || 'config.yml';
    } else if (!arg.startsWith('-')) {
      flags.command = arg;
    }
  }

  return flags;
}
