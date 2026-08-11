// ESTIMER sleep — calibrated sleep with an injected µs clock (pure; no host
// globals, no runtime deps).
//
// ExtendScript's $.sleep polls coarsely (~100 ms granularity; can overrun or
// wake early per Adobe_Illustrator_ScriptUI_Research_Guide.md:340) — fine
// for pauses, useless for timing. ESTIMER.sleep therefore:
//
//   - below the coarse threshold (default 25 ms): a pure busy-wait on the
//     accumulator clock — exact to the read granularity (~2-4 µs engine);
//   - at/above the threshold, in the engine: $.sleep(ms - 1) then a final
//     calibrated busy-wait to land exactly on the target. If $.sleep
//     overshoots (its poll granularity), the actual sleep exceeds ms —
//     never the reverse: the final busy-wait guarantees we never wake
//     before the target. The returned value is the actual µs slept (the
//     evidence lane).
//   - in Node: busy-wait only. No setTimeout, no Atomics.wait — ES3 has
//     neither, and the Node lane must run identically for test parity
//     (t1-core constraint). A Node busy-wait burns a core; that is the
//     accepted cost of one code path, and Node sleep exists for harness
//     parity, not production timing.
export var COARSE_THRESHOLD_MS = 25;

var FINAL_MARGIN_MS = 1; // coarse lane hands off ~1 ms early; the busy-wait
                         // lands the remainder (design doc §8)

export function sleepCore(ms: number, now: () => number, coarse?: (ms: number) => void, thresholdMs?: number): number {
  var t = (thresholdMs === void 0 || thresholdMs === null) ? COARSE_THRESHOLD_MS : thresholdMs;
  if (!(ms > 0)) {
    return 0; // NaN, negative, 0, undefined all fall here
  }
  var spanUs = Math.floor(ms * 1000);
  var startUs = now();
  var targetUs = startUs + spanUs;
  if (typeof coarse === 'function' && ms >= t) {
    coarse(ms - FINAL_MARGIN_MS);
  }
  busyWait(targetUs, now);
  return now() - startUs; // actual µs slept (includes read overhead; evidence)
}

// Calibrated spin: one clock read per iteration. Engine reads cost ~2-4 µs,
// so the landing error is a few µs — well inside the ~1 ms design target.
function busyWait(untilUs: number, now: () => number): void {
  while (now() < untilUs) { /* calibrated spin */ }
}
