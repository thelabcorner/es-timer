# ESTIMER research probes — G1–G8 answered on Illustrator 30.6.0

**Author:** evidence (live-engine probe & measurement engineer)
**Date:** 2026-08-11
**Host (all runs):** Adobe Illustrator 30.6.0 (build 109R), ExtendScript 4.5.6 (engine build 80.1), Windows 10/64 (build 10.0), locale en_US, x86-64. Process start 02:12:14 local; main engine created ≈11:13:50 local (see G1).
**Route:** COM `DoJavaScript`/`DoJavaScriptFile` eval + ESD (ExtendScript Debugger) BridgeTalk transport via `ILLUSTRATOR_COM_TOOL.py`; probes are self-contained ES3 `.jsx` with a string serializer (no JSON dependency).
**Source of truth for numbers:** `MEASURED-FACTS.md` (repo root) + `evidence/raw/*.json` in this repo.

---

## G1 — What does the first-ever read return?

**Observed (main engine, uncontended first access, 11:25:06):**

| read | value (µs) | meaning |
|---|---|---|
| 1st | **675,881,881** | ≈ 675.9 s = 11.26 min — the **engine's age at first access** |
| 2nd | 1 | delta since 1st (read overhead) |
| 3rd | 1 | delta since 2nd |

The main engine was created ≈11:13:50 (675.9 s before 11:25:06), which is ≈9.2 h **after process start** (02:12:14). So the counter base is **ExtendScript engine creation**, NOT the Illustrator process start. The value is positive because the engine was younger than the 2^31 wrap point (35.79 min).

**Reproduction:** `probe_hirestimer.jsx` → `probes.g1` (also `probe_engine_fresh.jsx` — but see G2; `#targetengine` is NOT honored via evalFile/DoJavaScriptFile, those runs landed in main and returned continuing deltas).

**What ESTIMER does:** `prime()` consumes and discards the first read so it can never be sampled; the accumulator treats the first raw value as a **base offset** (origin), not a sample. Live-verify confirms: "prime/now first read tiny (startup discarded)" — after `prime()`, `now()` starts near 0 even though the engine is ~40 min old at that point.

**Correction to repo docs:** the "first read ≈ engine startup µs" is confirmed, but the repo's wrap math assumed process-uptime scales. The counter is per-**engine**, and an engine can be created long after process start. A benchmark that opened Illustrator hours ago and only touches the timer later still gets a small-magnitude first read if the engine is young.

---

## G2 — Thread-locality / fresh engines

**Observed:**

| context | engine reported | first read (µs) | interpretation |
|---|---|---|---|
| COM eval (main, 11:25:06) | main | 675,881,881 | main engine age |
| `$.evalFile` of `#targetengine "estimer_g2_fresh"` file (11:26:24) | **main** | 75,642,147 | directive NOT honored — ran in main; delta since 11:25:08 |
| COM `DoJavaScriptFile` of `#targetengine "estimer_g2_viafile"` file (11:32:06) | **main** | 36,149,200 | directive NOT honored — ran in main; delta since last read |
| ESD `debug --engine transient` eval (11:34:58) | **transient** | **13,147,054** | = transient engine age (created ≈11:34:44.8 by debugger attach) — a genuinely independent clock |
| ESD `debug --engine transient` eval again (11:35:16) | transient | 17,496,676 | = delta since previous eval's last read (17.5 s) — clock continues across invocations in the same engine |

**Key findings:**
1. **Each ExtendScript engine has its own independent `$.hiresTimer`.** The `transient` engine's first read was exactly its own age (13.15 s), not anything related to main.
2. **`#targetengine` directives are NOT honored** when the script is loaded via `$.evalFile()` or COM `DoJavaScriptFile` in AI 30.6.0 — the ESD engine list shows only `["main", "transient"]`, no `estimer_g2_*` engines were created. The research plan's "fresh and reused engines (#targetengine vs anonymous)" probe had to be re-routed to the ESD transport's `transient` engine, which is the only accessible second engine.
3. **COM evals all share the main engine** — the delta clock continues across separate `eval` invocations (75.6 s delta across a 78 s gap is consistent with delta-continuity plus tool overhead).
4. **Different transports (COM eval vs ESD debug eval on main) read the SAME clock** — at 11:35:17 the ESD main eval returned a 1.09 s delta matching recent main-engine activity (a peer's probe had touched main ~1 s earlier). The clock is per-engine, not per-transport.

**What ESTIMER does:** `prime()` must be called once per engine/thread; the accumulator's base is set from the first raw read of whichever engine the library is loaded into. Loading the vendor via `$.evalFile` in a fresh engine creates a fresh base automatically. Documented limitation: priming in engine A does nothing for engine B — each engine needs its own `prime()`.

---

## G3 — Does elapsed time include `$.sleep` / host blocking?

**Observed (`probe_hirestimer.jsx` → `probes.g3`):**

```
read, $.sleep(200), read  →  hiresDeltaUs = 212,726   dateDeltaMs = 214
follow-up read (no sleep) →  48 µs
```

Yes — **sleep time is fully included** (wall-based). 212,726 µs ≈ 214 ms wall; the follow-up read of 48 µs shows no clock jump after the sleep. Repeated 500 ms spaced reads (g4_spacedReads) gave 531,200 / 534,625 / 540,057 µs — all ≈ the 500 ms request plus `$.sleep`'s known overrun (it polls at ~100 ms granularity per the ScriptUI research guide).

**What ESTIMER does:** `sleep(ms)` is imprecise by design (busy-wait < 25 ms; coarse `$.sleep` + calibrated landing ≥ 25 ms) and **returns the actual µs slept**, so callers never have to re-measure. The timer remains valid across host calls (documented: "wallNow() is the honest lane for long spans").

---

## G4 — Wrap behavior (signed 32-bit? sign of wrapped read? delta across wrap?)

**Observed so far:**
- First-read magnitudes observed: +675,881,881 (main, 11.26 min old), +13,147,054 (transient, 13.15 s old) — both positive, both consistent with **µs since engine creation** as a signed 32-bit value that has NOT yet wrapped.
- **60 s span delta (`probe_g4_longdelta.jsx`):** `deltaAfterSleepUs = 64,330,333` vs `dateDeltaMs = 64,331` → ratio 0.99999. Deltas stay accurate over minute-scale spans; no drift, no integer truncation.
- **Wrap math (engine-side):** 2^31 µs = 2147.48 s = 35.79 min engine age = the wrap point; 2^32 µs = 71.58 min = the correction period used by ESTIMER's 'correct' policy. The main engine wraps ≈11:49:39; the transient engine wraps ≈12:10:30 (both engine-creation + 35.79 min).

**Live wrap-span probe (scheduled):** a dedicated scheduled read of the `transient` engine at 12:12:30 spans the transient engine's wrap instant (12:10:30). Last read in that engine was 11:35:16, so the read returns the elapsed ≈36.6 min — **if the engine returns a negative or implausible value, wrapped delta-clock reads DO come back negative (core-dev's ASSUMPTION confirmed); if it returns ≈+2.20e9, the engine's delta math is wrap-safe in practice.** Result appended to `evidence/raw/` when it fires.

**What ESTIMER does (core-dev design):** default wrap policy `'correct'` — a negative delta gets `+= 2^32` (single-wrap correction, exact for true interval in [2^31, 2^32) µs ≈ 35.8–71.6 min); still-negative → treated as 0 (never backwards). `'reject'` policy never advances on negatives. The accumulator is authoritative only while reads occur at least once per ~35.8 min — beyond that, `wallNow()` is the honest lane (documented limitation, matches repo guidance).

**Correction to repo docs:** the chunkdb/abi-and-poc wraparound notes describe accumulated *totals* over long runs wrapping — plausible, but the repo's phrasing "signed 32-bit counter wraps at ~35.8 min since the epoch/init" should say **since engine creation, with the counter base per engine** (G1/G2), and the wrap sign is now live-probed (see scheduled result above).

---

## G5 — Monotonicity (10k consecutive reads)

**Observed (`probe_hirestimer.jsx` → `probes.g5`):**

| metric | value |
|---|---|
| reads | 10,000 |
| negative | **0** |
| zero | 2,758 (27.6%) |
| positive | 7,242 |
| non-increasing (≤0) | 2,758 |
| min / max | 0 / 43 µs |
| huge (>1e6) | none |

No negative deltas in 10k consecutive tight reads. **27.6% of reads return 0** — sub-microsecond intervals round down (read overhead ~1 µs median, so the empty-interval delta frequently measures 0). Max 43 µs = occasional scheduler jitter. The 0s are *legitimate* (the interval was shorter than 1 µs), not errors.

**Reproduction:** `probe_hirestimer.jsx` → `probes.g5_monotonicity`; corroborated by live-verify "100 reads monotonic non-negative" (all 100 reads non-negative and non-decreasing through the facade).

**What ESTIMER does:** `samples()` accepts `minValidUs` default 0 (0 is a valid delta); `measureUs` rejects `<= 0` by default because a measured operation that returns 0 µs is more likely a protocol error than a real sub-µs op. The accumulator never goes backwards — a corrected-negative is floored at 0.

---

## G6 — Read overhead (30.6.0, main engine)

**Observed (`probe_hirestimer.jsx` → `probes.g6`, n=250):**

| metric | µs |
|---|---|
| median | **1** |
| mean | 1.016 |
| min | 0 |
| p10 / p50 / p90 | 1 / 1 / 1 |
| p99 | 2 |
| max | 9 |

Raw engine read overhead: **median 1 µs** (p99 2 µs). Facade overhead through ESTIMER is higher because `now()` does accumulator + wrap-correction work (engine benchmark: now-read median 5 µs; measureUs-noop 9–10 µs; median9 protocol 98 µs). The earlier HANDOFF round-2 figure of ~2 µs on 30.5.1 is consistent with this (1 µs median here, 2 µs within p99).

**Context dependence:** no measurable difference observed between COM eval and ESD debug transports for raw reads (both read the same engine clock; 1–2 µs).

**What ESTIMER does:** `calibrate(n=100)` returns the median read overhead (measured: see benchmark doc) and `describe().calibratedUs` records it; corrections for sub-10 µs measurements are the caller's call — ESTIMER does not auto-subtract (measurement protocol decision).

---

## G7 — Continuity across evalFile / #include / ScriptUI callbacks

**Observed:**
- **evalFile boundary:** `probe_engine_fresh.jsx` (loaded via `$.evalFile` with a `#targetengine` directive that was ignored) returned a 75.6 s delta that continued the main engine's clock from the previous eval — **the clock survives `$.evalFile` boundaries in the same engine**.
- **DoJavaScriptFile boundary:** same — 36.1 s continuing delta (11:32:06).
- **ScriptUI callback (`probe_scriptui_callback.jsx`, 11:35:53):**

```
main-thread prime:         36,494,760 µs (delta since a peer's earlier read)
callback first read:       15,586 µs  (≈ 15.6 ms)
wall gap prime→callback:   15 ms
callback second read:      2 µs
```

The callback's first read (15.6 ms) matches the wall-clock gap since the main-thread prime (15 ms) almost exactly — **ScriptUI event callbacks run on the same engine thread and share the same delta clock**. No fresh-thread startup value appeared.

**What ESTIMER does:** because the accumulator is the single reader and `now()` is absolute, stopwatch `elapsed() = stopAbs − startAbs` stays exact even when `now()`/other stopwatches run between — this is the HANDOFF_ARCFIT_RUNTIME_OPTIMIZATION nesting fix, now live-verified ("stopwatch outer >= inner (nesting-safe)", "elapsed >= outer").

---

## G8 — Rejection ceiling: is (0, 1e8] µs right?

**Observed:** all measured reads this session were 0–675.9e6 µs (first read) and 0–64.3e6 µs (deltas). Real operations never came close to 1e8 µs except the first-read startup magnitude (675.9e6), which is *discarded by prime(), not rejected by the ceiling*. `$.sleep`-based lanes reached 64.3e6 µs on a 60 s sleep — still under 1e8.

**Consensus recommendation (G8 answer):** (0, 1e8] µs = 100 s remains a sound universal ceiling for sub-100 s operations, matching esarr's 1e8; the skill harness's 1e7 is fine for fast lanes but too tight for sleeps/host calls ≥ 10 s. Keep per-op override for known-slow lanes (sleep-inclusive benchmarks), and **never let the ceiling double as the wrap guard** — the wrap guard is the accumulator + wrap policy, and the ceiling is validation only. ESTIMER's defaults: `MAX_VALID_US = 1e8`, `MIN_VALID_US = 0`, per-op override via parameter/opts, rejected samples reduce the set (no silent retry).

**Observed rejection behavior in-engine:** `measureUs(fn, 1)` correctly returned `null` (live-verify "measureUs capped(1) rejects"); `samples()` returned only valid positives with `rejected` count tracked.

---

## Corrections to prior repo claims (for the publisher's Research corrections section)

1. **Counter base = ExtendScript engine creation, not process start** (G1/G2): the main engine in this deployment was created ~9.2 h after process start; first read was +675.9e6 µs (engine age), not a wrapped value. Wrap math must use engine-creation time, and per-engine clocks mean fresh engines get fresh bases.
2. **`#targetengine` is not honored via `$.evalFile()`/COM `DoJavaScriptFile` in AI 30.6.0** (G2): named engines were not created (ESD engine list stayed `["main", "transient"]`). "Fresh and reused engines" probes must use the ESD transport's `transient` engine (or File > Scripts with a real `#targetengine`, which this session could not drive).
3. **Read overhead is 1 µs median (p99 2 µs) on 30.6.0** (G6): the round-2 figure of ~2 µs remains compatible; 1 µs is now the median.
4. **G5 zero-delta rate is high (27.6%)**: zero deltas on empty intervals are legitimate; validation must not treat them as errors (ESTIMER accepts `minValidUs = 0`).
5. **G4 wrap sign: pending the 12:12:30 live probe** — this doc will be updated with the observed sign/width result.

---

## Corroboration run (core-dev, 11:51:13 local)

Independent re-run of `probe_hirestimer.jsx` against the same Illustrator
instance (main engine) reproduced the evidence member's numbers:

| metric | evidence (11:25) | core-dev (11:51) |
|---|---|---|
| G1 first read (main) | 675,881,881 µs (engine age 11.26 min) | 170,795,339 µs (continuing delta — engine now past wrap; clock continuity per G2) |
| G6 read overhead n=250 | median 1, p99 2, max 9 µs | median 1, p99 2, max 10 µs |
| G5 monotonicity (10k) | 0 neg; 27.6% zero; max 43 µs | 0 neg; 26.5% zero; max 12 µs |
| G3 sleep 200 ms | 212,726 µs vs 214 ms; follow-up 48 | 221,413 µs vs 222 ms; follow-up 33 |
| G8 accuracy ratio | 1.006 / 0.997 / 1.001 / 0.998 | 1.002 / 1.002 / 0.998 / 1.000 |
| G4 spaced 500 ms | 531–540k µs | 532–537k µs |

Raw: `evidence/raw/probe_main_2026-08-11T115113.json`. The 11:51 run also
observed the **main engine past its wrap point** (created 11:13:50 + 35.79
min = 11:49:39): reads remained positive and sane — additional evidence that
the engine's delta math is wrap-safe in practice (with the 12:12:30
transient wrap-span probe as the definitive check).

---

## Files

| file | purpose |
|---|---|
| `scripts/probe_hirestimer.jsx` | main-engine probe: G1, G4 (spaced), G5, G6, G3, G8 |
| `scripts/probe_engine_fresh.jsx` / `_reuse.jsx` / `_second.jsx` / `_viafile.jsx` | engine-locality probes (G2/G7) |
| `scripts/probe_scriptui_callback.jsx` | G7 ScriptUI callback continuity |
| `scripts/probe_g4_longdelta.jsx` | G4 60 s span delta |
| `evidence/raw/*.json` | raw JSON per probe run |
| `bench/bench-live.jsx` + `bench/run-bench-live.mjs` | engine-lane benchmark (deliverable 4) |
