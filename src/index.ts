// ESTIMER facade — the quirk-solving timer facade for ExtendScript (ES3).
//
// $.hiresTimer is a delta clock with documented traps (research plan
// hirestimer-research-plan.md, gaps G1-G8): the first read is engine/thread
// startup µs (not a sample), every read is µs-since-last-access (not a
// timestamp), and the signed 32-bit counter wraps (~35.8 min to negative).
// Nested reads corrupt naive outer timings; the timer is not authoritative
// over long spans; $.sleep polls coarsely.
//
// ESTIMER solves all of it with ONE accumulator (Timer, timer-core.ts):
// every read advances a monotonic absolute µs clock, so now() is safe
// anywhere — including inside measured fns and nested stopwatches. Samples
// are validated deltas (> 0, <= maxValidUs) per the house protocol, and the
// first read is discarded by prime(). The raw source is INJECTED
// (TimerSource) so the identical bundle runs in Node (performance.now()) and
// the engine ($.hiresTimer); the facade picks the lane at load and
// setSource() lets harnesses inject a fake for deterministic
// wrap/negative-delta tests.
//
// The esbuild JSX build exposes `var ESTIMER` (--global-name=ESTIMER).
// Exports are FUNCTIONS ONLY: esbuild's IIFE var-export getters evaluate at
// define time, while hoisting still leaves the var undefined — the export is
// permanently undefined (esarr README:345). Constants ride on
// ESTIMER.constants() instead of exported bindings.
import {
  RejectedSample, SampleOptions, SampleSet, Stopwatch, TimerConstants,
  TimerInfo, TimerSource, WrapPolicy
} from './types';
import {
  MAX_VALID_MS, MAX_VALID_US, MIN_VALID_US, Timer, WRAP_PERIOD_US,
  WRAP_POINT_US, createTimer, validateSample
} from './timer-core';
import { COARSE_THRESHOLD_MS, sleepCore } from './sleep';
import { medianOf, minOf, stats } from './stats';

export { medianOf, minOf, stats };

// ---- exported surface (functions only — see header) -----------------------

/** Idempotent: consumes and discards one read so the first (startup /
 *  thread-init) value is never treated as a sample; records the epoch base. */
export function prime(): void {
  timer.prime();
}

/** µs, monotonic, wrap-corrected. Absolute accumulated µs since the first
 *  raw read (origin ~ thread/engine start); safe anywhere, including nested
 *  contexts. */
export function now(): number {
  return timer.now();
}

/** ms convenience — now() / 1000 (keeps the µs precision in ms units). */
export function nowMs(): number {
  return timer.now() / 1000;
}

/** Long-span wall-clock lane: Date().getTime() ms. The accumulator is not
 *  authoritative past ~35.8 min between reads; wallNow() is the honest lane
 *  for long spans (research plan §2.6). */
export function wallNow(): number {
  return new Date().getTime();
}

/** Accumulated µs since prime (wrap-corrected). Auto-primes on first call. */
export function epoch(): number {
  return timer.epoch();
}

/** One validated sample: primes internally, runs fn, returns the µs delta,
 *  or null when the sample is rejected (<= 0, or > maxValidUs, default
 *  1e8 µs). A throwing fn propagates — the accumulator stays consistent. */
export function measureUs(fn: () => void, maxValidUs?: number): number | null {
  var d = measureOne(fn);
  return validateSample(d, MIN_VALID_US, maxValidUs).ok ? d : null;
}

/** measureUs in ms; default cap 1e5 ms (100 s). */
export function measureMs(fn: () => void, maxValidMs?: number): number | null {
  var cap = (maxValidMs === void 0 || maxValidMs === null) ? MAX_VALID_MS : maxValidMs;
  var d = measureOne(fn);
  return validateSample(d, MIN_VALID_US, cap * 1000).ok ? d / 1000 : null;
}

/** Collect n measured samples: opts { warmup? (default 2), maxValidUs?
 *  (default 1e8), minValidUs? (default 0), collectRejected? }. Returns the
 *  VALID samples array; with collectRejected, array.rejected carries
 *  [{index, value, reason}]. Rejected samples REDUCE the set (outlier
 *  rejection after collection — esarr/docs/benchmark-rounds-1.md); there is
 *  no silent retry. */
export function samples(n: number, fn: () => void, opts?: SampleOptions): SampleSet {
  var count = Math.floor(Number(n));
  if (!(count > 0)) {
    count = 0;
  }
  var warm = 2;
  var maxUs: number | undefined = void 0;
  var minUs: number | undefined = void 0;
  var collectRej = false;
  if (opts) {
    if (opts.warmup !== void 0 && opts.warmup !== null) {
      warm = Math.max(0, Math.floor(Number(opts.warmup)));
    }
    if (opts.maxValidUs !== void 0) {
      maxUs = opts.maxValidUs;
    }
    if (opts.minValidUs !== void 0) {
      minUs = opts.minValidUs;
    }
    collectRej = !!opts.collectRejected;
  }
  var i = 0;
  for (i = 0; i < warm; i++) {
    measureOne(fn); // warmup: cache/thermal; discarded unvalidated
  }
  var out: SampleSet = [];
  var rej: RejectedSample[] = [];
  for (i = 0; i < count; i++) {
    var d = measureOne(fn);
    var v = validateSample(d, minUs, maxUs);
    if (v.ok) {
      out[out.length] = d;
    } else if (collectRej) {
      rej[rej.length] = { index: i, value: d, reason: v.reason };
    }
  }
  if (collectRej) {
    out.rejected = rej;
  }
  return out;
}

/** Median-of-n primed samples (the house benchmark protocol). Median of the
 *  VALID samples; null when none are valid. */
export function median(n: number, fn: () => void, opts?: SampleOptions): number | null {
  var s = samples(n, fn, opts);
  return s.length > 0 ? medianOf(s) : null;
}

/** Min-of-n primed samples. */
export function best(n: number, fn: () => void, opts?: SampleOptions): number | null {
  var s = samples(n, fn, opts);
  return s.length > 0 ? minOf(s) : null;
}

/** Nesting-safe stopwatch: { start, stop, elapsed, reset, running }.
 *  elapsed() is cumulative (sum of completed runs + live delta while
 *  running); stop() returns the just-completed run's µs; start() while
 *  running and stop() while stopped are no-ops. Because every read flows
 *  through the single accumulator, an inner stopwatch or now() call between
 *  start and stop cannot corrupt the outer elapsed (design doc §5). */
export function stopwatch(): Stopwatch {
  var startAbs = -1; // accumulator abs at the last start()
  var acc = 0;       // cumulative µs from completed runs
  var api: Stopwatch = {
    start: function (): void {
      if (api.running) {
        return; // double-start is a no-op: cannot corrupt elapsed
      }
      api.running = true;
      startAbs = timer.now();
    },
    stop: function (): number {
      if (!api.running) {
        return 0; // stop-without-start is a no-op
      }
      api.running = false;
      var run = timer.now() - startAbs;
      acc += run;
      return run;
    },
    elapsed: function (): number {
      if (api.running) {
        return acc + (timer.now() - startAbs);
      }
      return acc;
    },
    reset: function (): void {
      acc = 0;
      if (api.running) {
        startAbs = timer.now();
      }
    },
    running: false
  };
  return api;
}

/** Median read overhead µs: n adjacent-read pairs (default 100, per the
 *  "n default >= 100" contract), validated to <= 10 ms and medianed. The
 *  result is the per-now() cost (engine ~2-4 µs; Node ~1-2 µs) and can be
 *  subtracted from sub-10 µs measurements (research plan G6). */
export function calibrate(n?: number): number {
  var count = Math.floor(Number(n));
  if (!(count > 0)) {
    count = 100;
  }
  var i = 0;
  for (i = 0; i < 3; i++) {
    timer.now(); // consume the startup read; warm caches
  }
  var deltas: number[] = [];
  for (i = 0; i < count; i++) {
    var t0 = timer.now();
    var t1 = timer.now();
    var d = t1 - t0;
    // Read overhead must be small: > 10 ms is a wedge artifact, not a read.
    if (d > 0 && d <= 10000) {
      deltas[deltas.length] = d;
    }
  }
  lastCalibrationUs = deltas.length > 0 ? medianOf(deltas) : 0;
  return lastCalibrationUs;
}

/** Calibrated sleep: busy-wait below the coarse threshold; above it (engine
 *  only) $.sleep(ms - 1) then a final calibrated busy-wait to land at the
 *  target. Node runs busy-wait only (no Atomics/setTimeout — ES3 parity).
 *  Returns the actual µs slept (>= the request; may exceed it when $.sleep
 *  overshoots — never the reverse). */
export function sleep(ms: number): number {
  var coarse: ((m: number) => void) | undefined = void 0;
  try {
    if (typeof $ !== 'undefined' && $ && typeof $.sleep === 'function') {
      coarse = function (m: number): void { $.sleep(m); };
    }
  } catch (e) {
    coarse = void 0;
  }
  return sleepCore(ms, function (): number { return timer.now(); }, coarse);
}

/** Inject a timer source (test/embedding hook) or re-detect the lane when
 *  source is omitted. Re-creates the accumulator (full re-init). */
export function setSource(source?: TimerSource, opts?: { wrapPolicy?: WrapPolicy }): void {
  var det = detectSource();
  var src = source || det.source;
  var laneName = source ? 'custom' : det.lane;
  timer = createTimer(src, opts && opts.wrapPolicy ? opts.wrapPolicy : void 0);
  currentLane = laneName;
}

/** Wrap policy override (default 'correct'): 'correct' adds 2^32 to a
 *  negative delta (single-wrap); 'reject' never advances on a wrapped read. */
export function setWrapPolicy(policy: WrapPolicy): void {
  timer.setPolicy(policy);
}

export function wrapPolicy(): WrapPolicy {
  return timer.policy();
}

/** Active lane: 'engine' | 'node' | 'date' | 'custom'. */
export function lane(): string {
  return currentLane;
}

/** Snapshot for the evidence protocol (host/version must be recorded with
 *  every measurement — performance-engineering.md:14-27). */
export function describe(): TimerInfo {
  return {
    lane: currentLane,
    engine: engineVersion(),
    wrapPolicy: timer.policy(),
    primed: timer.isPrimed(),
    reads: timer.readCount(),
    calibratedUs: lastCalibrationUs
  };
}

/** Constants, via a function (no exported var bindings — see header). */
export function constants(): TimerConstants {
  return {
    MAX_VALID_US: MAX_VALID_US,
    MAX_VALID_MS: MAX_VALID_MS,
    MIN_VALID_US: MIN_VALID_US,
    WRAP_PERIOD_US: WRAP_PERIOD_US,
    WRAP_POINT_US: WRAP_POINT_US,
    SLEEP_COARSE_THRESHOLD_MS: COARSE_THRESHOLD_MS
  };
}

// ---- internals -------------------------------------------------------------

var timer: Timer;
var currentLane = 'node';
var lastCalibrationUs = 0;

// Prime-and-measure: t0 and t1 are ABSOLUTE accumulator reads, so d is the
// true elapsed (fn + one read overhead — calibrate() measures the read).
// If fn throws, the exception propagates and the accumulator stays
// consistent (the next read absorbs the gap).
function measureOne(fn: () => void): number {
  var t0 = timer.now();
  fn();
  return timer.now() - t0;
}

function detectSource(): { source: TimerSource; lane: string } {
  try {
    if (typeof $ !== 'undefined' && $ && typeof $.hiresTimer === 'number') {
      // Engine lane: delta clock (µs since last access), signed 32-bit
      // (wraps). First read = thread/engine startup µs — absorbed as the
      // origin offset; prime() keeps it out of samples.
      return {
        source: { readUs: function (): number { return $.hiresTimer; }, delta: true, wraps: true },
        lane: 'engine'
      };
    }
  } catch (e) { /* engine presence probe */ }
  try {
    if (typeof performance !== 'undefined' && performance && typeof performance.now === 'function') {
      // Node lane: absolute monotonic ms, sub-µs precision.
      return {
        source: { readUs: function (): number { return performance.now() * 1000; }, delta: false, wraps: false },
        lane: 'node'
      };
    }
  } catch (e) { /* node presence probe */ }
  // Degraded wall lane: ms precision only — long spans, never microbenchmarks.
  return {
    source: { readUs: function (): number { return new Date().getTime() * 1000; }, delta: false, wraps: false },
    lane: 'date'
  };
}

function engineVersion(): string {
  try {
    if (typeof $ !== 'undefined' && $ && $.version) {
      return String($.version);
    }
  } catch (e) { /* ignore */ }
  return '';
}

// Init with the detected lane at load (cheap typeof probes; the Timer reads
// the source lazily, so no timing side effect at load).
setSource();
