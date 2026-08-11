// bench-live.jsx — ESTIMER engine-lane benchmark probe (template).
//
// ONE lane per eval (house protocol). The runner (run-bench-live.mjs) fills
// the __LANE__ / __ENV__ tokens and writes a concrete probe to a temp dir,
// then executes it via the COM tool's `eval --file` (directive-free file →
// injected wrapper body; the file ends in a top-level return).
//
// Lanes:
//   measureUs-noop     facade read overhead via measureUs(noop) — prime+read+reject
//   now-read           bare now() read
//   epoch-read         bare epoch() read
//   stopwatch-cycle    start()+stop() full cycle
//   medianOf-31        pure array median of 31 numbers (Node-parity lane)
//   empty-loop-1e6     control lane (1e6-iteration loop, Node-parity)
//   sleep-accuracy     sleep(2/25/50/250) actual-vs-requested µs
//
// House protocol (research plan §2.7): prime before each lane; warmup 5
// discarded runs; 9 measured runs; samples validated in (0,1e8] µs, rejected
// excluded from stats; environment line recorded per run.
var __benchResult__ = (function(){
  var LANE_VAL = "__LANE__";
  var ENV_VAL = "__ENV__";   // JSON string baked by the runner (host line)
  var VENDOR = "__VENDOR__";

  function safe(fn, f) { try { return fn(); } catch (e) { return f; } }

  var EST = null;
  try {
    $.evalFile(File(VENDOR));
    EST = $.global.ESTIMER;
  } catch (e) {
    return '{"ok":false,"lane":"' + LANE_VAL + '","error":"vendor load failed: ' + String(e) + '"}';
  }
  if (!EST) {
    return '{"ok":false,"lane":"' + LANE_VAL + '","error":"ESTIMER facade not found on $.global after vendor eval"}';
  }

  var report = { ok: true, lane: LANE_VAL, env: ENV_VAL,
    engine: safe(function(){ return String($.version); }, '?'),
    host: safe(function(){ return String(app.name) + ' ' + String(app.version); }, '?'),
    lane_: safe(function(){ return EST.lane(); }, '?') };

  // Node-parity lanes use identical bodies to tests/benchmark.mjs.
  var ARR = [];
  (function () {
    var r = 12345, i = 0;
    for (i = 0; i < 31; i++) { r = (r * 1103515245 + 12345) % 2147483648; ARR[ARR.length] = r % 1000; }
  })();
  var noop = function () {};

  var lanes = {
    'measureUs-noop':  { fn: function () { EST.measureUs(noop); }, note: 'facade read overhead via measureUs (prime + read)' },
    'now-read':        { fn: function () { EST.now(); }, note: 'bare now() read' },
    'epoch-read':      { fn: function () { EST.epoch(); }, note: 'bare epoch() read' },
    'stopwatch-cycle': { fn: function () { var sw = EST.stopwatch(); sw.start(); sw.stop(); }, note: 'start()+stop() full cycle' },
    'median9-noop':    { fn: function () { EST.median(9, noop); }, note: 'full median-of-9 protocol (prime + 9 samples + validation + median)' },
    'medianOf-31':     { fn: function () { EST.medianOf(ARR); }, note: 'pure median of 31 numbers' },
    'empty-loop-1e6':  { fn: function () { var x = 0; var i2 = 0; for (i2 = 0; i2 < 1000000; i2++) { x += 1; } }, note: '1e6-iteration empty loop' }
  };

  if (LANE_VAL === 'sleep-accuracy') {
    // Sleep accuracy: actual µs slept vs requested ms, at the coarse threshold
    // and above. Uses wallNow for the wall span and sleep()'s own return.
    var outs = [];
    var reqs = [2, 25, 50, 250];
    var qi = 0;
    for (qi = 0; qi < reqs.length; qi++) {
      var reqMs = reqs[qi];
      var w0 = EST.wallNow();
      var sleptUs = EST.sleep(reqMs);
      var w1 = EST.wallNow();
      outs[outs.length] = { reqMs: reqMs, sleptUs: sleptUs, wallMs: (w1 - w0) };
    }
    report.sleep = outs;
    report.note = lanes[LANE_VAL] ? lanes[LANE_VAL].note : 'sleep accuracy: actual us vs requested ms';
    return JSON.stringify(report);
  }

  var lane = lanes[LANE_VAL];
  if (!lane) {
    return '{"ok":false,"lane":"' + LANE_VAL + '","error":"unknown lane"}';
  }

  // House protocol: prime, 5 warmups, 9 measured, reject (0,1e8], stats.
  EST.prime();
  var s = EST.samples(9, lane.fn, { warmup: 5, collectRejected: true });
  var st = EST.stats(s);
  var rej = (s.rejected && s.rejected.length) ? s.rejected.length : 0;

  // Read-overhead lane also reports calibrate() (median of 100 reads).
  if (LANE_VAL === 'measureUs-noop') {
    report.calibrateUs = EST.calibrate();
  }

  report.samples = {
    medianUs: st.median, minUs: st.min, maxUs: st.max,
    p95Us: st.p95, meanUs: st.mean, count: st.count, rejected: rej
  };
  report.raw = s;
  report.note = lane.note;
  report.describe = safe(function(){ return EST.describe(); }, null);
  return JSON.stringify(report);
})();
return __benchResult__;
