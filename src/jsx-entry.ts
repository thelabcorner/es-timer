import {
  best, calibrate, constants, describe, epoch, lane,
  measureMs, measureUs, median, medianOf, minOf, now, nowMs,
  prime, samples, setSource, setWrapPolicy, sleep, stats,
  stopwatch, wallNow, wrapPolicy
} from './index';

function makeFacade(): any {
  return {
    prime: prime,
    now: now,
    nowMs: nowMs,
    wallNow: wallNow,
    epoch: epoch,
    measureUs: measureUs,
    measureMs: measureMs,
    samples: samples,
    median: median,
    best: best,
    stopwatch: stopwatch,
    calibrate: calibrate,
    sleep: sleep,
    setSource: setSource,
    setWrapPolicy: setWrapPolicy,
    wrapPolicy: wrapPolicy,
    lane: lane,
    describe: describe,
    constants: constants,
    medianOf: medianOf,
    minOf: minOf,
    stats: stats
  };
}

function compatibleFacade(value: any): boolean {
  if (value === null || value === undefined) return false;
  return typeof value.prime === 'function' &&
    typeof value.now === 'function' &&
    typeof value.measureUs === 'function' &&
    typeof value.samples === 'function' &&
    typeof value.stats === 'function' &&
    typeof value.constants === 'function' &&
    typeof value.describe === 'function';
}

// ExtendScript entry points must remain side-effect-only. Exporting bindings from
// this boundary makes esbuild synthesize module namespace helpers that require
// Object.defineProperty/getOwnPropertyDescriptor/getOwnPropertyNames, which are
// not available consistently in Adobe's legacy ExtendScript engines.
var globalObject: any = $.global;
var existingFacade: any = globalObject['ESTIMER'];
if (!compatibleFacade(existingFacade)) {
  globalObject['ESTIMER'] = makeFacade();
}
