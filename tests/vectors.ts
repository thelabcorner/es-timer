// ESTIMER test vectors + reference model.
//
// Shared by tests/estimer-test-entry.ts, tests/fuzz-entry.ts and
// tests/estimer-live-verify.mjs. This module is a LEAF: it imports nothing
// (local types only), so esbuild can bundle it standalone for the live-verify
// Node side.
//
// The reference model here is the differential oracle. It implements the
// DOCUMENTED ESTIMER contract (src/types.ts + src/timer-core.ts):
//   - accumulate every read; delta-clock reads are the delta directly
//   - 'correct' wrap policy: negative delta += 2^32 (single wrap); still
//     negative -> 0 (never backwards). 'reject': negative -> 0.
//   - stats: median/p95/p99 index the sorted copy at floor(n*f) (upper-median,
//     esarr/esstr bench convention), mean = sum/count, rejected counts
//     samples.rejected. Aggregates are 0 on an empty array (count 0) — the
//     documented edge case (src/stats.ts §7: "n = 0 -> every metric is 0").
// The fuzz lanes compare the core against these EXACTLY (bit-for-bit).

export interface RefStats {
  count: number;
  min: number;
  max: number;
  mean: number;
  median: number;
  p95: number;
  p99: number;
  rejected: number;
}

export type RefPolicy = 'correct' | 'reject';

// ---- stats oracle (pure math on a numeric array) ---------------------------

export function refMedian(values: number[]): number {
  var n = values.length;
  if (!n) { return 0; } // documented edge case: medianOf([]) === 0
  var s = values.slice(0);
  s.sort(function (a: number, b: number): number { return a - b; });
  return s[Math.floor(n / 2)];
}

export function refStats(samples: number[]): RefStats {
  var n = samples.length;
  var rejected = 0;
  var rej: any = (samples as any).rejected;
  if (rej && rej.length) { rejected = rej.length; }
  if (!n) {
    return { count: 0, min: 0, max: 0, mean: 0, median: 0, p95: 0, p99: 0, rejected: rejected };
  }
  var s = samples.slice(0);
  s.sort(function (a: number, b: number): number { return a - b; });
  var sum = 0;
  var i = 0;
  for (i = 0; i < n; i++) { sum += s[i]; }
  return {
    count: n,
    min: s[0],
    max: s[n - 1],
    mean: sum / n,
    median: s[Math.floor(n / 2)],
    p95: s[Math.min(n - 1, Math.floor(n * 0.95))],
    p99: s[Math.min(n - 1, Math.floor(n * 0.99))],
    rejected: rejected
  };
}

// NaN-aware equality for aggregate fields (JSON transport in live-verify).
export function numEq(a: any, b: any): boolean {
  if (a === b) { return true; }
  return typeof a === 'number' && typeof b === 'number' && isNaN(a) && isNaN(b);
}

// ---- clock oracle (documented accumulator policy, delta:true wraps:true) ---
// Returns the absolute accumulated µs AFTER EACH read; ticks[0] is the
// startup/thread-init read (absorbed as now()'s origin; prime() sets the
// epoch base so epoch() starts at 0).

export function refClock(ticks: number[], policy: RefPolicy): number[] {
  var abs = 0;
  var out: number[] = [];
  var i = 0;
  for (i = 0; i < ticks.length; i++) {
    var d = ticks[i];
    if (d < 0) { d = policy === 'correct' ? d + 4294967296 : 0; }
    if (d < 0) { d = 0; }
    abs += d;
    out[out.length] = abs;
  }
  return out;
}

// ---- fake TimerSource factory ----------------------------------------------
// A scripted delta-clock source modeling the $-property contract (raw IS µs
// since the previous access) under an ADVERSARIAL signed-32-bit source.
// NOTE: this models the POLICY contract (setWrapPolicy 'correct'/'reject' as
// defensive code paths), NOT verified engine behavior — the AI 30.6.0 host
// ScCore is 64-bit QPC-based with 64-bit delta arithmetic, so negative reads
// are structurally impossible and the policy never fires live (see
// estimer/evidence/re-ai-sccore.md; the official "signed 32-bit µs counter"
// doc is contradicted). Reads beyond the script return the LAST scripted
// value, so an unexpected extra read cannot inject a wild number.

export interface FakeTimerSource {
  readUs(): number;
  delta: boolean;
  wraps: boolean;
}

export function makeFake(ticks: number[], delta?: boolean, wraps?: boolean): FakeTimerSource {
  var i = 0;
  var n = ticks.length;
  var last = n ? ticks[n - 1] : 0;
  return {
    readUs: function (): number {
      var v = i < n ? ticks[i] : last;
      i++;
      return v;
    },
    delta: delta === void 0 ? true : delta,
    wraps: wraps === void 0 ? true : wraps
  };
}

// ---- fixed stats vectors (literal expected values, hand-computed) ----------

export interface StatsVec {
  desc: string;
  samples: number[];
  expect: RefStats;
}

export const STATS_VECTORS: StatsVec[] = [
  { desc: 'single', samples: [5],
    expect: { count: 1, min: 5, max: 5, mean: 5, median: 5, p95: 5, p99: 5, rejected: 0 } },
  { desc: 'ascending-5', samples: [1, 2, 3, 4, 5],
    expect: { count: 5, min: 1, max: 5, mean: 3, median: 3, p95: 5, p99: 5, rejected: 0 } },
  { desc: 'unsorted', samples: [100, 1, 50, 2, 99],
    expect: { count: 5, min: 1, max: 100, mean: 50.4, median: 50, p95: 100, p99: 100, rejected: 0 } },
  { desc: 'all-zero', samples: [0, 0, 0],
    expect: { count: 3, min: 0, max: 0, mean: 0, median: 0, p95: 0, p99: 0, rejected: 0 } },
  { desc: 'even-upper-median', samples: [1, 2, 3, 4],
    expect: { count: 4, min: 1, max: 4, mean: 2.5, median: 3, p95: 4, p99: 4, rejected: 0 } },
  { desc: 'exact-floats', samples: [1.5, 2.5, 3.5],
    expect: { count: 3, min: 1.5, max: 3.5, mean: 2.5, median: 2.5, p95: 3.5, p99: 3.5, rejected: 0 } },
  { desc: 'negatives-pure-math', samples: [-5, 3, 8],
    expect: { count: 3, min: -5, max: 8, mean: 2, median: 3, p95: 8, p99: 8, rejected: 0 } },
  { desc: 'wrap-magnitude', samples: [2147483647, 0, 100000000, 1],
    expect: { count: 4, min: 0, max: 2147483647, mean: 561870912, median: 100000000, p95: 2147483647, p99: 2147483647, rejected: 0 } },
  { desc: 'empty', samples: [],
    expect: { count: 0, min: 0, max: 0, mean: 0, median: 0, p95: 0, p99: 0, rejected: 0 } }
];

// The rejected-carrying vector is constructed at call time (needs the
// `.rejected` property); expected fields here.
export const REJECTED_SAMPLES_EXPECT: RefStats = {
  count: 3, min: 10, max: 30, mean: 20, median: 20, p95: 30, p99: 30, rejected: 1
};
export const REJECTED_SAMPLES_INPUT: number[] = [10, 20, 30];

// ---- fixed medianOf vectors --------------------------------------------------

export const MEDIAN_VECTORS: { desc: string; values: number[]; expect: number }[] = [
  { desc: 'sorted-odd', values: [1, 2, 3], expect: 2 },
  { desc: 'unsorted-5', values: [3, 1, 2], expect: 2 },
  { desc: 'even-upper', values: [1, 2, 3, 4], expect: 3 },
  { desc: 'single', values: [7], expect: 7 },
  { desc: 'negatives', values: [-5, 3, 8], expect: 3 },
  { desc: 'zeros', values: [0, 0, 0], expect: 0 },
  { desc: 'floats', values: [1.5, 2.5, 3.5], expect: 2.5 },
  { desc: 'empty', values: [], expect: 0 }
];

// ---- fixed clock vectors ------------------------------------------------------
// Each vector scripts a delta:true wraps:true source. prime() consumes
// ticks[0] (startup); nowAfterPrime[j] = now() after reading ticks[1+j];
// epochAfterPrime[j] = epoch() at the same point.

export interface ClockVec {
  desc: string;
  ticks: number[];
  policy: RefPolicy;
  nowAfterPrime: number[];
  epochAfterPrime: number[];
}

export const CLOCK_VECTORS: ClockVec[] = [
  {
    desc: 'startup-absorbed-into-now-origin',
    ticks: [5000000, 0, 7, 3],
    policy: 'correct',
    nowAfterPrime: [5000000, 5000007, 5000010],
    epochAfterPrime: [0, 7, 10]
  },
  {
    desc: 'all-zero-deltas',
    ticks: [0, 0, 0, 0],
    policy: 'correct',
    nowAfterPrime: [0, 0, 0],
    epochAfterPrime: [0, 0, 0]
  },
  {
    desc: 'monotonic-burst',
    ticks: [0, 1, 2, 3, 5, 8, 13],
    policy: 'correct',
    nowAfterPrime: [1, 3, 6, 11, 19, 32],
    epochAfterPrime: [1, 3, 6, 11, 19, 32]
  },
  {
    desc: 'wrap-correct-negative',
    ticks: [0, 100, -2147483647, 50],
    policy: 'correct',
    nowAfterPrime: [100, 2147483749, 2147483799],
    epochAfterPrime: [100, 2147483749, 2147483799]
  },
  {
    desc: 'wrap-exact-period-lands-zero',
    ticks: [0, -4294967296, 5],
    policy: 'correct',
    nowAfterPrime: [0, 5],
    epochAfterPrime: [0, 5]
  },
  {
    desc: 'multi-wrap-uncorrectable-zero',
    ticks: [0, -5000000000, 5],
    policy: 'correct',
    nowAfterPrime: [0, 5],
    epochAfterPrime: [0, 5]
  },
  {
    desc: 'wrap-reject-advances-nothing',
    ticks: [0, 100, -2147483647, 50],
    policy: 'reject',
    nowAfterPrime: [100, 100, 150],
    epochAfterPrime: [100, 100, 150]
  },
  {
    desc: 'huge-positive-accumulates-documented-long-span-limit',
    ticks: [0, 100, 99999999999, 5],
    policy: 'correct',
    nowAfterPrime: [100, 100000000099, 100000000104],
    epochAfterPrime: [100, 100000000099, 100000000104]
  },
  {
    desc: 'mixed-nasties-correct',
    ticks: [0, 7, -3, -2147483647, 1000000, -4294967296, 42],
    policy: 'correct',
    nowAfterPrime: [7, 4294967300, 6442450949, 6443450949, 6443450949, 6443450991],
    epochAfterPrime: [7, 4294967300, 6442450949, 6443450949, 6443450949, 6443450991]
  },
  {
    desc: 'mixed-nasties-reject',
    ticks: [0, 7, -3, -2147483647, 1000000, -4294967296, 42],
    policy: 'reject',
    nowAfterPrime: [7, 7, 7, 1000007, 1000007, 1000049],
    epochAfterPrime: [7, 7, 7, 1000007, 1000007, 1000049]
  }
];
