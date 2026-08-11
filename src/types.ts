// ESTIMER shared types.
//
// TimerSource is the injection boundary that makes the core run identically
// in Node and the ExtendScript engine (research plan §4 phase-3 / t1-core
// decision: the pure core never touches $.hiresTimer directly). readUs()
// returns the RAW counter value in µs:
//
//   - delta: true  — each read is µs SINCE THE PREVIOUS ACCESS
//     ($.hiresTimer). The counter is a signed 32-bit µs delta: reads up to
//     2^31 µs (~35.8 min) are exact; longer intervals read negative (wrap)
//     or alias to a small positive (multi-wrap). The first read is
//     engine/thread startup µs (official docs; repo gap G1/G2).
//   - delta: false — each read is an ABSOLUTE monotonic µs clock
//     (Node: performance.now() * 1000). wraps: true is for hypothetical
//     signed-32-bit absolute sources; the Node and Date lanes never wrap.
//
// The facade auto-detects the lane (engine > node > date); tests inject a
// fake source via ESTIMER.setSource() to script wrap/negative-delta
// sequences deterministically without waiting 35.8 minutes.
export interface TimerSource {
  readUs(): number;
  delta?: boolean;
  wraps?: boolean;
}

// Wrap handling for negative reads/deltas (design doc §3):
//   'correct' (default) — a negative delta is treated as a single wrap of
//     the 2^32 µs period: delta += 2^32. Exact when the true interval is in
//     [2^31, 2^32) µs; still-negative deltas count as 0 (never backwards).
//   'reject' — negative reads never advance the accumulator (counted as 0);
//     measurement validation independently rejects <= 0 samples either way.
export type WrapPolicy = 'correct' | 'reject';

export interface SampleOptions {
  /** Discarded priming runs before the n measured samples (default 2; house
   *  warmup band is 2-10 per esarr/docs/benchmark-rounds-1.md). */
  warmup?: number;
  /** Rejection ceiling for each sample, default MAX_VALID_US (1e8 µs = 100 s). */
  maxValidUs?: number;
  /** Rejection floor, default 0 (any positive sample is valid). */
  minValidUs?: number;
  /** When true, attach `.rejected = RejectedSample[]` to the returned array. */
  collectRejected?: boolean;
}

export interface RejectedSample {
  /** Iteration index within samples(). */
  index: number;
  /** The raw measured delta µs. */
  value: number;
  /** 'not-number' | 'negative' | 'zero' | 'below-min' | 'above-max'. */
  reason: string;
}

// samples() returns a plain Array<number> of VALID samples; when
// collectRejected is set the array carries a `.rejected` property (ES3 has
// no tuples; the property is the carry channel into stats(), which reports
// `rejected` as a count).
export interface SampleSet extends Array<number> {
  rejected?: RejectedSample[];
}

export interface Stats {
  count: number;
  min: number;
  max: number;
  mean: number;
  median: number; // upper-median — esarr/esstr bench convention, sorted[floor(n/2)]
  p95: number;
  p99: number;
  rejected: number;
}

export interface Stopwatch {
  /** Begin a run. No-op while already running (double-start cannot corrupt
   *  elapsed). */
  start(): void;
  /** End the current run; returns its µs (0 when not running). */
  stop(): number;
  /** Cumulative µs: sum of completed runs, plus the live delta if running.
   *  Nesting-safe by construction — see design doc §5. */
  elapsed(): number;
  /** Zero the accumulator; if running, re-base the start point at now(). */
  reset(): void;
  running: boolean;
}

export interface TimerConstants {
  MAX_VALID_US: number;   // 1e8 µs (100 s) — universal measurement ceiling
  MAX_VALID_MS: number;   // 1e5 ms (100 s) — measureMs default cap
  MIN_VALID_US: number;   // 0 — any positive sample is valid
  WRAP_PERIOD_US: number; // 2^32 — full wrap period of the signed 32-bit counter
  WRAP_POINT_US: number;  // 2^31 — where the signed value turns negative (~35.8 min)
  SLEEP_COARSE_THRESHOLD_MS: number; // 25 — $.sleep lane kicks in at/above this
}

export interface TimerInfo {
  lane: string;         // 'engine' | 'node' | 'date' | 'custom'
  engine: string;       // $.version when in the engine, '' otherwise
  wrapPolicy: WrapPolicy;
  primed: boolean;      // prime() has been called (epoch base set)
  reads: number;        // raw reads consumed by the accumulator (diagnostics)
  calibratedUs: number; // last calibrate() result, 0 if never run
}
