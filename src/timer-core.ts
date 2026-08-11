// ESTIMER core — the monotonic, wrap-corrected microsecond accumulator.
//
// $.hiresTimer (ExtendScript) is a DELTA clock with three documented traps
// (agent-skills/adobe-illustrator-scripting/references/hirestimer-research-plan.md,
// gaps G1-G8):
//   1. Each read returns µs SINCE THE PROPERTY WAS LAST ACCESSED — it is
//      not a timestamp; consecutive reads must never be subtracted.
//   2. The first read returns engine/thread startup µs (official Adobe
//      docs; repo gap G1/G2) — a huge garbage "sample" for naive harnesses.
//   3. The counter is signed 32-bit: it wraps negative at 2^31 µs (~35.8
//      min) and fully wraps every 2^32 µs (~71.6 min). Nested reads corrupt
//      naive outer timings; the timer is not authoritative over long spans.
//
// This core turns ANY raw timer source into an absolute, monotonic,
// wrap-corrected µs clock by accumulating every read:
//
//   abs += wrapCorrect(delta(raw))
//
// where delta is the raw read itself for a delta clock, or (raw - lastRaw)
// for an absolute clock (Node's performance.now()). Because EVERY read
// advances the accumulator, nested reads (a stopwatch inside a stopwatch,
// or a now() call inside a measured fn) cannot steal each other's elapsed
// time — the outer interval is exactly the sum of the inner intervals. This
// is the profiler-nesting fix from arcfit/docs/handoffs/
// HANDOFF_ARCFIT_RUNTIME_OPTIMIZATION.md:238-243 ("accumulates every read
// into a monotonic clock").
//
// ASSUMPTION (gap G4, unprobed): a delta-clock read whose true interval is
// in [2^31, 2^32) µs comes back negative, so the correction is +2^32; the
// official "signed 32-bit counter" wording supports this but live probes
// (evidence member) should confirm the sign/width. Multi-wrap intervals
// (> 2^32 µs between reads) are unrecoverable: the accumulator is
// authoritative only while reads occur at least once per ~35.8 min — beyond
// that ESTIMER.wallNow() (Date) is the honest lane. We document the limit,
// we do not fight it.
//
// NOTE on style: Timer is a closure FACTORY, not a class — esbuild cannot
// downlevel class syntax to ES5 ("Transforming class syntax ... not
// supported yet"), and the ES3 JSX bundle must run un-transformed classes
// anyway (ExtendScript has no class). Functions + closures are the house
// pattern (esstr/esarr) and emit ES3-clean code.
import { TimerSource, WrapPolicy } from './types';

// 2^32 µs — the full wrap period of the signed 32-bit counter. A negative
// read means "the true interval minus 2^32" (single wrap), so the
// correction is +2^32. WRAP_POINT_US (2^31) is where the SIGNED value turns
// negative — the wrap point, not the correction constant.
export var WRAP_PERIOD_US = 4294967296;
export var WRAP_POINT_US = 2147483648;

// House validation ceilings (research plan §2.7 / G8): >0 and <= 1e8 µs
// (100 s) is the universal measurement window (esarr bench, architect
// probes). The skill harness uses 1e7 for sub-10 µs ops — per-op callers
// pass a smaller maxValidUs explicitly; we never auto-scale (no magic
// numbers derived from the operation, G8 decision: fixed ceiling + explicit
// per-op override).
export var MAX_VALID_US = 100000000;
export var MAX_VALID_MS = 100000; // 100 s in ms (measureMs default cap)
export var MIN_VALID_US = 0;

export interface Validation {
  ok: boolean;
  reason: string;
}

// The house rejection protocol (performance-engineering.md:29-40, SKILL.md:
// 290): reject <= 0 and > maxValidUs. Order matters for the reported reason:
// not-number -> negative -> zero -> below-min -> above-max.
export function validateSample(deltaUs: number, minValidUs?: number, maxValidUs?: number): Validation {
  var min = (minValidUs === void 0 || minValidUs === null) ? MIN_VALID_US : minValidUs;
  var max = (maxValidUs === void 0 || maxValidUs === null) ? MAX_VALID_US : maxValidUs;
  if (typeof deltaUs !== 'number' || !isFinite(deltaUs)) {
    return { ok: false, reason: 'not-number' };
  }
  if (deltaUs < 0) {
    return { ok: false, reason: 'negative' };
  }
  if (!(deltaUs > 0)) {
    return { ok: false, reason: 'zero' };
  }
  if (deltaUs < min) {
    return { ok: false, reason: 'below-min' };
  }
  if (deltaUs > max) {
    return { ok: false, reason: 'above-max' };
  }
  return { ok: true, reason: 'ok' };
}

export interface Timer {
  now(): number;
  prime(): void;
  epoch(): number;
  isPrimed(): boolean;
  readCount(): number;
  policy(): WrapPolicy;
  setPolicy(policy: WrapPolicy): void;
  reset(): void;
}

// The accumulator. One instance per source; the facade owns a singleton,
// tests construct their own with a fake TimerSource via createTimer or
// ESTIMER.setSource.
export function createTimer(source: TimerSource, policy?: WrapPolicy): Timer {
  var _src = source;
  var _policy = policy || 'correct';
  var _primed = false;
  var _lastRaw = -1;
  var _abs = 0;
  var _primeAbs = -1;
  var _reads = 0;

  var api: Timer = {
    // Current absolute µs since the first raw read (monotonic). Never
    // throws: a host read failure freezes the clock (returns the last
    // value) — the try/catch house pattern from arcfit/src/host/profiler.ts:
    // 26-28, minus the 0 (a 0 would move the clock backwards).
    now: function (): number {
      var raw = 0;
      try {
        raw = _src.readUs();
      } catch (e) {
        return _abs;
      }
      _reads++;
      var delta = 0;
      if (_src.delta === true) {
        // Delta clock: the read IS the µs elapsed since the previous access.
        // The first read (startup µs) is legitimately absorbed as the origin
        // offset — it is wall time since the counter was initialized, and
        // prime() guarantees it never becomes a measurement sample.
        delta = raw;
      } else if (_lastRaw >= 0) {
        // Absolute clock: elapsed since the previous read. First read has no
        // predecessor, so its delta is 0 (origin baseline).
        delta = raw - _lastRaw;
      }
      _lastRaw = raw;
      if (_src.wraps === true && delta < 0) {
        if (_policy === 'correct') {
          // Single-wrap correction: exact for true intervals in [2^31, 2^32)
          // µs. Multi-wrap intervals stay wrong — the documented long-span
          // limit (see file header).
          delta += WRAP_PERIOD_US;
        } else {
          delta = 0; // 'reject': a wrapped read advances nothing
        }
      }
      if (delta < 0) {
        delta = 0; // uncorrectable (multi-wrap, or 'reject' lane): never backwards
      }
      _abs += delta;
      return _abs;
    },

    // Idempotent: consumes and discards one read so the first (startup /
    // thread-init) value is never treated as a sample, and records the epoch
    // base. Safe to call any number of times; the discarded read still
    // advances the accumulator (it is real wall time). Methods reference
    // api.* (not the this-binding) so destructured calls stay correct.
    prime: function (): void {
      api.now();
      if (!_primed) {
        _primed = true;
        _primeAbs = _abs;
      }
    },

    // Accumulated µs since the first prime() (wrap-corrected). Auto-primes
    // on first call so a forgotten prime() cannot expose startup garbage.
    epoch: function (): number {
      if (!_primed) {
        api.prime();
      }
      return api.now() - _primeAbs;
    },

    isPrimed: function (): boolean {
      return _primed;
    },

    readCount: function (): number {
      return _reads;
    },

    policy: function (): WrapPolicy {
      return _policy;
    },

    setPolicy: function (policy: WrapPolicy): void {
      _policy = policy;
    },

    // Full re-init (used by setSource). Drops all accumulated state.
    reset: function (): void {
      _primed = false;
      _lastRaw = -1;
      _abs = 0;
      _primeAbs = -1;
      _reads = 0;
    }
  };
  return api;
}
