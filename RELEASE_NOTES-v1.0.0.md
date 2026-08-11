# v1.0.0 — 2026-08-11

SemVer: major (first public GitHub release).

First GitHub release of ESTIMER, the quirk-solving microsecond timing facade for Adobe ExtendScript ES3 — a monotonic, wrap-corrected delta clock over `$.hiresTimer` + `Date`, with the house rejection protocol, nesting-safe stopwatches, calibration, and precise sleep.

## Added

- `ESTIMER` facade (functions only, ES3): `prime()`, `now()`, `nowMs()`, `wallNow()`, `epoch()`, `measureUs()`, `measureMs()`, `samples()`, `median()`, `best()`, `stopwatch()`, `calibrate()`, `sleep()`, `stats()`, `medianOf()`, `minOf()`, `setSource()`, `setWrapPolicy()`, `wrapPolicy()`, `lane()`, `describe()`, `constants()`.
- Single monotonic accumulator core (`Timer`) that converts `$.hiresTimer`'s delta reads into an absolute wrap-corrected µs clock — every read advances it, so `now()` is safe inside measured functions and nested stopwatches (the ArcFit profiler-nesting fix, live-verified: "stopwatch outer >= inner").
- Signed-32-bit wrap handling: `'correct'` policy adds 2^32 to a single-wrap negative read (exact for true intervals in [2^31, 2^32) µs ≈ 35.8-71.6 min); `'reject'` never advances on a wrapped read; multi-wrap gaps documented as unrecoverable with `wallNow()` as the honest long-span lane.
- First-read discard: `prime()` consumes the engine-startup read (measured 675,881,881 µs on Illustrator 30.6.0) idempotently so it can never be a sample.
- Rejection protocol: samples validated `> 0` and `<= maxValidUs` (default 1e8 µs = 100 s), warmup runs (default 2) discarded, rejected samples carried as `{index, value, reason}` via `collectRejected` — no silent retry.
- Calibrated `sleep()`: busy-wait below the 25 ms coarse threshold lands within +0.2 %; at/above it, `$.sleep(ms - 1)` + a final calibrated busy-wait so it never wakes before the target (measured overshoot 10-38 %, returned as the actual µs slept).
- Three build artifacts: `dist/ESTIMER.jsx` (bannerless IIFE, defines `var ESTIMER`), `dist/vendor-estimer.js` (drop-in, assigns `$.global.ESTIMER`), `dist/estimer-core.esm.mjs` (Node ESM core).
- Lane auto-detection: `engine` (`$.hiresTimer`, delta, wraps) / `node` (`performance.now()`, absolute) / `date` (ms wall clock, degraded); `setSource()` injects a fake source for deterministic wrap/negative-delta tests without 35-minute waits.

## Verification

Gate: 5,165 Node assertions / 2,000,028 differential fuzz iterations vs the reference model (seed 1337) / 56/56 live-engine checks, Illustrator 30.6.0 / ExtendScript 4.5.6. All green on this commit.

- `npm run typecheck`: exit 0, clean.
- `npm test`: 5,165 checks, 0 failures (10 clock vectors + 9 stats vectors + 8 median vectors + 2,000 medianOf differential + 3,000 stats differential).
- `npm run fuzz`: 2,000,028 differential iterations passed (seed 1337).
- `npm run build`: produced `dist/ESTIMER.jsx` (13,765 B), `dist/vendor-estimer.js` (14,002 B), `dist/estimer-core.esm.mjs` (10,462 B).
- `npm run live-verify`: 56/56 engine checks passed (ExtendScript 4.5.6, Adobe Illustrator 30.6.0) — incl. monotonicity, wrap-policy round-trip, stopwatch nesting, sleep lanes, calibrate.
- `npm run benchmark`: exit 0 (Node reference lane; engine-lane tables in `docs/benchmark-rounds-1.md`).
- G1-G8 engine probes: documented in `docs/research-probes.md` + raw JSON in `evidence/raw/` (first-read magnitude, thread-locality, sleep inclusion, wrap spans, monotonicity, read overhead, ScriptUI continuity, rejection ceiling).

## Release Assets

- `vendor-estimer.js`
- `ESTIMER.jsx`
- `estimer-core.esm.mjs`
