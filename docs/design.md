# ESTIMER core design — the `$.hiresTimer` quirk solver

**Status:** implemented (t1-core) · **Scope:** `src/` (types, timer-core, stats,
sleep, index), `tsconfig.json` · **Runtime:** ExtendScript ES3 (Illustrator
30.6.0 / ExtendScript 4.5.6) and Node (harness parity)

---

## 1. Problem

`$.hiresTimer` is a delta clock with documented traps (research plan
`agent-skills/adobe-illustrator-scripting/references/hirestimer-research-plan.md`,
gaps G1–G8):

- every read returns **µs since the property was last accessed** — not a
  timestamp; consecutive reads must never be subtracted (§2.1);
- the **first read is engine/thread startup µs** (official Adobe docs; G1/G2);
- the counter is **signed 32-bit**: wraps negative at 2^31 µs (~35.8 min),
  fully aliases every 2^32 µs (~71.6 min) (G4);
- **nested reads corrupt outer timings** (§2.4) — the ArcFit profiler lost its
  parent phase to ~0 while children summed to ~20 s;
- read overhead ~2 µs (G6); **not authoritative over long spans** (§2.6);
  `$.sleep` polls coarsely (~100 ms).

## 2. Architecture — one accumulator, injected source

The core turns **any** raw timer source into an absolute, monotonic,
wrap-corrected µs clock:

```
abs += wrapCorrect(delta(raw))     delta = raw         (delta clock, engine)
                                   delta = raw-lastRaw (absolute clock, Node)
```

`TimerSource { readUs(), delta?, wraps? }` is the injection boundary
(`src/types.ts`): `delta: true` models the engine's read-is-elapsed clock;
`delta: false` models Node's `performance.now() * 1000`. The facade detects
the lane at load (`engine` > `node` > `date` degraded) and `setSource()`
re-injects — the test hook that makes wrap/negative-delta paths deterministic
without waiting 35.8 minutes.

**Why an accumulator at all:** it is the profiler-nesting fix from
`HANDOFF_ARCFIT_RUNTIME_OPTIMIZATION.md:238-243` ("accumulates every read
into a monotonic clock"). Because every read advances the single accumulator,
nested reads *cannot* corrupt each other: the outer interval is exactly the
sum of the inner intervals.

## 3. Wrap policy (decision: default `'correct'`, override via `setWrapPolicy`)

- **`'correct'` (default):** a negative delta is a single wrap of the 2^32 µs
  period → `delta += 2^32`. Exact when the true interval is in
  `[2^31, 2^32)` µs. Still-negative deltas (multi-wrap) count as 0 — the
  accumulator never moves backwards.
- **`'reject':`** negative deltas never advance the accumulator.

**CONFIRMED** (G4, live probes + static RE on AI 30.6.0): reads never come
back negative on this engine. The `$` property dispatcher (`FUN_1800197d0`,
case 0x15) calls the host import `ScCore::Thread::getHiResTimer()` and stores
the result as a **64-bit double** (`ScCore::Variant::setDouble`) — there is no
signed-32-bit delta arithmetic in ExtendScript.dll, all host-side, so the wrap
never surfaces as a negative read (verified live: 10k consecutive reads,
wrapped-territory 60 s spans, a wrap-straddling interval, and the transient
wrap-span read were all positive). The `'correct'` +2^32 policy is therefore a
deterministic **safety net for fake/adversarial sources**, not a live-path
correction on this engine. The correction constant is **2^32**, not 2^31:
2^31 is the *wrap point* of a signed 32-bit counter (the documented interface
model; the host's actual arithmetic is wider).

**Hard limit (documented, not fought):** the accumulator is authoritative only
while reads occur at least once per ~35.8 min (2^31 µs). A longer gap can
alias a multi-wrap interval to a small positive delta. For multi-minute spans,
`wallNow()` (`Date().getTime()`) is the honest lane (§2.6).

## 4. First-read policy (decision: discard, via idempotent `prime()`)

The first raw read is startup/thread-init µs (G1/G2). `prime()` consumes one
read and records the epoch base; it is **idempotent** (any number of calls)
and **optional for correctness** — every read flows through the accumulator,
and measurement samples are validated deltas, so startup garbage can never
surface as a sample. `epoch()` auto-primes on first call.

## 5. Nesting safety (decision: absolute accumulation; stopwatch snapshots)

`now()` returns absolute µs from the accumulator, so any
stopwatch/now/measurement in between two reads simply advances the shared
clock — the elapsed between the reads is preserved exactly. `stopwatch()`
snapshots `startAbs`/`stopAbs`:

- `elapsed()` = cumulative (sum of completed runs + live delta while running);
- `stop()` returns the just-completed run's µs; `start()` while running and
  `stop()` while stopped are no-ops; `reset()` zeroes and re-bases.

Worked example (delta clock, reads `[1e6, 10, 30, 20, 40]`):
outer.start→1e6, now()→+10, inner.start→+30, now()→+20: inner.elapsed() = 60,
outer.elapsed() = 100. Both exact; nothing stolen.

## 6. Measurement protocol

`measureOne(fn)`: `t0 = now(); fn(); t1 = now(); d = t1 - t0`. For the delta
clock, `d` is the raw value of the t1 read — the house prime/read-once
protocol (performance-engineering.md:29-40). `d` includes ~1 read overhead;
`calibrate()` measures it (adjacent-read median, default n=100, validated
≤ 10 ms) for sub-10 µs corrections (G6).

**Validation (G8 decision — fixed ceiling, explicit per-op override):**
`d > 0 && d >= minValidUs && d <= maxValidUs`, default `maxValidUs = 1e8 µs`
(100 s, the esarr/architect-probes ceiling). The skill harness's 1e7 for
sub-10 µs ops is expressed by passing a smaller `maxValidUs` — **no automatic
scaling** (no magic derived from the operation). Rejection reasons:
`not-number | negative | zero | below-min | above-max`.

`samples(n, fn, opts)`: `warmup` (default 2, house band 2-10) + n measured
runs; **rejected samples reduce the set** (outlier rejection after collection,
esarr/docs/benchmark-rounds-1.md — no silent retry); `collectRejected` carries
`[{index, value, reason}]` on the array's `.rejected` property (ES3 has no
tuples). `median`/`best` return `null` when no sample is valid. `measureUs`
returns `null` on rejection (the canonical helper's contract).

## 7. Stats edge cases (decision)

`stats(samples)` → `{count, min, max, mean, median, p95, p99, rejected}`:

- **n = 0:** every metric 0; `rejected` preserved from the carry property.
- **n = 1:** every metric is the single value.
- **median/percentile index:** house convention, exactly as
  `esarr/src/index.ts item()` — upper-median `sorted[floor(n/2)]`,
  `percentile = sorted[floor(n*p)]` clamped to the last index.
- `rejected` = `samples.rejected.length` when present, else 0.

## 8. Sleep (decision: busy-wait + coarse lane; no Atomics, no setTimeout)

- below the coarse threshold (**25 ms**, default): pure busy-wait on the
  accumulator clock — exact to read granularity (~2-4 µs);
- at/above, engine only: `$.sleep(ms - 1)` then a final calibrated busy-wait
  to land on the target. `$.sleep` can overrun (its ~100 ms poll granularity)
  or wake early; the final busy-wait guarantees we **never wake before the
  target** — overshoot is possible, early wake is not, and the returned value
  is the actual µs slept (evidence lane).
- Node: busy-wait only — `setTimeout`/`Atomics.wait` do not exist in ES3 and
  the Node lane must run identically (one code path). A Node busy-wait burns a
  core; accepted for harness parity.

## 9. What is validated / not validated

**Validated (this session, Node):** `tsc --noEmit` exit 0; 19 behavioral
checks on the ESM lane (wrap ±2^32, reject policy, prime/epoch, nesting,
validation, stats edges, sleep ≥ target, lane detection); 30 checks executing
the **ES5 IIFE bundle** (esbuild `--global-name=ESTIMER --target=es5` — the
exact engine-lane artifact) — export shape, real-clock advance, wrap
correction. **Later confirmed live and by static RE** (post-release, evidence
member + Ghidra): 56/56 engine checks; G1-G8 probes; the getter is the host
import `ScCore::Thread::getHiResTimer()` — value stored as a 64-bit double, no
wrap arithmetic in ExtendScript.dll — so wrapped reads never come back
negative on AI 30.6.0 (see §3). Not run in this session at t1-core time:
live Illustrator behavior (no engine here) — supplied afterwards by the
evidence member's probes.

## 10. Decision summary

| Concern | Decision | Rationale |
|---|---|---|
| Wrap | default `'correct'`: negative delta += 2^32 (single-wrap); still-negative → 0 | recovers exact intervals up to 2^32 µs; never backwards |
| Wrap override | `setWrapPolicy('reject')`; per-source via `setSource(src, {wrapPolicy})` | probe/evidence lane |
| First read | `prime()` discards it; idempotent; auto-prime on `epoch()` | G1/G2; optional for correctness |
| Nesting | absolute accumulation; stopwatch snapshots abs | §2.4 fix; exact sum of inner intervals |
| Rejection | `>0 && <=1e8 µs` fixed default, explicit per-op override | G8; no auto-scaling |
| Stats n=0/1 | zeros / single value; upper-median, floor-index percentiles | esarr/esstr bench convention |
| Sleep | busy-wait < 25 ms; coarse+final busy-wait above; Node = busy-wait only | never early; ES3 parity |
| Source injection | `TimerSource` + `setSource()` | Node/engine duality; deterministic tests |
