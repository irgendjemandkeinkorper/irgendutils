import { finding } from '../findings.js';

export const id = 'perf';
export const label = 'Performance';

export function median(values) {
  const nums = values.filter((v) => typeof v === 'number' && !Number.isNaN(v)).sort((a, b) => a - b);
  if (nums.length === 0) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

const METRICS = [
  { key: 'lcp_ms', name: 'LCP', unit: 'ms', fix: 'Optimize the largest content element: compress/resize the hero image, preload it, and cut server response time.' },
  { key: 'tbt_ms', name: 'TBT', unit: 'ms', fix: 'Reduce main-thread work: defer non-critical JS, split bundles, drop unused plugins/scripts.' },
  { key: 'cls', name: 'CLS', unit: '', fix: 'Reserve space for images/embeds (width/height attributes) and avoid injecting content above existing content.' },
];

// Lighthouse-style budget check. Metrics are the MEDIAN of N runs (perf numbers
// vary run-to-run; never gate on a single sample). Over budget => warning;
// more than 25% over => blocker.
export async function run(site) {
  const F = [];
  const budgets = site.config.budgets ?? {};
  const runs = site.config.runs ?? 3;

  for (const formFactor of ['mobile', 'desktop']) {
    const budget = budgets[formFactor];
    if (!budget) continue;

    const samples = await site.perfRuns(formFactor, runs);
    if (!samples || samples.length === 0) {
      F.push(finding('perf', `${formFactor}-unavailable`, 'info',
        `No ${formFactor} performance data available (Lighthouse adapter not installed or run skipped).`,
        'npm i -D lighthouse chrome-launcher to enable live performance runs.'));
      continue;
    }

    let flagged = false;
    for (const { key, name, unit, fix } of METRICS) {
      if (typeof budget[key] !== 'number') continue;
      const med = median(samples.map((s) => s[key]));
      if (med === null) continue;
      if (med > budget[key]) {
        const over = med / budget[key];
        const severity = over > 1.25 ? 'blocker' : 'warning';
        flagged = true;
        F.push(finding('perf', `${formFactor}-${key}-over-budget`, severity,
          `${formFactor}: median ${name} ${med}${unit} exceeds budget ${budget[key]}${unit} (median of ${samples.length} runs).`,
          fix, site.baseUrl));
      }
    }

    if (typeof budget.performance_score === 'number') {
      const med = median(samples.map((s) => s.performance_score));
      if (med !== null && med < budget.performance_score) {
        const severity = med < budget.performance_score - 0.15 ? 'blocker' : 'warning';
        flagged = true;
        F.push(finding('perf', `${formFactor}-score-under-budget`, severity,
          `${formFactor}: median Lighthouse performance score ${med.toFixed(2)} is below budget ${budget.performance_score} (median of ${samples.length} runs).`,
          'Work through the individual metric findings; re-run after each fix and compare medians, not single runs.', site.baseUrl));
      }
    }

    if (!flagged) {
      F.push(finding('perf', `${formFactor}-within-budget`, 'info',
        `${formFactor}: all metrics within budget (median of ${samples.length} runs).`,
        'No action needed.', site.baseUrl));
    }
  }

  return F;
}
