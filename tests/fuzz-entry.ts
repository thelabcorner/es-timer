// ESTIMER seeded differential fuzz.
//
// Lanes (each iteration is one differential check):
//   1. clock — scripted delta:true wraps:true source sequences (random
//      deltas incl. negatives, huge values, wrap-boundary, first-read
//      startup) with a randomly chosen wrap policy; now() must match the
//      reference accumulator (refClock) EXACTLY after every read, and never
//      go negative (the reference is the "plausible bounds" model: the
//      documented 'correct'/'reject' policy).
//   2. measureUs — random raw deltas vs the documented validation
//      (d > 0 && d <= maxValidUs ? d : null); fresh source per call.
//   3. stats — random integer sample arrays vs refStats (integer sums are
//      exact in doubles, so the comparison is bit-for-bit, order-independent).
//   4. medianOf — random arrays vs refMedian.
//
// Seed 1337 by default (ESTIMER_FUZZ_SEED / ESTIMER_FUZZ_ITERS override).
import * as core from '../src/index';
import { makeFake, refClock, refMedian, refStats } from './vectors';

function mulberry32(seed: number): () => number {
  var a = seed >>> 0;
  return function (): number {
    a = (a + 0x6D2B79F5) | 0;
    var t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function noop(): void {}

function statsEq(g: any, w: any): boolean {
  var fields = ['count', 'min', 'max', 'mean', 'median', 'p95', 'p99', 'rejected'];
  var i = 0;
  for (i = 0; i < fields.length; i++) {
    var a = g[fields[i]];
    var b = w[fields[i]];
    if (a !== b) { return false; }
  }
  return true;
}

export function fuzz(seed: number, iterations: number): { failures: number; iterations: number } {
  var rnd = mulberry32(seed);
  var failures = 0;
  var total = 0;
  var it = 0;
  var i = 0;
  var j = 0;

  function fail(desc: string): void {
    if (failures < 5) { console.error('fuzz: ' + desc); }
    failures++;
  }

  // ---- lane 1: clock differential (policy-randomized) -------------------------
  for (it = 0; it < iterations; it++) {
    var policy: any = rnd() < 0.5 ? 'correct' : 'reject';
    var len = 5 + Math.floor(rnd() * 25);
    var ticks: number[] = [Math.floor(rnd() * 1e9)]; // startup/thread-init read
    var clean = rnd() < 0.7;
    for (i = 1; i <= len; i++) {
      var d = 0;
      if (clean) {
        d = Math.floor(rnd() * 200000);
      } else {
        var r = rnd();
        if (r < 0.4) {
          d = -Math.floor(rnd() * 3000000000);
        } else if (r < 0.7) {
          d = Math.floor(rnd() * 5000000000000);
        } else {
          d = (rnd() < 0.5 ? 1 : -1) * (2147483647 + Math.floor(rnd() * 4294967296));
        }
      }
      ticks[ticks.length] = d;
    }
    core.setSource(makeFake(ticks));
    core.setWrapPolicy(policy);
    core.prime(); // consumes ticks[0]
    var ref = refClock(ticks, policy);
    for (j = 1; j <= len; j++) {
      total++;
      var v = core.now();
      if (v !== ref[j]) {
        fail('clock[' + it + '] policy=' + policy + ' read=' + j + ' now=' + v + ' ref=' + ref[j] +
          ' ticks=' + ticks.join(','));
        break;
      }
      if (v < 0) {
        fail('clock[' + it + '] negative now() ' + v);
        break;
      }
    }
    if (failures > 5) { return { failures: failures, iterations: total }; }
  }

  // ---- lane 2: measureUs validation differential -------------------------------
  for (it = 0; it < iterations; it++) {
    var policy2: any = rnd() < 0.5 ? 'correct' : 'reject';
    var d2 = (rnd() < 0.5 ? 1 : -1) * Math.floor(rnd() * 5000000000000);
    var maxU = rnd() < 0.3 ? 1 + Math.floor(rnd() * 100000000) : 100000000;
    core.setWrapPolicy(policy2);
    core.setSource(makeFake([Math.floor(rnd() * 1e9), d2]));
    var got = core.measureUs(noop, maxU);
    // Reference: the accumulator wrap-corrects the raw delta first ('correct':
    // negative += 2^32, still-negative -> 0; 'reject': negative -> 0), then the
    // house validation (d > 0 && d <= maxU) applies. A wrap-recovered interval
    // that lands inside the valid band is a legitimate measurement.
    var corr = d2;
    if (d2 < 0) {
      if (policy2 === 'correct') { corr = d2 + 4294967296; }
      else { corr = 0; }
    }
    if (corr < 0) { corr = 0; }
    var want = (corr > 0 && corr <= maxU) ? corr : null;
    total++;
    if (got !== want) {
      fail('measureUs[' + it + '] delta=' + d2 + ' max=' + maxU + ' policy=' + policy2 + ' got=' + got + ' want=' + want);
      if (failures > 5) { return { failures: failures, iterations: total }; }
    }
  }

  // ---- lane 3: stats differential (integer samples, bit-exact) ------------------
  for (it = 0; it < iterations; it++) {
    var n3 = 1 + Math.floor(rnd() * 40);
    var arr: number[] = [];
    for (i = 0; i < n3; i++) {
      arr[arr.length] = Math.floor((rnd() - 0.5) * 2e12);
    }
    total++;
    if (!statsEq(core.stats(arr), refStats(arr))) {
      fail('stats[' + it + '] divergence on [' + arr.join(',') + ']');
      if (failures > 5) { return { failures: failures, iterations: total }; }
    }
  }

  // ---- lane 4: medianOf differential ---------------------------------------------
  for (it = 0; it < iterations; it++) {
    var n4 = 1 + Math.floor(rnd() * 40);
    var arr2: number[] = [];
    for (i = 0; i < n4; i++) {
      arr2[arr2.length] = (rnd() - 0.5) * 2e12;
    }
    total++;
    if (core.medianOf(arr2) !== refMedian(arr2)) {
      fail('medianOf[' + it + '] divergence on [' + arr2.join(',') + ']');
      if (failures > 5) { return { failures: failures, iterations: total }; }
    }
  }

  return { failures: failures, iterations: total };
}
