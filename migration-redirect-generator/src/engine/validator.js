import { normalizePath } from './matcher.js';

// Helper to check for ReDoS patterns (nested quantifiers like (a+)+, (a*)*, or backreferences)
export function isRegexUnsafe(pattern) {
  try {
    // Check if valid regex
    new RegExp(pattern);
  } catch (e) {
    return true; // Invalid regex is unsafe
  }

  // Look for nested quantifiers or highly repetitive overlapping groups
  // e.g. (a+)+, (.*)*, (a|b|c)*, or infinite wildcards without bounds
  const unsafePatterns = [
    /\([^)]+[+*]\)[+*]/, // Nested quantifiers e.g. (a+)+
    /\.\*.*\.\*/,        // Multiple un-bounded wildcards
    /\\1/,               // Backreferences can sometimes cause backtracking issues in some engines
  ];

  for (const regex of unsafePatterns) {
    if (regex.test(pattern)) {
      return true;
    }
  }

  return false;
}

export async function validateRedirectMap(mapData, { verifyDestinations = false } = {}) {
  const loops = [];
  const chains = [];
  const collisions = [];
  const unresolvedRequired = [];
  const brokenDestinations = [];
  const unsafeRegexes = [];
  const externalTargets = [];

  // 1. Detect Collisions (duplicate source paths mapping to different targets)
  // And compile all maps
  const sourceToEntries = new Map();
  for (const entry of mapData) {
    if (!entry.source) continue;
    const normSource = normalizePath(entry.source);
    if (!sourceToEntries.has(normSource)) {
      sourceToEntries.set(normSource, []);
    }
    sourceToEntries.get(normSource).push(entry);
  }

  for (const [normSource, entries] of sourceToEntries.entries()) {
    if (entries.length > 1) {
      // Check if they map to different targets or have different status
      const uniqueMappings = new Set(entries.map(e => `${e.target}::${e.status}`));
      if (uniqueMappings.size > 1) {
        collisions.push({
          source: normSource,
          targets: entries.map(e => e.target || 'gone')
        });
      }
    }
  }

  // 2. Build graph for Loop and Chain detection
  // Map of normalizedSourcePath -> normalizedTargetPath
  const graph = new Map();
  const inDegrees = new Map(); // Track in-degree of each node

  // Initialize in-degrees for all potential nodes
  for (const entry of mapData) {
    if (!entry.source) continue;
    const src = normalizePath(entry.source);
    inDegrees.set(src, 0);
  }

  for (const entry of mapData) {
    if (!entry.source || !entry.target) continue;
    // Skip status 410 or gone targets or missing targets
    if (entry.status === 410 || entry.classification === 'missing') continue;

    const src = normalizePath(entry.source);
    const tgt = normalizePath(entry.target);

    // Check if target is external
    const isTargetExternal = entry.target.startsWith('http://') || entry.target.startsWith('https://');
    if (isTargetExternal) {
      externalTargets.push({ source: entry.source, target: entry.target });
      continue;
    }

    graph.set(src, tgt);
    inDegrees.set(tgt, (inDegrees.get(tgt) || 0) + 1);
  }

  // 3. Loop and Chain Detection
  // Performance optimization: Use pathIndices Map for O(1) cycle detection
  // and prioritize root nodes (inDegree === 0) for maximal chain detection.
  const recordedCycleKeys = new Set();
  const visited = new Set();

  // Step 1: Traversal from root nodes (inDegree === 0) to find maximal chains and cycles
  for (const startNode of inDegrees.keys()) {
    const inDegree = inDegrees.get(startNode) || 0;
    if (inDegree !== 0) continue;

    visited.add(startNode);
    const path = [startNode];
    const pathIndices = new Map([[startNode, 0]]);
    let current = startNode;
    let hasLoop = false;

    while (graph.has(current)) {
      const next = graph.get(current);

      if (pathIndices.has(next)) {
        // Loop detected!
        hasLoop = true;
        const loopStartIndex = pathIndices.get(next);
        const loopCycle = path.slice(loopStartIndex);
        loopCycle.push(next); // Complete cycle representation

        // De-duplicate cycles using sorted unique node keys
        const cycleKey = Array.from(new Set(loopCycle.slice(0, -1))).sort().join(',');
        if (!recordedCycleKeys.has(cycleKey)) {
          recordedCycleKeys.add(cycleKey);
          loops.push(loopCycle);
        }
        break;
      }

      visited.add(next);
      pathIndices.set(next, path.length);
      path.push(next);
      current = next;
    }

    if (!hasLoop && path.length > 2) {
      chains.push(path);
    }
  }

  // Step 2: Traversal for remaining unvisited nodes (e.g. isolated cycles with inDegree > 0)
  for (const startNode of inDegrees.keys()) {
    if (visited.has(startNode)) continue;

    const path = [startNode];
    const pathIndices = new Map([[startNode, 0]]);
    let current = startNode;

    while (graph.has(current)) {
      const next = graph.get(current);

      if (pathIndices.has(next)) {
        // Loop detected!
        const loopStartIndex = pathIndices.get(next);
        const loopCycle = path.slice(loopStartIndex);
        loopCycle.push(next); // Complete cycle representation

        const cycleKey = Array.from(new Set(loopCycle.slice(0, -1))).sort().join(',');
        if (!recordedCycleKeys.has(cycleKey)) {
          recordedCycleKeys.add(cycleKey);
          loops.push(loopCycle);
        }
        break;
      }

      if (visited.has(next)) {
        // Hit previously analyzed component with no new cycles
        break;
      }

      visited.add(next);
      pathIndices.set(next, path.length);
      path.push(next);
      current = next;
    }
  }

  // 4. Detect unsafe regexes in source rules
  for (const entry of mapData) {
    if (entry.source && (entry.source.startsWith('^') || entry.source.includes('(') || entry.source.includes('*'))) {
      if (isRegexUnsafe(entry.source)) {
        unsafeRegexes.push({ source: entry.source, target: entry.target });
      }
    }
  }

  // 5. Detect unresolved required URLs (e.g. root / or items flagged as required)
  for (const entry of mapData) {
    const normSource = normalizePath(entry.source);
    const isRequired = normSource === '/' || entry.required === true;
    const isUnresolved = entry.classification === 'missing' || !entry.target;

    if (isRequired && isUnresolved && entry.status !== 410) {
      unresolvedRequired.push(entry.source);
    }
  }

  // 6. Optional HTTP Verification
  if (verifyDestinations) {
    const uniqueTargets = new Set();
    const targetToSources = new Map();

    for (const entry of mapData) {
      if (entry.target && entry.status !== 410 && entry.classification !== 'missing') {
        uniqueTargets.add(entry.target);
        if (!targetToSources.has(entry.target)) {
          targetToSources.set(entry.target, []);
        }
        targetToSources.get(entry.target).push(entry.source);
      }
    }

    // Prober helper
    const userAgent = process.env.HTTP_USER_AGENT || 'Mozilla/5.0 (compatible; MigrationRedirectGenerator/1.0)';
    const timeoutMs = Number(process.env.HTTP_VERIFY_TIMEOUT_MS || 5000);

    for (const targetUrl of uniqueTargets) {
      try {
        // Use HEAD method first
        let response;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        try {
          response = await fetch(targetUrl, {
            method: 'HEAD',
            headers: { 'User-Agent': userAgent },
            signal: controller.signal
          });
        } catch (e) {
          // Fallback to GET on network failure of HEAD, or if aborted
          clearTimeout(timeoutId);
          const getController = new AbortController();
          const getTimeoutId = setTimeout(() => getController.abort(), timeoutMs);
          response = await fetch(targetUrl, {
            method: 'GET',
            headers: { 'User-Agent': userAgent },
            signal: getController.signal
          });
          clearTimeout(getTimeoutId);
        } finally {
          clearTimeout(timeoutId);
        }

        // If response is not 2xx/3xx, mark as broken
        if (response.status >= 400) {
          const sources = targetToSources.get(targetUrl) || [];
          sources.forEach(source => {
            brokenDestinations.push({
              source,
              target: targetUrl,
              status: response.status,
              error: `HTTP Error: ${response.status} ${response.statusText}`,
            });
          });
        }
      } catch (err) {
        const sources = targetToSources.get(targetUrl) || [];
        sources.forEach(source => {
          brokenDestinations.push({
            source,
            target: targetUrl,
            status: 0,
            error: err.message,
          });
        });
      }
    }
  }

  // Check overall validity
  // Loops, collisions, unresolved required URLs, or broken destinations are critical errors
  const hasCriticalErrors =
    loops.length > 0 ||
    collisions.length > 0 ||
    unresolvedRequired.length > 0 ||
    brokenDestinations.length > 0;

  return {
    valid: !hasCriticalErrors,
    loops,
    chains,
    collisions,
    unresolvedRequired,
    brokenDestinations,
    unsafeRegexes,
    externalTargets,
  };
}
