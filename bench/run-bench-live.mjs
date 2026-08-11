#!/usr/bin/env node
// ESTIMER engine-lane benchmark runner — drives bench-live.jsx through the
// COM tool against the RUNNING Illustrator 30.6.0 engine (ExtendScript 4.5.6).
//
// House protocol (research plan §2.7 / esarr docs): prime immediately before
// the measured run; medians-of-9; warmups 5; outlier rejection (0,1e8] µs;
// one lane per eval; environment line recorded per run.
//
// Usage: node bench/run-bench-live.mjs [--lanes a,b,c] [--rounds N]
// Requires: dist/vendor-estimer.js (npm run build) + Illustrator running.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

var ROOT = dirname(fileURLToPath(import.meta.url));
var PROJECT = join(ROOT, '..');
var DIST = join(PROJECT, 'dist');
var VENDOR = join(DIST, 'vendor-estimer.js');
var TEMPLATE = join(ROOT, 'bench-live.jsx');
var TOOL = 'C:/Program Files/Adobe/Adobe Illustrator 2026/Presets/en_US/Scripts/agent-skills/illustrator-com-automation-skill/comtool/ILLUSTRATOR_COM_TOOL.py';

var argv = process.argv.slice(2);
var lanesArg = '';
var rounds = 3;
for (var i = 0; i < argv.length; i++) {
  if (argv[i] === '--lanes' && i + 1 < argv.length) { lanesArg = argv[i + 1]; i++; }
  else if (argv[i] === '--rounds' && i + 1 < argv.length) { rounds = parseInt(argv[i + 1], 10); i++; }
}

var ALL_LANES = ['measureUs-noop', 'now-read', 'epoch-read', 'stopwatch-cycle', 'medianOf-31', 'empty-loop-1e6', 'sleep-accuracy'];
var lanes = lanesArg ? lanesArg.split(',').map(function (s) { return s.trim(); }).filter(Boolean) : ALL_LANES;

if (!existsSync(VENDOR)) {
  console.error('bench-live: build first (npm run build) — ' + VENDOR + ' missing');
  process.exit(1);
}
if (!existsSync(TEMPLATE)) {
  console.error('bench-live: template missing — ' + TEMPLATE);
  process.exit(1);
}

var envJson = JSON.stringify({
  host: 'Illustrator 30.6.0 build 109R',
  engine: 'ExtendScript 4.5.6',
  os: 'Windows/64 10.0',
  route: 'COM eval --file (injected directive-free)',
  whenIso: new Date().toISOString(),
  protocol: 'prime-before-lane; warmup 5; 9 measured runs; reject (0,1e8] us; one lane per eval'
});

var tmpDir = join(process.env.TEMP || '.', 'estimer-bench');
mkdirSync(tmpDir, { recursive: true });

var tpl = readFileSync(TEMPLATE, 'utf8');
var vendorForProbe = VENDOR.replace(/\\/g, '/');
// Embed the env record as a JS string literal: JSON text, quotes escaped.
var envLiteral = envJson.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
var outDir = join(PROJECT, 'bench', 'raw');
mkdirSync(outDir, { recursive: true });

var results = {};
var li = 0;
for (li = 0; li < lanes.length; li++) {
  var lane = lanes[li];
  var probe = tpl
    .replace(/__LANE__/g, lane)
    .replace('__ENV__', envLiteral)
    .replace(/__VENDOR__/g, vendorForProbe);
  var probePath = join(tmpDir, 'bench-' + lane + '.jsx');
  writeFileSync(probePath, probe);

  var out = '';
  for (var r = 0; r < rounds; r++) {
    try {
      out = execFileSync('python', [TOOL, 'eval', '--file', probePath.replace(/\\/g, '/'), '--no-launch', '--timeout', '120'], { encoding: 'utf8', timeout: 300000 });
    } catch (e) {
      console.error('bench-live: lane ' + lane + ' round ' + r + ' COM eval failed: ' + String(e));
      process.exit(1);
    }
    var env;
    try { env = JSON.parse(out.trim()); } catch (e) { console.error('bench-live: bad tool output for ' + lane + ': ' + out.slice(0, 400)); process.exit(1); }
    if (!env || !env.ok || !env.result) {
      console.error('bench-live: lane ' + lane + ' tool/engine error: ' + JSON.stringify(env).slice(0, 600));
      process.exit(1);
    }
    var rep = env.result.result || env.result;
    if (typeof rep === 'string') { try { rep = JSON.parse(rep); } catch (e) {} }
    if (!rep || !rep.ok) {
      console.error('bench-live: lane ' + lane + ' probe error: ' + JSON.stringify(rep).slice(0, 600));
      process.exit(1);
    }
    if (!results[lane]) { results[lane] = []; }
    results[lane].push(rep);
  }
}

// Persist raw per-lane results.
writeFileSync(join(outDir, 'bench-live-raw-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json'),
  JSON.stringify(results, null, 2));

// Print table (median of the rounds for each metric).
console.log('ESTIMER engine benchmark — Illustrator 30.6.0 (109R), ExtendScript 4.5.6, Windows 10/64');
console.log('protocol: prime-before-lane; warmup 5; 9 measured runs/lane; reject (0,1e8] us; one lane per eval; ' + rounds + ' rounds');
console.log('raw: bench/raw/');
console.log('');
console.log('lane                medianUs  minUs     p95Us     n    rej');
function pad(t, w) { while (t.length < w) { t = t + ' '; } return t; }
function padL(t, w) { t = String(t); while (t.length < w) { t = ' ' + t; } return t; }
var laneNames = Object.keys(results);
for (var k = 0; k < laneNames.length; k++) {
  var name = laneNames[k];
  if (name === 'sleep-accuracy') {
    // separate table below
    continue;
  }
  var medians = [], mins = [], p95s = [], counts = [], rejs = [];
  for (var r2 = 0; r2 < results[name].length; r2++) {
    var sp = results[name][r2].samples;
    medians.push(sp.medianUs); mins.push(sp.minUs); p95s.push(sp.p95Us); counts.push(sp.count); rejs.push(sp.rejected);
  }
  medians.sort(function (a, b) { return a - b; }); mins.sort(function (a, b) { return a - b; }); p95s.sort(function (a, b) { return a - b; });
  var m = medians[Math.floor(medians.length / 2)];
  var mn = mins[0];
  var p9 = p95s[Math.floor(p95s.length / 2)];
  var c = counts[0];
  var re = rejs[rejs.length - 1];
  console.log(pad(name, 19) + padL(m, 9) + padL(mn, 9) + padL(p9, 9) + padL(c, 5) + padL(re, 5));
}
console.log('');
console.log('sleep accuracy (sleep() actual µs vs requested ms, wallNow span):');
console.log('  reqMs   sleptUs(median)  wallMs(median)  error%');
if (results['sleep-accuracy']) {
  var runs = results['sleep-accuracy'];
  var reqs = [2, 25, 50, 250];
  for (var qi = 0; qi < reqs.length; qi++) {
    var vals = [];
    for (var r3 = 0; r3 < runs.length; r3++) {
      var slot = null;
      for (var x = 0; x < runs[r3].sleep.length; x++) { if (runs[r3].sleep[x].reqMs === reqs[qi]) { slot = runs[r3].sleep[x]; } }
      if (slot) { vals.push(slot); }
    }
    var sleepMed = vals.slice().sort(function (a, b) { return a.sleptUs - b.sleptUs; });
    var wallMed = vals.slice().sort(function (a, b) { return a.wallMs - b.wallMs; });
    var sM = sleepMed[Math.floor(sleepMed.length / 2)];
    var wM = wallMed[Math.floor(wallMed.length / 2)];
    var errPct = (sM && sM.sleptUs) ? ((sM.sleptUs - reqs[qi] * 1000) / (reqs[qi] * 1000) * 100) : null;
    console.log(padL(reqs[qi], 8) + padL(sM ? sM.sleptUs : '-', 15) + padL(wM ? wM.wallMs : '-', 16) + padL(errPct == null ? '-' : errPct.toFixed(1), 8));
  }
}
console.log('');
console.log('host: ' + envJson);
