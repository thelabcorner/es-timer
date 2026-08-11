// ESTIMER Node conformance harness.
//
// Covers: constants; lane/describe; prime/now/epoch semantics (startup
// absorption, idempotent prime, epoch auto-prime); 32-bit wrap policies
// ('correct'/'reject') driven by a SCRIPTED fake TimerSource — no 35-minute
// waits; read-failure freeze; measureUs/measureMs rejection protocol;
// samples() valid-subset + rejected bookkeeping; median(n,fn)/best(n,fn);
// medianOf/stats vs a hand-rolled reference model (fixed vectors + seeded
// differential); stopwatch nesting (the outer-interval corruption fix);
// sleep/calibrate/wallNow/nowMs.
//
// Contract reference: src/types.ts + src/timer-core.ts + the t1-core API
// note (functions-only exports; stats = upper-median sorted[floor(n/2)]).
import * as core from '../src/index';
import {
  CLOCK_VECTORS, MEDIAN_VECTORS, STATS_VECTORS,
  REJECTED_SAMPLES_INPUT, REJECTED_SAMPLES_EXPECT,
  makeFake, refMedian, refStats, numEq
} from './vectors';

var failures: string[] = [];
var passed = 0;

function check(desc: string, actual: any, expected: any): void {
  if (numEq(actual, expected)) {
    passed++;
  } else {
    failures[failures.length] = desc + ': expected ' + String(expected) + ' got ' + String(actual);
  }
}

function checkStats(desc: string, actual: any, expected: any): void {
  var fields = ['count', 'min', 'max', 'mean', 'median', 'p95', 'p99', 'rejected'];
  var all = true;
  var i = 0;
  for (i = 0; i < fields.length; i++) {
    if (!numEq(actual[fields[i]], expected[fields[i]])) { all = false; }
  }
  if (all) {
    passed++;
  } else {
    var detail = '';
    for (i = 0; i < fields.length; i++) {
      detail += fields[i] + '=' + String(actual[fields[i]]) + '(want ' + String(expected[fields[i]]) + ') ';
    }
    failures[failures.length] = desc + ': ' + detail;
  }
}

function noop(): void {}

// Deterministic PRNG for the differential sweeps (fixed seed => reproducible).
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

// Restore the auto-detected lane (Node: performance.now absolute clock) so
// sleep/calibrate/measureUs lanes use the real source, not a scripted fake.
function resetSource(): void {
  core.setSource();
}

// ---- 1. constants -----------------------------------------------------------
var C = core.constants();
check('constants.MAX_VALID_US', C.MAX_VALID_US, 100000000);
check('constants.MAX_VALID_MS', C.MAX_VALID_MS, 100000);
check('constants.MIN_VALID_US', C.MIN_VALID_US, 0);
check('constants.WRAP_PERIOD_US', C.WRAP_PERIOD_US, 4294967296);
check('constants.WRAP_POINT_US', C.WRAP_POINT_US, 2147483648);
check('constants.SLEEP_COARSE_THRESHOLD_MS', C.SLEEP_COARSE_THRESHOLD_MS, 25);

// ---- 2. lane / describe defaults --------------------------------------------
resetSource();
check('lane is node in Node', core.lane(), 'node');
var d0: any = core.describe();
check('describe.lane', d0.lane, 'node');
check('describe.wrapPolicy default', d0.wrapPolicy, 'correct');
check('describe.primed initial false', d0.primed, false);
check('describe.reads initial 0', d0.reads, 0);
check('describe.calibratedUs initial 0', d0.calibratedUs, 0);
check('describe.engine string', typeof d0.engine === 'string', true);

// ---- 3. clock vectors: prime/now/epoch + wrap policies ----------------------
// now() lane and epoch() lane are driven on FRESH sources: epoch() consumes a
// read per call, so the two lanes are kept separate and both assert against
// the same scripted vectors.
var v = 0;
var r = 0;
for (v = 0; v < CLOCK_VECTORS.length; v++) {
  var cv = CLOCK_VECTORS[v];
  // now() lane
  core.setSource(makeFake(cv.ticks));
  core.setWrapPolicy(cv.policy);
  core.prime();
  for (r = 0; r < cv.nowAfterPrime.length; r++) {
    check(cv.desc + ' now[' + r + ']', core.now(), cv.nowAfterPrime[r]);
  }
  // epoch() lane (fresh source; epoch = now() - primeAbs)
  core.setSource(makeFake(cv.ticks));
  core.setWrapPolicy(cv.policy);
  core.prime();
  for (r = 0; r < cv.epochAfterPrime.length; r++) {
    check(cv.desc + ' epoch[' + r + ']', core.epoch(), cv.epochAfterPrime[r]);
  }
}

// reads accounting: prime + 3 now() = 4 raw reads
core.setSource(makeFake([0, 1, 2, 3]));
core.setWrapPolicy('correct');
core.prime();
core.now();
core.now();
core.now();
check('describe.reads counts raw reads', core.describe().reads, 4);

// ---- 4. double prime: idempotent, epoch base stays at FIRST prime -----------
core.setSource(makeFake([5000000, 9000000, 0, 7, 3]));
core.prime();
core.prime();
check('double-prime now includes second prime read', core.now(), 14000000);
check('double-prime epoch base unchanged', core.epoch(), 9000007);

// ---- 5. epoch auto-primes on first call --------------------------------------
core.setSource(makeFake([5000000, 100, 200]));
check('epoch auto-prime first', core.epoch(), 100);
check('epoch auto-prime second', core.epoch(), 300);

// ---- 6. read failure freezes the clock (never backwards) ----------------------
var throwAfter2 = { reads: 0 };
core.setSource({
  readUs: function (): number {
    throwAfter2.reads++;
    if (throwAfter2.reads > 2) { throw new Error('boom'); }
    return 10;
  },
  delta: true,
  wraps: false
});
core.prime();
check('read-failure freezes clock', core.now(), 20);
check('read-failure freeze persists', core.now(), 20);
check('read-failure freeze persists 2', core.now(), 20);

// ---- 7. wrap policy API -------------------------------------------------------
resetSource();
check('wrapPolicy default correct', core.wrapPolicy(), 'correct');
core.setWrapPolicy('reject');
check('wrapPolicy set reject', core.wrapPolicy(), 'reject');
check('describe reflects policy', core.describe().wrapPolicy, 'reject');
core.setWrapPolicy('correct');
check('wrapPolicy restored', core.wrapPolicy(), 'correct');

// ---- 8. measureUs: validation protocol ----------------------------------------
function measScript(d: number): void {
  core.setSource(makeFake([5000000, d]));
}
measScript(12345);
check('measureUs valid sample', core.measureUs(noop), 12345);
measScript(0);
check('measureUs rejects zero', core.measureUs(noop), null);
measScript(-50);
check('measureUs rejects negative', core.measureUs(noop), null);
measScript(999999999);
check('measureUs rejects over default cap (1e8)', core.measureUs(noop), null);
measScript(99999999);
check('measureUs accepts under default cap', core.measureUs(noop), 99999999);
measScript(12345);
check('measureUs rejects over custom cap', core.measureUs(noop, 100), null);
measScript(77);
check('measureUs accepts under custom cap', core.measureUs(noop, 100), 77);
var ran = false;
core.setSource(makeFake([5000000, 42]));
var mu = core.measureUs(function (): void { ran = true; });
check('measureUs runs the callback', ran, true);
check('measureUs callback delta', mu, 42);

// ---- 9. measureMs --------------------------------------------------------------
core.setSource(makeFake([5000000, 2500]));
check('measureMs valid (us->ms)', core.measureMs(noop), 2.5);
core.setSource(makeFake([5000000, 0]));
check('measureMs rejects zero', core.measureMs(noop), null);
core.setSource(makeFake([5000000, 250000]));
check('measureMs converts us to ms', core.measureMs(noop), 250);

// ---- 10. samples(): valid subset + rejected bookkeeping ------------------------
// Warmup 1 + 3 measured runs. The scripted -5 measured delta is wrap-corrected
// by the 'correct' policy (wraps:true source) to -5 + 2^32 = 4294967291,
// which is > maxValidUs 1e8, so the rejected reason is 'above-max' and the
// recorded value is the corrected delta (t1 - t0 through the accumulator).
core.setWrapPolicy('correct');
core.setSource(makeFake([5000000, 0, 0, 100, 0, -5, 0, 200]));
var sp: any = core.samples(3, noop, { warmup: 1, collectRejected: true });
check('samples valid length', sp.length, 2);
check('samples[0]', sp[0], 100);
check('samples[1]', sp[1], 200);
check('samples rejected count', sp.rejected ? sp.rejected.length : -1, 1);
check('samples rejected index (measured iterations)', sp.rejected ? sp.rejected[0].index : NaN, 1);
check('samples rejected entry value (wrap-corrected)', sp.rejected ? sp.rejected[0].value : NaN, 4294967291);
check('samples rejected reason above-max', sp.rejected ? sp.rejected[0].reason : '', 'above-max');
check('stats carries rejected count', core.stats(sp).rejected, 1);

core.setSource(makeFake([5000000, 100, 0, 200]));
var sp2: any = core.samples(2, noop, { warmup: 0 });
check('samples without collectRejected length', sp2.length, 2);
check('samples no rejected prop', sp2.rejected === undefined, true);
check('stats rejected 0 without carry', core.stats(sp2).rejected, 0);

core.setSource(makeFake([5000000, 100]));
var sp3: any = core.samples(1, noop, { warmup: 0, minValidUs: 5000 });
check('samples below-min rejected', sp3.length, 0);

core.setSource(makeFake([5000000, 100]));
var sp4: any = core.samples(1, noop, { warmup: 0, maxValidUs: 50 });
check('samples above-max rejected', sp4.length, 0);

// ---- 11. median(n, fn) / best(n, fn): median-of-n primed samples ----------------
// 2 warmups + 9 measured runs; measured deltas [5,1,9,3,7,2,8,4,6] (sorted ->
// median 5, best 1). Each run = 1 t0 read + 1 t1 read (2 ticks).
var medTicks: number[] = [5000000, 0, 0, 0, 0, 5, 0, 1, 0, 9, 0, 3, 0, 7, 0, 2, 0, 8, 0, 4, 0, 6];
core.setSource(makeFake(medTicks));
check('median(9) of scripted samples', core.median(9, noop, { warmup: 2 }), 5);
core.setSource(makeFake(medTicks));
check('best(9) of scripted samples', core.best(9, noop, { warmup: 2 }), 1);

// all measured deltas rejected -> null (median-of-n has no valid sample)
var rejTicks: number[] = [5000000];
var i = 0;
for (i = 0; i < 18; i++) { rejTicks[rejTicks.length] = 0; }
core.setSource(makeFake(rejTicks));
check('median(9) all-rejected null', core.median(9, noop, { warmup: 0 }), null);

// ---- 12. medianOf: pure array median --------------------------------------------
for (var mv = 0; mv < MEDIAN_VECTORS.length; mv++) {
  check('medianOf ' + MEDIAN_VECTORS[mv].desc, core.medianOf(MEDIAN_VECTORS[mv].values), MEDIAN_VECTORS[mv].expect);
}
var rnd = mulberry32(424242);
var MDIFF = 2000;
for (var di = 0; di < MDIFF; di++) {
  var n1 = 1 + Math.floor(rnd() * 40);
  var arr = [];
  var k = 0;
  for (k = 0; k < n1; k++) { arr[arr.length] = Math.floor((rnd() - 0.5) * 2e12); }
  check('medianOf diff[' + di + ']', core.medianOf(arr), refMedian(arr));
}

// ---- 13. stats: fixed vectors + differential + purity ----------------------------
for (var sv = 0; sv < STATS_VECTORS.length; sv++) {
  checkStats('stats ' + STATS_VECTORS[sv].desc, core.stats(STATS_VECTORS[sv].samples), STATS_VECTORS[sv].expect);
}
var rc: any = REJECTED_SAMPLES_INPUT.slice(0);
rc.rejected = [{ index: 0, value: -5, reason: 'negative' }];
checkStats('stats rejected carry', core.stats(rc), REJECTED_SAMPLES_EXPECT);
var nm = [3, 1, 2];
core.stats(nm);
check('stats does not mutate input', nm[0] === 3 && nm[1] === 1 && nm[2] === 2, true);
var nm2 = [3, 1, 2];
core.medianOf(nm2);
check('medianOf does not mutate input', nm2[0] === 3 && nm2[1] === 1 && nm2[2] === 2, true);
var rnd2 = mulberry32(777777);
var SDIFF = 3000;
for (di = 0; di < SDIFF; di++) {
  var n2 = 1 + Math.floor(rnd2() * 40);
  var arr2 = [];
  for (k = 0; k < n2; k++) { arr2[arr2.length] = Math.floor((rnd2() - 0.5) * 2e12); }
  checkStats('stats diff[' + di + ']', core.stats(arr2), refStats(arr2));
}

// ---- 14. stopwatch: nesting-safe by construction --------------------------------
core.setSource(makeFake([5000000, 0, 10, 20, 30]));
core.prime();
var swA: any = core.stopwatch();
var swB: any = core.stopwatch();
swA.start();
swB.start();
var bRun = swB.stop();
var aRun = swA.stop();
check('stopwatch nested inner run', bRun, 20);
check('stopwatch nested outer run', aRun, 60);
check('stopwatch elapsed cumulative', swA.elapsed(), 60);
check('stopwatch running false after stop', swA.running, false);

// double-start is a no-op (must NOT corrupt the run)
core.setSource(makeFake([5000000, 0, 42]));
core.prime();
var swC: any = core.stopwatch();
swC.start();
swC.start();
check('stopwatch double-start no-op', swC.stop(), 42);

// stop while not running returns 0; elapsed keeps the completed sum
core.setSource(makeFake([5000000, 0, 42]));
core.prime();
var swD: any = core.stopwatch();
swD.start();
check('stopwatch first stop', swD.stop(), 42);
check('stopwatch stop-not-running 0', swD.stop(), 0);
check('stopwatch elapsed after stop', swD.elapsed(), 42);

// reset zeroes the accumulator
var swE: any = core.stopwatch();
swE.start();
swE.stop();
swE.reset();
check('stopwatch reset elapsed 0', swE.elapsed(), 0);

// ---- 15. sleep: busy-wait, real node lane -----------------------------------------
resetSource();
var t0 = performance.now();
var slept = core.sleep(10);
var t1 = performance.now();
check('sleep(10) wall in [5,2000] ms', (t1 - t0) >= 5 && (t1 - t0) <= 2000, true);
check('sleep(10) returns ~10ms in us', slept >= 5000 && slept <= 500000, true);
var z0 = performance.now();
var zs = core.sleep(0);
var z1 = performance.now();
check('sleep(0) near-zero return', zs >= 0 && zs <= 50000, true);
check('sleep(0) wall small', (z1 - z0) <= 1000, true);

// ---- 16. calibrate: median read overhead ---------------------------------------------
resetSource();
var cal = core.calibrate(100);
check('calibrate(100) returns number', typeof cal === 'number' && !isNaN(cal) && cal >= 0 && cal < 1000000, true);
var cal2 = core.calibrate();
check('calibrate() default also number', typeof cal2 === 'number' && !isNaN(cal2) && cal2 >= 0, true);

// ---- 17. wallNow: long-span lane --------------------------------------------------------
resetSource();
check('wallNow close to Date.now', Math.abs(core.wallNow() - Date.now()) <= 5000, true);

// ---- 18. nowMs ---------------------------------------------------------------------------
core.setSource(makeFake([5000000, 2000, 4000]));
core.prime();
check('now() scripted', core.now(), 5002000);
check('nowMs() scripted (us/1000)', core.nowMs(), 5006);

// ---- summary -----------------------------------------------------------------------------
if (failures.length > 0) {
  console.error('ESTIMER TEST FAILURES (' + failures.length + '):');
  for (var f = 0; f < failures.length && f < 25; f++) {
    console.error('  ' + failures[f]);
  }
  throw new Error(failures.length + ' ESTIMER test failure(s)');
}
console.log('ESTIMER tests: ' + passed + ' checks passed (' + CLOCK_VECTORS.length + ' clock vectors + ' +
  STATS_VECTORS.length + ' stats vectors + ' + MEDIAN_VECTORS.length + ' median vectors + ' +
  MDIFF + ' medianOf differential + ' + SDIFF + ' stats differential)');
