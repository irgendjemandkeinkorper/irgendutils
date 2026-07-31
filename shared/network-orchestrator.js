import fs from 'node:fs';
import path from 'node:path';

// Helper to extract hostname from URL or string
export function getHost(urlOrHost) {
  if (!urlOrHost) return null;
  try {
    const urlObj = new URL(urlOrHost);
    return urlObj.hostname;
  } catch {
    return String(urlOrHost)
      .trim()
      .replace(/^(https?:\/\/)?/, '')
      .replace(/\/.*$/, '')
      .split(':')[0];
  }
}

// Secret detection/redaction to make sure cache contains zero secrets
export function sanitizeData(data) {
  if (!data) return data;
  if (typeof data !== 'object') return data;

  if (Array.isArray(data)) {
    return data.map(sanitizeData);
  }

  const sanitized = {};
  for (const [key, val] of Object.entries(data)) {
    const lowKey = key.toLowerCase();
    if (
      lowKey.includes('auth') ||
      lowKey.includes('cookie') ||
      lowKey.includes('secret') ||
      lowKey.includes('key') ||
      lowKey.includes('token') ||
      lowKey.includes('password')
    ) {
      sanitized[key] = '[REDACTED]';
    } else {
      sanitized[key] = sanitizeData(val);
    }
  }
  return sanitized;
}

export class NetworkOrchestrator {
  constructor(options = {}) {
    this.globalLimit = options.globalLimit ?? Infinity;
    this.perHostLimit = options.perHostLimit ?? Infinity;
    this.timeoutMs = options.timeoutMs ?? 10000;
    this.maxRetries = options.maxRetries ?? 3;
    this.baseDelayMs = options.baseDelayMs ?? 100;
    this.maxDelayMs = options.maxDelayMs ?? 3000;

    this.cacheEnabled = options.cacheEnabled ?? true;
    this.cacheTtlMs = options.cacheTtlMs ?? 3600000; // 1 hour
    this.cacheVersion = options.cacheVersion ?? 'v1';
    this.cacheFilePath = options.cacheFilePath ?? path.join(process.cwd(), '.cache', 'network-cache.json');

    this.cancelOnFatal = options.cancelOnFatal ?? false;
    this.isFatalError = options.isFatalError ?? ((err) => this.classifyError(err).fatal);

    this.queue = [];
    this.activeGlobalCount = 0;
    this.activeHostCounts = {};
    this.isCancelled = false;
    this.cancelReason = null;

    // Telemetry
    this.telemetry = {
      stages: {}, // name -> { started, durationMs }
      cacheHits: 0,
      cacheMisses: 0,
      retries: 0,
      peakGlobalConcurrency: 0,
      peakHostConcurrency: {}, // host -> peak
    };

    this.cache = {};
    if (this.cacheEnabled) {
      this.loadCache();
    }
  }

  // File cache methods
  loadCache() {
    try {
      if (fs.existsSync(this.cacheFilePath)) {
        const raw = fs.readFileSync(this.cacheFilePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed.version === this.cacheVersion) {
          this.cache = parsed.data ?? {};
        } else {
          // Version mismatch -> clear cache
          this.cache = {};
        }
      }
    } catch {
      this.cache = {};
    }
  }

  saveCache() {
    if (!this.cacheEnabled) return;
    try {
      const dir = path.dirname(this.cacheFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const payload = {
        version: this.cacheVersion,
        data: sanitizeData(this.cache),
      };
      fs.writeFileSync(this.cacheFilePath, JSON.stringify(payload, null, 2), 'utf8');
    } catch {
      // Ignore cache write errors
    }
  }

  clearCache() {
    this.cache = {};
    try {
      if (fs.existsSync(this.cacheFilePath)) {
        fs.unlinkSync(this.cacheFilePath);
      }
    } catch {
      // Ignore cache unlink errors
    }
  }

  // Telemetry timing helpers
  startStage(name) {
    if (!this.telemetry.stages[name]) {
      this.telemetry.stages[name] = { started: Date.now(), durationMs: 0 };
    } else {
      this.telemetry.stages[name].started = Date.now();
    }
  }

  endStage(name) {
    const stage = this.telemetry.stages[name];
    if (stage && stage.started) {
      stage.durationMs += Date.now() - stage.started;
      stage.started = null;
    }
  }

  getSlowestStage() {
    let slowest = null;
    let maxDur = -1;
    for (const [name, info] of Object.entries(this.telemetry.stages)) {
      if (info.durationMs > maxDur) {
        maxDur = info.durationMs;
        slowest = name;
      }
    }
    return slowest ? { name: slowest, durationMs: maxDur } : null;
  }

  getTelemetrySummary() {
    return {
      cacheHits: this.telemetry.cacheHits,
      cacheMisses: this.telemetry.cacheMisses,
      retries: this.telemetry.retries,
      peakGlobalConcurrency: this.telemetry.peakGlobalConcurrency,
      peakHostConcurrency: this.telemetry.peakHostConcurrency,
      slowestStage: this.getSlowestStage(),
      stages: Object.fromEntries(
        Object.entries(this.telemetry.stages).map(([k, v]) => [k, v.durationMs])
      ),
    };
  }

  // Classify errors: returns { retryable, fatal }
  classifyError(error) {
    if (!error) return { retryable: false, fatal: true };

    // Check if error explicitly declares retryable or fatal
    if (typeof error.retryable === 'boolean') {
      return { retryable: error.retryable, fatal: !error.retryable };
    }

    const msg = (error.message ?? String(error)).toLowerCase();
    const code = error.code ?? '';

    // Permanent HTTP statuses
    const status = error.status ?? error.statusCode;
    if (status) {
      const s = Number(status);
      if (s === 429 || (s >= 500 && s <= 504)) {
        return { retryable: true, fatal: false };
      }
      return { retryable: false, fatal: true }; // 400, 401, 403, 404, etc.
    }

    // Common network errors / timeouts
    const retryableCodes = ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EADDRINUSE', 'EPIPE'];
    if (retryableCodes.includes(code)) {
      return { retryable: true, fatal: false };
    }

    // Timeout or network-related messages
    if (
      msg.includes('timeout') ||
      msg.includes('time out') ||
      msg.includes('network') ||
      msg.includes('fetch failed') ||
      msg.includes('socket') ||
      msg.includes('hang up') ||
      msg.includes('aborted') ||
      msg.includes('playwright') ||
      msg.includes('navigation failed')
    ) {
      return { retryable: true, fatal: false };
    }

    // Default to permanent
    return { retryable: false, fatal: true };
  }

  // Add a task to the queue and return a Promise
  add(taskFn, options = {}) {
    if (this.isCancelled) {
      return Promise.reject(new Error(`Queue is cancelled: ${this.cancelReason ?? 'fatal error occurred'}`));
    }

    const url = options.url ?? '';
    const host = getHost(url) ?? options.host ?? 'default';
    const cacheKey = options.cacheKey ?? (url ? `url:${url}` : null);
    const ttl = options.cacheTtlMs ?? this.cacheTtlMs;

    return new Promise((resolve, reject) => {
      // 1. Check cache first if enabled and task is cacheable (safe lookups, usually GETs)
      if (this.cacheEnabled && cacheKey && options.cacheable !== false) {
        const cached = this.cache[cacheKey];
        if (cached && Date.now() - cached.timestamp < ttl) {
          this.telemetry.cacheHits++;
          return resolve(cached.value);
        }
        this.telemetry.cacheMisses++;
      }

      this.queue.push({
        taskFn,
        host,
        cacheKey,
        options,
        resolve,
        reject,
        attempt: 0,
        id: Math.random().toString(36).slice(2),
      });

      this.processQueue();
    });
  }

  // Run a list of tasks in deterministic order (similar to Promise.all but bounded)
  async run(tasks, options = {}) {
    const promises = tasks.map((t, idx) => {
      const taskFn = typeof t === 'function' ? t : t.fn;
      const tOpts = typeof t === 'function' ? {} : t;
      return this.add(taskFn, { ...options, ...tOpts, index: idx });
    });
    return Promise.all(promises);
  }

  // Orchestrate queue execution
  processQueue() {
    if (this.isCancelled || this.queue.length === 0) return;

    // Check global limit
    if (this.activeGlobalCount >= this.globalLimit) return;

    // Find first task in queue that satisfies per-host limits
    let taskIndex = -1;
    for (let i = 0; i < this.queue.length; i++) {
      const task = this.queue[i];
      const hostCount = this.activeHostCounts[task.host] ?? 0;
      if (hostCount < this.perHostLimit) {
        taskIndex = i;
        break;
      }
    }

    if (taskIndex === -1) return; // No tasks can run due to per-host limits

    const task = this.queue.splice(taskIndex, 1)[0];

    // Increment concurrency counters
    this.activeGlobalCount++;
    this.activeHostCounts[task.host] = (this.activeHostCounts[task.host] ?? 0) + 1;

    // Update peak concurrency telemetry
    if (this.activeGlobalCount > this.telemetry.peakGlobalConcurrency) {
      this.telemetry.peakGlobalConcurrency = this.activeGlobalCount;
    }
    const currentHostCount = this.activeHostCounts[task.host];
    const peakHostCount = this.telemetry.peakHostConcurrency[task.host] ?? 0;
    if (currentHostCount > peakHostCount) {
      this.telemetry.peakHostConcurrency[task.host] = currentHostCount;
    }

    // Execute task
    this.executeTask(task);

    // Keep processing other items
    this.processQueue();
  }

  async executeTask(task) {
    let timer;
    let timedOut = false;

    const timeoutPromise = new Promise((_, reject) => {
      const t = task.options.timeoutMs ?? this.timeoutMs;
      if (t && t !== Infinity) {
        timer = setTimeout(() => {
          timedOut = true;
          const err = new Error(`Task timed out after ${t}ms`);
          err.code = 'ETIMEDOUT';
          reject(err);
        }, t);
      }
    });

    try {
      // Race the task function against the timeout
      const result = await Promise.race([
        Promise.resolve().then(() => task.taskFn()),
        timeoutPromise,
      ]);

      if (timer) clearTimeout(timer);

      // Decrement counters
      this.activeGlobalCount--;
      this.activeHostCounts[task.host]--;

      // Store in cache if enabled and cacheable
      if (this.cacheEnabled && task.cacheKey && task.options.cacheable !== false) {
        this.cache[task.cacheKey] = {
          timestamp: Date.now(),
          value: result,
        };
        this.saveCache();
      }

      task.resolve(result);

      // Process next in queue
      this.processQueue();

    } catch (err) {
      if (timer) clearTimeout(timer);

      // Decrement counters
      this.activeGlobalCount--;
      this.activeHostCounts[task.host]--;

      if (this.isCancelled) {
        task.reject(new Error(`Queue is cancelled: ${this.cancelReason ?? 'fatal error occurred'}`));
        this.processQueue();
        return;
      }

      const { retryable, fatal } = this.classifyError(err);

      // Handle fatal/cancellation
      if (fatal && this.cancelOnFatal) {
        this.cancelQueue(err.message ?? String(err));
        task.reject(err);
        this.processQueue();
        return;
      }

      // Handle retry
      const maxRetries = task.options.maxRetries ?? this.maxRetries;
      if (retryable && task.attempt < maxRetries) {
        task.attempt++;
        this.telemetry.retries++;

        // Exponential backoff with jitter
        const delayLimit = task.options.maxDelayMs ?? this.maxDelayMs;
        const base = task.options.baseDelayMs ?? this.baseDelayMs;
        const exponentialDelay = Math.min(delayLimit, base * Math.pow(2, task.attempt));
        // Proportional jitter (80% fixed, up to 20% random)
        const jitteredDelay = exponentialDelay * (0.8 + Math.random() * 0.2);

        setTimeout(() => {
          if (this.isCancelled) {
            task.reject(new Error(`Queue is cancelled: ${this.cancelReason ?? 'fatal error occurred'}`));
            this.processQueue();
            return;
          }
          // Put back in queue to run again
          this.queue.push(task);
          this.processQueue();
        }, jitteredDelay);

      } else {
        // No more retries or not retryable
        if (this.cancelOnFatal) {
          this.cancelQueue(err.message ?? String(err));
        }
        task.reject(err);
        this.processQueue();
      }
    }
  }

  cancelQueue(reason) {
    this.isCancelled = true;
    this.cancelReason = reason;

    // Reject all pending tasks in the queue
    const pending = this.queue;
    this.queue = [];
    for (const task of pending) {
      task.reject(new Error(`Queue is cancelled: ${reason}`));
    }
  }
}
