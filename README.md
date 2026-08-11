<div align="center">

# ESTIMER: Microsecond Timing for Adobe ExtendScript (ES3)

## ExtendScript TIMER = E.S.TIMER

### The quirk-solving microsecond timing facade — `ESTIMER.prime()` / `now()` / `measureUs()` / `median()` / `stopwatch()` / `calibrate()` / `sleep()` / `stats()` — a monotonic, wrap-corrected delta clock over `$.hiresTimer` + `Date` for Adobe Illustrator, InDesign, Photoshop & any ExtendScript host

[![Clock: monotonic wrap-corrected](https://img.shields.io/badge/clock-monotonic%20wrap%20corrected-success)](#engine-quirks-that-shaped-the-design)
[![Differential: reference model](https://img.shields.io/badge/differential-vs%20reference%20model%202.0M%2B%20checks-purple)](#validation)
[![Engine parity: live](https://img.shields.io/badge/engine%20parity-live%2056%2F56%20checks-green)](#validation)
[![Adobe: Creative Suite](https://img.shields.io/badge/Adobe%20-Creative%20Suite-red?logo=adobe&logoColor=white)](https://extendscript.docsforadobe.dev/)
[![Engine](https://img.shields.io/badge/ExtendScript-ES3-green)](#compatibility)
[![Size](https://img.shields.io/badge/runtime-13.7%20KB-orange)](#installation)
[![License: GPL-3.0-or-later](https://img.shields.io/badge/license-GPL%203.0--or--later-blue)](https://www.gnu.org/licenses/gpl-3.0.html)

</div>

---

## Part Of The Same Toolkit

> Production-grade ExtendScript infrastructure for Illustrator-era JavaScript engines.

<table>
<tr>
<td width="50%" valign="top">

### Runtime Primitives

**[ESON](https://github.com/thelabcorner/eson)**  
Strict RFC 8259 JSON for ExtendScript.

**[ESB64](https://github.com/thelabcorner/es-b64)**  
Base64 and UTF-8 utilities.

**[ESARR](https://github.com/thelabcorner/es-arr)**  
ES5+ Array compatibility methods.

**[ESSTR](https://github.com/thelabcorner/es-str)**  
String whitespace and trim methods.

**[ESCHARS](https://github.com/thelabcorner/es-chars)**  
Native bulk byte operations.

**[ESHTTP](https://github.com/thelabcorner/es-http)**  
HTTP transport for ExtendScript automation.

**[ESTIMER](https://github.com/thelabcorner/es-timer)**  
Microsecond timing for ExtendScript automation.

</td>
<td width="50%" valign="top">

### Build & Integration Tools

**[ESPACK](https://github.com/thelabcorner/espack)**  
Self-extracting ExternalObject bundles.

**[ESMIN](https://github.com/thelabcorner/es-min)**  
Minification for shipped JSX bundles.

**ESOBF** <sub>coming soon</sub>  
Obfuscation for hardened JSX distribution.

</td>
</tr>
</table>

Also from the same team: **[ArcFit.dev](https://arcfit.dev)**, deterministic arc warp for Illustrator.

---

## Table of Contents

- [Why ESTIMER?](#why-estimer)
- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [API](#api)
- [Validation](#validation)
- [Performance](#performance)
- [Security Model](#security-model)
- [Compatibility](#compatibility)
- [Engine quirks that shaped the design](#engine-quirks-that-shaped-the-design)
- [Development](#development)
- [Repository layout](#repository-layout)
- [Research corrections](#research-corrections)
- [Credits](#credits)
- [License](#license)

---

## Why ESTIMER?

ExtendScript ships **no usable high-resolution timer.** There is no `performance.now()`, no `Date.now()`, and `Date().getTime()` only reaches millisecond resolution. The one µs source the engine does ship — `$.hiresTimer` — is a **delta clock, not a wall clock**: each read returns µs since the property was last accessed, so consecutive values must never be subtracted like timestamps. Probed live on Adobe Illustrator 30.6.0 (build 109R) / ExtendScript 4.5.6 (docs/research-probes.md, gaps G1-G8), the engine's timer has four documented traps and one missing feature:

- **The first read is engine/thread startup µs, not a sample.** The first ever read in the main engine measured **675,881,881 µs** (≈ 11.26 min — the engine's own age, not the process's). A naive harness records that huge value as a measurement; it must be discarded.
- **The counter is signed 32-bit and wraps.** It turns negative at 2^31 µs (35.79 min of counter uptime) and fully aliases every 2^32 µs (71.58 min). The correction is exact for single-wrap intervals and unrecoverable past that — the honest long-span lane is the Date wall clock.
- **Nested reads corrupt naive outer timings.** A stopwatch read inside a stopwatch steals the parent's elapsed time — the profiler bug that once reported a parent phase at ~0 ms while its children summed to ~20 s (ArcFit history, HANDOFF_ARCFIT_RUNTIME_OPTIMIZATION).
- **`$.sleep` polls coarsely** (~100 ms granularity; can overrun or wake early) — fine for pauses, useless for timing.
- **No µs wall clock at all**: `Date` is ms-only, and the read itself costs **1 µs median (p99 2 µs)** on 30.6.0 — a correction floor for sub-10 µs measurements.

ESTIMER solves all of it with **one accumulator**: every raw read advances a monotonic, wrap-corrected absolute µs clock (`abs += wrapCorrect(delta)`), so `now()` is safe anywhere — including inside measured functions and nested stopwatches. The first read is discarded by `prime()`, samples are validated per the house rejection protocol (`> 0`, `<= maxValidUs`), and the raw source is injected so the identical bundle runs in the engine (`$.hiresTimer`), in Node (`performance.now()`), and on the degraded Date lane.

---

## Features

- **Monotonic, wrap-corrected absolute clock** — 0 negative deltas in 10,000 consecutive live reads (G5, `probe_hirestimer.jsx`); the accumulator floors uncorrectable reads at 0 (never backwards) and single-wrap-corrects negative deltas by +2^32 (exact for true intervals in [2^31, 2^32) µs ≈ 35.8-71.6 min).
- **First-read discard** — `prime()` consumes and discards the startup read (measured 675,881,881 µs) idempotently; live-verify confirms `now()` starts near 0 after `prime()` even in a ~40 min-old engine.
- **Nesting-safe stopwatch** — `elapsed()` is cumulative; an inner stopwatch or `now()` between `start()` and `stop()` cannot corrupt the outer run (live-verify: "stopwatch outer >= inner", "elapsed >= outer").
- **House rejection protocol** — samples validated `> 0 && <= 1e8 µs` (100 s), warmup runs (default 2) discarded, rejected samples reduce the set with `{index, value, reason}` carried via `collectRejected`; `measureUs(fn, 1)` returns `null` live-verified.
- **Calibrated sleep** — busy-wait below 25 ms lands within +0.2 % of the request; at/above 25 ms in the engine, `$.sleep(ms - 1)` + a final calibrated busy-wait **never wakes early** (measured overshoot 10-38 %, returned as the actual µs slept).
- **Stats, edge-exact** — `stats()` returns `{count, min, max, mean, median, p95, p99, rejected}` with house upper-median indexing; n=0 → zeros, n=1 → the single value; 3,000 differential stats checks + 2,000 medianOf checks against the Node reference model.
- **Differential-validated core** — 5,165 unit checks (`npm test`) + 2,000,028 seeded fuzz iterations vs the hand-rolled reference accumulator (`npm run fuzz`, seed 1337, 0 divergences), including scripted wrap-boundary, negative-delta, and startup-value sequences.
- **Live-verified in the real engine** — 56/56 engine checks pass on Illustrator 30.6.0 / ExtendScript 4.5.6 (`npm run live-verify`): prime/now/epoch, 100-read monotonicity, measureUs rejection, samples/median/best, stopwatch nesting, wrap-policy round-trip, sleep lanes, calibrate.
- **Three lanes, one code path** — `engine` (`$.hiresTimer`, delta, wraps), `node` (`performance.now()`, absolute), `date` (ms wall clock, degraded) auto-detected at load; `setSource()` injects a fake source so wrap/negative-delta behavior is tested deterministically without 35-minute waits.
- **No runtime dependencies, ES3-clean** — one 13.7 KB runtime file (`vendor-estimer.js`); no `let`/`const`/arrows/`Promise`/`Map`, no `"use strict"`, functions-only exports (esbuild IIFE getter quirk — see Engine quirks).

---

## Installation

```jsx
// @includepath "path/to/estimer/dist"
#include "vendor-estimer.js"

// ESTIMER is now on $.global — drop-in, no install call needed.
```

Or load explicitly in any order / from COM:

```jsx
$.evalFile(File("C:/path/to/estimer/dist/vendor-estimer.js"));
// or, for a bannerless IIFE that defines var ESTIMER without touching $.global:
$.evalFile(File("C:/path/to/estimer/dist/ESTIMER.jsx"));
```

Prime once per engine/thread: the accumulator's base is set from the first read of whichever engine the library is loaded into (see Engine quirks).

---

## Quick Start

```jsx
ESTIMER.prime();                          // discard the startup read; anchor the epoch
var us = ESTIMER.now();                   // µs since the first raw read (monotonic, wrap-corrected)

var t = ESTIMER.measureUs(function () {   // one validated sample; null when rejected
  for (var i = 0; i < 1000; i++) { work(i); }
});
var med = ESTIMER.median(9, function () { // median-of-9, warmup 2, rejection protocol
  work();
});

var sw = ESTIMER.stopwatch();             // nesting-safe
sw.start();
work();
var runUs = sw.stop();                    // this run's µs

ESTIMER.calibrate();                      // median read overhead µs — subtract for sub-10 µs ops
ESTIMER.sleep(100);                       // calibrated: $.sleep(99) + final busy-wait to land at 100 ms
var s = ESTIMER.stats(ESTIMER.samples(9, work));  // { count, min, max, mean, median, p95, p99, rejected }
var wall = ESTIMER.wallNow();             // Date ms — the honest lane for long spans
```

---

## API

The facade is functions only — no exported `var` bindings (the ES3 engine evaluates esbuild's IIFE var-export getters at define time; constants ride on `ESTIMER.constants()`).

- `prime()` — idempotent; consumes and discards one read so the first (startup/thread-init) value is never a sample; records the epoch base.
- `now()` — µs, monotonic, wrap-corrected; **absolute** accumulated µs since the first raw read (safe anywhere, including nested contexts).
- `nowMs()` — `now() / 1000` (ms convenience, µs precision kept).
- `wallNow()` — `Date().getTime()` ms; the honest lane for spans past ~35.8 min between reads.
- `epoch()` — µs since `prime()`; auto-primes on first call.
- `measureUs(fn, maxValidUs?)` → `number | null` — one validated sample (`> 0`, `<= maxValidUs`, default 1e8 µs); `null` when rejected.
- `measureMs(fn, maxValidMs?)` → `number | null` — ms version, default cap 1e5 ms.
- `samples(n, fn, opts?)` → `SampleSet` — n measured runs with `{warmup=2, maxValidUs=1e8, minValidUs=0, collectRejected}`; rejected samples reduce the set; `array.rejected = [{index, value, reason}]` when `collectRejected`.
- `median(n, fn, opts?)` → `number | null` — median-of-n primed samples (the house benchmark protocol).
- `best(n, fn, opts?)` → `number | null` — min-of-n primed samples.
- `stopwatch()` → `{ start, stop, elapsed, reset, running }` — nesting-safe; `elapsed()` cumulative; `stop()` returns the just-completed run's µs; double-start / stop-without-start are no-ops.
- `calibrate(n?)` → number — median read-overhead µs (default n=100, samples validated `<= 10 ms`); result recorded in `describe().calibratedUs`.
- `sleep(ms)` → number — **actual** µs slept; busy-wait below 25 ms; engine lane at/above: `$.sleep(ms - 1)` + calibrated busy-wait (never early; overshoot returned).
- `stats(samples)` → `{count, min, max, mean, median, p95, p99, rejected}` — house upper-median indexing; n=0 → zeros, n=1 → single value.
- `medianOf(values)` / `minOf(values)` — pure array lanes (no timer dependency).
- `setSource(source?, {wrapPolicy}?)` — inject a `TimerSource { readUs(), delta?, wraps? }` (test hook; `undefined` re-detects the lane) and re-create the accumulator.
- `setWrapPolicy('correct'|'reject')` / `wrapPolicy()` — `'correct'` (default): negative delta += 2^32 (single-wrap); `'reject'`: negatives never advance.
- `lane()` — `'engine' | 'node' | 'date' | 'custom'`.
- `describe()` → `{lane, engine, wrapPolicy, primed, reads, calibratedUs}` — the evidence snapshot (host/version recorded with every measurement).
- `constants()` → `{MAX_VALID_US: 1e8, MAX_VALID_MS: 1e5, MIN_VALID_US: 0, WRAP_PERIOD_US: 4294967296, WRAP_POINT_US: 2147483648, SLEEP_COARSE_THRESHOLD_MS: 25}`.

---

## Validation

| Check | Command | Result |
|---|---|---|
| TypeScript strict | `npx tsc --noEmit -p .` | clean (exit 0) |
| Node harness (clock vectors + stats/median differential) | `npm test` | 5,165 checks, 0 failures |
| Seeded differential fuzz vs reference model | `npm run fuzz` | 2,000,028 iterations, seed 1337, 0 divergences |
| Live engine parity | `npm run live-verify` | 56/56 checks, Illustrator 30.6.0 / ExtendScript 4.5.6 |
| Node reference benchmark | `npm run benchmark` | exit 0 (tables in Performance) |

The differential oracle is a hand-rolled reference model of the delta-clock accumulator (`tests/vectors.ts` — the same model `npm test` validates bit-for-bit in Node); engine parity is verified by running the identical bundled code in the real engine via the COM tool.

---

## Performance

Measured live in Adobe Illustrator 30.6.0 (build 109R) / ExtendScript 4.5.6 (engine build 80.1), Windows 10/64, x86-64. Protocol: prime before each lane, 5 warmups discarded, 9 measured runs per lane, samples validated in (0, 1e8] µs, one lane per eval, 3 rounds per lane, median of the round medians. Full tables + raw JSON: `docs/benchmark-rounds-1.md`, `bench/raw/`.

### Engine lanes (ESTIMER facade, real `$.hiresTimer`)

| lane | medianUs | minUs | p95Us | n | rej |
|---|---|---|---|---|---|
| measureUs-noop | 10 | 9 | 10 | 9 | 0 |
| now-read | 5 | 4 | 5 | 9 | 0 |
| epoch-read | 5 | 5 | 5 | 9 | 0 |
| stopwatch-cycle | 11 | 10 | 13 | 9 | 0 |
| median9-noop | 98 | 95 | 101 | 9 | 0 |
| medianOf-31 | 86 | 85 | 87 | 9 | 0 |
| empty-loop-1e6 | 56,474 | 54,320 | 61,609 | 9 | 0 |

**Read overhead decomposition (engine):** raw `$.hiresTimer` read 1 µs median (p99 2 µs, G6); `calibrate()` through the facade 2 µs; `now()` 5 µs (accumulator + wrap-correction per read); `measureUs(noop)` 9-10 µs; the full median-of-9 protocol 98 µs.

### Sleep accuracy (`sleep()` actual µs vs requested ms, `wallNow()` span)

| reqMs | sleptUs (median) | wallMs (median) | error % vs req |
|---|---|---|---|
| 2 | 2,004 | 2 | +0.2 % |
| 25 | 34,463 | 35 | +37.9 % |
| 50 | 60,810 | 61 | +21.6 % |
| 250 | 275,888 | 276 | +10.4 % |

The busy-wait lane (< 25 ms) lands within ~0.2 %. The coarse lane (>= 25 ms) **never sleeps early** but overshoots 10-38 % — `$.sleep` polls at ~100 ms granularity, and the landing policy is deliberately "never early"; the actual µs slept is the return value (the contract).

### Node reference lane (parity)

| lane | medianUs (node) | medianUs (engine) | ratio engine/node |
|---|---|---|---|
| measureUs-noop | 0.40 | 10 | 25x |
| now-read | 0.70 | 5 | 7.1x |
| epoch-read | 0.70 | 5 | 7.1x |
| medianOf-31 | 4.10 | 86 | 21x |
| empty-loop-1e6 | 462.6 | 56,474 | 122x |

Node host: node v22.23.2 (lane=node, `performance.now()` x1000, calibrated read overhead 0.30 µs). The engine is 7-122x slower depending on the lane — raw read overhead ~1 µs engine vs ~0.3 µs Node; interpreter throughput 122x slower on the empty loop. The Node lane exists for harness parity, not production timing.

---

## Security Model

ESTIMER is a pure data-transform library. It executes no `eval`, loads no native code, writes nothing to disk, and makes no network access; the shipped bundle is plain ES3 function definitions plus one closure state machine. The only host interactions are reads of `$.hiresTimer` and `Date` for time values, and a call to `$.sleep` **only inside `ESTIMER.sleep()`** (engine lane, at/above the 25 ms coarse threshold) — both read-only or deliberately invoked by the caller. The one injection surface is `setSource()`, an explicit test/embedding hook that replaces the timer source with a caller-provided function; it is never called by the library itself.

---

## Compatibility

| Target | Status |
|---|---|
| ExtendScript ES3 (no `let`/`const`/arrows/`Promise`/`Map` in the bundle; `"use strict"` stripped; functions-only exports) | Bundled |
| Adobe Illustrator 30.6.0 / ExtendScript 4.5.6 / Windows x86-64 | Verified live (56/56 engine checks + G1-G8 probes) |
| Any other ExtendScript host (InDesign, Photoshop, After Effects, InCopy, Bridge) | ES3-safe by construction; re-probe `$.hiresTimer` per host before relying on timing values |
| Node.js v18+ (v22.23.2 used) | Build and test harnesses |

---

## Engine quirks that shaped the design

All measured live on Illustrator 30.6.0 (build 109R) / ExtendScript 4.5.6 (engine build 80.1); re-probe other hosts.

- **The first read is engine/thread startup µs, not ~0.** Main-engine first read: 675,881,881 µs (the engine's age). A naive harness records it as a sample; ESTIMER discards it via `prime()`.
- **The counter base is engine creation, not process start.** The main engine was created ~9.2 h after process start; its first read was 11.26 min of *engine* age. Each engine has its own clock (transient engine first read = its own 13.15 s age).
- **`$.hiresTimer` is a delta clock.** Every read is µs since the property was last accessed — never a timestamp. `abs += wrapCorrect(delta)` turns it into an absolute clock.
- **Signed 32-bit wrap.** 2^31 µs = 35.79 min = the wrap point (value turns negative); 2^32 µs = 71.58 min = the full alias period. `'correct'` adds +2^32 to a single-wrap negative (exact for [2^31, 2^32) µs intervals); multi-wrap gaps are unrecoverable — `wallNow()` is the honest long-span lane.
- **Nested reads corrupt naive outer timings.** The ArcFit profiler once reported a parent phase at ~0 ms while children summed to ~20 s. The single accumulator makes the outer interval exactly the sum of the inner intervals (live-verified: stopwatch outer >= inner).
- **`$.sleep` polls coarsely** (~100 ms granularity; can overrun or wake early). ESTIMER sleeps busy-wait-exact below 25 ms and lands a coarse sleep with a calibrated spin above it.
- **Zero-delta reads are legitimate.** 27.6% of 10,000 tight reads measured 0 µs — sub-µs intervals round down (read overhead is ~1 µs median). ESTIMER's `samples()` accepts `minValidUs = 0`; `measureUs` rejects `<= 0` because a 0 µs *operation* is more likely a protocol error.
- **Read overhead is ~1 µs raw, 2 µs through `calibrate()`, ~5 µs through `now()`, 9-10 µs through `measureUs`** (G6). ESTIMER never auto-subtracts; the caller decides.
- **ScriptUI callbacks share the main engine's clock.** A button `onClick` first read (15,586 µs) matched the wall gap since the main-thread prime (15 ms) — same thread, same delta clock, no fresh-thread startup value.
- **Delta spans stay accurate over minute-scale gaps.** A 60 s `$.sleep` span measured 64,330,333 µs vs Date's 64,331 ms (ratio 0.99999); no drift.
- **`#targetengine` is not honored via `$.evalFile()` / COM `DoJavaScriptFile` in AI 30.6.0** — named engines were not created; evals landed in `main`. Only the ESD transport's `transient` engine exposes a second clock.
- **esbuild var-export getters evaluate at define time.** The engine lacks `__defineGetter__`, so `defineProperty`-getter exports of `var` bindings evaluate immediately while hoisting still leaves them `undefined` — the export is permanently `undefined`. ESTIMER ships **no exported var bindings**: functions only, constants via `ESTIMER.constants()` (the esarr lesson).
- **`Timer` is a closure factory, not a class** — esbuild cannot downlevel a class to ES5 in this configuration (verified error); the factory pattern is the ES3-safe shape.

---

## Development

```bash
npm install            # esbuild + typescript
npm run build          # dist/ESTIMER.jsx, vendor-estimer.js, estimer-core.esm.mjs
npm test               # Node harness: 5,165 checks (clock vectors + stats/median differential)
npm run fuzz           # 2,000,028 seeded differential iterations (seed 1337)
npm run typecheck      # npx tsc --noEmit -p .
npm run benchmark      # Node reference lane (canonical protocol)
npm run live-verify    # 56/56 engine checks via the COM tool (Illustrator 30.6.0)
```

---

## Repository layout

```
estimer/
  src/            TypeScript core (index.ts facade, timer-core.ts accumulator, sleep.ts, stats.ts, types.ts)
  tests/          Node harnesses (custom, no framework): unit + vectors + fuzz + benchmark + live-verify
  scripts/        live-engine probe .jsx files (G1-G8 evidence)
  bench/          engine-lane benchmark (bench-live.jsx, run-bench-live.mjs) + raw JSON
  docs/           design.md + research-probes.md + benchmark-rounds-1.md
  evidence/raw/   raw probe JSON outputs
  dist/           generated bundles (gitignored; produced by npm run build)
```

---

## Research corrections

- **Counter base = ExtendScript engine creation, not process start.** The repo previously phrased the wrap as "~35.8 min since the epoch/init" without defining the base. Probed: the main engine was created ~9.2 h after process start, yet its first read was +675.9e6 µs (11.26 min of *engine* age, positive, unwrapped). Wrap math and first-read interpretation must use engine-creation time, and per-engine clocks mean a fresh engine gets a fresh base (`docs/research-probes.md` G1/G2).
- **`#targetengine` is not honored via `$.evalFile()` / COM `DoJavaScriptFile` in AI 30.6.0.** Named engines were not created (ESD engine list stayed `["main", "transient"]`); "fresh and reused engines" probes must use the ESD transport's `transient` engine (G2).
- **Read overhead on 30.6.0 is 1 µs median (p99 2 µs)** — the earlier round-2 figure of ~2 µs (30.5.1) remains compatible; 1 µs is now the measured median (G6).
- **Zero-delta reads are not errors.** 27.6% of 10,000 tight reads measured 0 µs (sub-µs intervals round down); validation must not treat them as failures (G5).
- **G4 wrap sign — pending live observation.** A scheduled read spanning the transient engine's wrap instant (~12:10:30) will confirm whether a wrapped delta-clock read comes back negative (the design's `'correct'` policy assumes it does; the official "signed 32-bit" wording supports it). Until observed, the wrap-sign premise is `ASSUMPTION` (verified in simulation: 2,000,028 fuzz iterations + live-verify wrap-policy round-trip). Independent live corroboration so far: the main engine, read at 11:51:13 local — past its 35.79-min wrap point (11:49:39) — still returned positive, sane deltas (wrap-safe delta math in practice, `evidence/raw/probe_main_2026-08-11T115113.json`).

---

## Credits

- **[docsforadobe](https://github.com/docsforadobe) and the docsforadobe.dev community** — maintainers of the de-facto reference documentation for the ExtendScript runtime; their reverse-engineering of `$.hiresTimer`'s delta-clock and thread-local semantics made the measured findings in this README possible to write down at all.
- **The ESON/ESB64 family** — the ES3 engineering patterns carry over directly: `$.hiresTimer` discipline, the esbuild var-export quirk, and the (0, 1e8] µs rejection ceiling.
- **The es-family** — ESARR's differential-validation harness shape and its `benchmark-rounds-1.md` protocol, and ESSTR's release pipeline, are the templates this repository follows.

---

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).

---

<p align="center"><small>ESTIMER: ExtendScript TIMER. Measured on the engine, safe across the wrap.</small></p>
