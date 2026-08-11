#!/usr/bin/env node
// ESTIMER benchmark — canonical house protocol runner, NODE lane.
//
// Protocol (research plan §2.7 / esarr/docs/benchmark-rounds-1.md):
// prime immediately before the measured run; single read after; reject
// <= 0 and > 1e8 us samples; medians-of-9; warmups 2-10; one lane per
// measurement. Runs in Node against the ESM build with performance.now as
// the source (setSource() re-detects the node lane).
//
// NOTE: the ENGINE benchmark (real $.hiresTimer, Illustrator 30.6.0) is run
// by the evidence member; this script is the Node reference lane that
// validates the protocol plumbing (samples/stats/median/rejection) and
// prints comparable numbers. Host/version reporting per
// performance-engineering.md:14-27.
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

var ROOT = dirname(fileURLToPath(import.meta.url));
var PROJECT = join(ROOT, '..');
var ESM = join(PROJECT, 'dist', 'estimer-core.esm.mjs');

if (!existsSync(ESM)) {
  console.error('benchmark: build first (npm run build) - ' + ESM + ' missing');
  process.exit(1);
}

var core = await import(pathToFileURL(ESM).href);

// Node lane (performance.now * 1000 absolute clock), prime once.
core.setSource();
core.prime();

var noop = function () {};

// A deterministic 31-element array for the pure medianOf lane.
var ARR = [];
(function () {
  var r = 12345;
  var i = 0;
  for (i = 0; i < 31; i++) {
    r = (r * 1103515245 + 12345) % 2147483648;
    ARR[ARR.length] = r % 1000;
  }
})();

var lanes = [
  { name: 'measureUs-noop', fn: noop, note: 'facade read overhead via measureUs (prime + read)' },
  { name: 'now-read', fn: function () { core.now(); }, note: 'bare now() read' },
  { name: 'epoch-read', fn: function () { core.epoch(); }, note: 'bare epoch() read' },
  { name: 'medianOf-31', fn: function () { core.medianOf(ARR); }, note: 'pure median of 31 numbers' },
  { name: 'empty-loop-1e6', fn: function () { var x = 0; var i2 = 0; for (i2 = 0; i2 < 1000000; i2++) { x += 1; } }, note: '1e6-iteration empty loop' }
];

console.log('ESTIMER benchmark - node lane (' + core.lane() + '), performance.now source');
console.log('engine benchmark on the real $.hiresTimer is run by the evidence member; this is the');
console.log('Node reference run of the canonical protocol (prime, medians-of-9, warmups 5, rejection).');
var readOverhead = core.calibrate();
console.log('calibrated read overhead: ' + readOverhead.toFixed(2) + ' us');
console.log('');
console.log('lane                medianUs  minUs     p95Us     n    rej');
var li = 0;
for (li = 0; li < lanes.length; li++) {
  var lane = lanes[li];
  core.prime();
  var s = core.samples(9, lane.fn, { warmup: 5, collectRejected: true });
  var st = core.stats(s);
  var rej = (s.rejected && s.rejected.length) ? s.rejected.length : 0;
  var pad = function (t, w) {
    while (t.length < w) { t = t + ' '; }
    return t;
  };
  var padL = function (t, w) {
    while (t.length < w) { t = ' ' + t; }
    return t;
  };
  var f2 = function (v) { return v.toFixed(2); };
  console.log(pad(lane.name, 19) + padL(f2(st.median), 9) + padL(f2(st.min), 9) +
    padL(f2(st.p95), 9) + padL(String(st.count), 5) + padL(String(rej), 5));
}
console.log('');
var host = core.describe();
console.log('host: node ' + process.version + ' | lane=' + host.lane + ' | wrapPolicy=' + host.wrapPolicy +
  ' | primed=' + host.primed + ' | calibratedUs=' + host.calibratedUs);
console.log('');
console.log('protocol: prime before each lane; 5 warmups discarded; 9 measured runs per lane;');
console.log('samples validated in (0, 1e8] us - rejected samples excluded from stats (n < 9 when');
console.log('rejections occur, rej column shows how many).');
var notes = [];
for (li = 0; li < lanes.length; li++) { notes[notes.length] = lanes[li].name + ' = ' + lanes[li].note; }
console.log('note: ' + notes.join('; '));
