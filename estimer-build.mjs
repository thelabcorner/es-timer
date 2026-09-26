#!/usr/bin/env node
// ESTIMER build:
//   1. Node ESM bundle for the deterministic harnesses.
//   2. Canonical ExtendScript standalone/vendor artifacts through shared ESTC.
//
// ESTC owns ExtendScript compatibility. Do not add project-local parser/runtime
// shims here; compatibility findings belong in the shared checker or in an
// explicit ESTIMER project contract/config.
import { execFileSync } from 'node:child_process';
import { buildSync } from 'esbuild';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

var ROOT = dirname(fileURLToPath(import.meta.url));
var DIST = join(ROOT, 'dist');
var ENTRY = join(ROOT, 'src', 'index.ts');
var ESTC = join(ROOT, '..', 'extendscript-toolchain', 'bin', 'estc.mjs');

mkdirSync(DIST, { recursive: true });

buildSync({
  entryPoints: [ENTRY],
  outfile: join(DIST, 'estimer-core.esm.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'es2019',
  logLevel: 'warning'
});

function estcBuild(config) {
  execFileSync(process.execPath, [ESTC, 'build', '--config', config], {
    cwd: ROOT,
    stdio: 'inherit'
  });
}

function assertNoDescriptorModuleHelpers(path) {
  var source = readFileSync(path, 'utf8');
  var forbidden = ['defineProperty', 'getOwnPropertyDescriptor', 'getOwnPropertyNames'];
  for (var i = 0; i < forbidden.length; i++) {
    if (source.indexOf(forbidden[i]) !== -1) {
      throw new Error(
        'ExtendScript artifact contains forbidden esbuild module helper dependency ' +
        forbidden[i] + ': ' + path + '. Keep JSX entry points side-effect-only.'
      );
    }
  }
}

estcBuild('./extendscript.estc.config.mjs');
estcBuild('./extendscript.vendor.estc.config.mjs');
assertNoDescriptorModuleHelpers(join(DIST, 'ESTIMER.jsx'));
assertNoDescriptorModuleHelpers(join(DIST, 'vendor-estimer.js'));

console.log('[estimer-build] wrote dist/ESTIMER.jsx, dist/vendor-estimer.js and dist/estimer-core.esm.mjs via ESTC');
