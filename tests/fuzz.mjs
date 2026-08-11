#!/usr/bin/env node
// ESTIMER seeded differential fuzz runner. Bundles tests/fuzz-entry.ts to
// ESM, runs it in Node with the deterministic seed (default 1337), and fails
// on any divergence from the reference model / invariants. The fuzz scripts
// timer-source sequences (random deltas incl. negatives and huge values,
// first-read startup values) against the core and asserts the accumulator
// invariants plus exact stats parity with a hand-rolled reference.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

var ROOT = dirname(fileURLToPath(import.meta.url));
var PROJECT = join(ROOT, '..');
var ENTRY = join(ROOT, 'fuzz-entry.ts');
var BUNDLE = join(ROOT, '.estimer-fuzz.bundle.mjs');
var SEED = process.env.ESTIMER_FUZZ_SEED ? Number(process.env.ESTIMER_FUZZ_SEED) : 1337;
var ITERS = process.env.ESTIMER_FUZZ_ITERS ? Number(process.env.ESTIMER_FUZZ_ITERS) : 100000;

function findEsbuild() {
  if (process.env.ESBUILD_PATH && existsSync(process.env.ESBUILD_PATH)) return process.env.ESBUILD_PATH;
  var direct = join(PROJECT, 'node_modules', 'esbuild', 'bin', 'esbuild');
  if (existsSync(direct)) return direct;
  var cacheDirs = [
    join(process.env.LOCALAPPDATA || '', 'npm-cache', '_npx'),
    join(process.env.USERPROFILE || '', 'AppData', 'Local', 'npm-cache', '_npx')
  ];
  for (var i = 0; i < cacheDirs.length; i++) {
    try {
      var entries = readdirSync(cacheDirs[i]);
      for (var j = 0; j < entries.length; j++) {
        var p = join(cacheDirs[i], entries[j], 'node_modules', 'esbuild', 'bin', 'esbuild');
        if (existsSync(p)) return p;
      }
    } catch (ignore) {}
  }
  return 'npx esbuild';
}

execFileSync(process.execPath, [findEsbuild(),
  ENTRY, '--bundle', '--outfile=' + BUNDLE,
  '--format=esm', '--platform=node', '--target=es2019',
  '--log-level=warning'
], { stdio: 'inherit' });

try {
  var mod = await import(pathToFileURL(BUNDLE).href);
  var res = mod.fuzz(SEED, ITERS);
  if (res.failures > 0) {
    console.error('ESTIMER fuzz: ' + res.failures + ' divergence(s) at seed ' + SEED);
    process.exit(1);
  }
  console.log('ESTIMER fuzz: ' + res.iterations + ' differential iterations passed (seed ' + SEED + ')');
} finally {
  try { rmSync(BUNDLE); } catch (ignore) {}
}
