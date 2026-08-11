#!/usr/bin/env node
// ESTIMER build: bundles the TypeScript core into
//   dist/ESTIMER.jsx           - bannerless IIFE (COM-eval / $.evalFile safe),
//                                defines var ESTIMER (the facade)
//   dist/vendor-estimer.js     - production drop-in: facade + install footer
//                                that assigns $.global.ESTIMER (true drop-in)
//   dist/estimer-core.esm.mjs  - ESM bundle of the core for Node harnesses
//
// No runtime-slim build: the ESTIMER facade does not split into a
// methods-only core + install-time extras the way ESSTR does; the whole
// facade is the payload, so a slim build would only duplicate it.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

var ROOT = dirname(fileURLToPath(import.meta.url));
var DIST = join(ROOT, 'dist');
var ENTRY = join(ROOT, 'src', 'index.ts');

function findEsbuild() {
  if (process.env.ESBUILD_PATH && existsSync(process.env.ESBUILD_PATH)) return process.env.ESBUILD_PATH;
  var direct = join(ROOT, 'node_modules', 'esbuild', 'bin', 'esbuild');
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

function esmBuild(entry, outfile) {
  execFileSync(process.execPath, [
    findEsbuild(), entry, '--bundle', '--outfile=' + outfile,
    '--format=esm', '--platform=node', '--target=es2019',
    '--log-level=warning'
  ], { stdio: 'inherit' });
}

function jsxBuild(entry, outfile) {
  execFileSync(process.execPath, [
    findEsbuild(), entry, '--bundle', '--outfile=' + outfile,
    '--format=iife', '--global-name=ESTIMER', '--platform=neutral', '--target=es5',
    '--log-level=warning'
  ], { stdio: 'inherit' });
}

mkdirSync(DIST, { recursive: true });

// 1. ESM core bundle (Node harnesses import this).
esmBuild(ENTRY, join(DIST, 'estimer-core.esm.mjs'));

// 2. JSX bundle with the ES3 shim prepended (Function.prototype.bind guard;
//    probed present on 4.5.6, kept for other hosts).
var jsx = join(DIST, 'ESTIMER.jsx');
jsxBuild(ENTRY, jsx);

var shim = [
  'if (typeof Function.prototype.bind !== "function") {',
  '  Function.prototype.bind = function (thisArg) {',
  '    var fn = this;',
  '    var args = Array.prototype.slice.call(arguments, 1);',
  '    return function () {',
  '      return fn.apply(thisArg, args.concat(Array.prototype.slice.call(arguments)));',
  '    };',
  '  };',
  '}',
  ''
].join('\n');

var finalJsx = shim + readFileSync(jsx, 'utf8');
finalJsx = finalJsx.replace(/"use strict";?/g, '');
writeFileSync(jsx, finalJsx);

// 3. Production vendor: the same bundle + an install footer that assigns the
//    facade to $.global.ESTIMER (true drop-in: eval the file, then use
//    ESTIMER/$.global.ESTIMER from any later eval in the same session).
var footer = [
  '(function () {',
  '  var g = null;',
  '  try { if (typeof $ !== "undefined" && $.global) { g = $.global; } } catch (e1) {}',
  '  if (!g) { try { g = (function () { return this; })(); } catch (e2) {} }',
  '  if (!g) return;',
  '  g.ESTIMER = ESTIMER;',
  '})();',
  ''
].join('\n');

var vendor = finalJsx + '\n' + footer;
writeFileSync(join(DIST, 'vendor-estimer.js'), vendor);

console.log('[estimer-build] wrote ' + join(DIST, 'ESTIMER.jsx') + ', ' + join(DIST, 'vendor-estimer.js') + ' and ' +
  join(DIST, 'estimer-core.esm.mjs'));
