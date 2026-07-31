import fs from 'fs';
import path from 'path';

export function loadState(slug, baseOutputDir) {
  const statePath = path.join(baseOutputDir, 'state.json');
  if (fs.existsSync(statePath)) {
    try {
      return JSON.parse(fs.readFileSync(statePath, 'utf8'));
    } catch {
      // Return fresh state on corrupt JSON
    }
  }
  return {
    slug,
    lastCompletedStage: null,
    stages: {
      scrape: { status: 'pending', duration_ms: 0, artifacts: [] },
      convert: { status: 'pending', duration_ms: 0, artifacts: [] },
      vault: { status: 'pending', duration_ms: 0, artifacts: [] },
      spinup: { status: 'pending', duration_ms: 0, artifacts: [] },
      qa: { status: 'pending', duration_ms: 0, artifacts: [] },
      audit: { status: 'pending', duration_ms: 0, artifacts: [] }
    },
    history: []
  };
}

export function saveState(baseOutputDir, state) {
  const statePath = path.join(baseOutputDir, 'state.json');
  fs.mkdirSync(baseOutputDir, { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

export function getRedactionRegexes() {
  const secrets = [];
  const sensitiveKeys = ['PASSWORD', 'SECRET', 'KEY', 'TOKEN', 'AUTH', 'PWD', 'PASS'];

  for (const [key, val] of Object.entries(process.env)) {
    if (val && val.length > 3) {
      if (sensitiveKeys.some(sk => key.toUpperCase().includes(sk))) {
        secrets.push(val);
      }
    }
  }

  // Escape regex special chars
  return secrets.map(sec => new RegExp(sec.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'g'));
}

export function redactText(text, regexes) {
  if (!text) return '';
  let redacted = text;
  for (const re of regexes) {
    redacted = redacted.replace(re, '[REDACTED]');
  }
  return redacted;
}

export class RunLogger {
  constructor(baseOutputDir, consoleOutput = true) {
    this.baseOutputDir = baseOutputDir;
    this.consoleOutput = consoleOutput;
    this.logPath = path.join(baseOutputDir, 'run.log');
    this.redactionRegexes = getRedactionRegexes();

    fs.mkdirSync(this.baseOutputDir, { recursive: true });
  }

  log(message, type = 'INFO') {
    const timestamp = new Date().toISOString();
    const cleanMsg = redactText(message, this.redactionRegexes);
    const logLine = `[${timestamp}] [${type}] ${cleanMsg}\n`;

    fs.appendFileSync(this.logPath, logLine);

    if (this.consoleOutput) {
      const colorMap = {
        INFO: '\x1b[32m',    // Green
        WARN: '\x1b[33m',    // Yellow
        ERROR: '\x1b[31m',   // Red
        STAGE: '\x1b[36m',   // Cyan
        RESET: '\x1b[0m'
      };
      const color = colorMap[type] || colorMap.RESET;
      console.log(`${color}[${type}] ${cleanMsg}\x1b[0m`);
    }
  }

  info(message) { this.log(message, 'INFO'); }
  warn(message) { this.log(message, 'WARN'); }
  error(message) { this.log(message, 'ERROR'); }
  stage(message) { this.log(message, 'STAGE'); }
}
