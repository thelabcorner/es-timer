# ESTIMER benchmark — round 1 (engine lane, Illustrator 30.6.0)

**Author:** evidence
**Date:** 2026-08-11
**Host:** Adobe Illustrator 30.6.0 (build 109R), ExtendScript 4.5.6 (engine build 80.1), Windows 10/64 (10.0), x86-64, en_US. Engine created ≈11:13:50 local; runs 11:46–11:47 local.
**Route:** COM `eval --file` (directive-free file → injected wrapper body) via `ILLUSTRATOR_COM_TOOL.py`; library loaded via `$.evalFile(File("dist/vendor-estimer.js"))`, facade at `$.global.ESTIMER`.
**Protocol (house, research plan §2.7):** prime immediately before each lane; 5 warmups discarded; 9 measured runs per lane; samples validated in (0, 1e8] µs (rejected excluded from stats); **one lane per eval**; 3 rounds per lane; median of the round medians reported. Raw per-run JSON in `bench/raw/`.

---

## Engine-lane tables (ESTIMER facade, real $.hiresTimer)

| lane | medianUs | minUs | p95Us | n | rej | note |
|---|---|---|---|---|---|---|
| measureUs-noop | **10** (9) | 9 | 10 (11) | 9 | 0 | facade read overhead via measureUs (prime + read + validate) |
| now-read | **5** | 4 | 5 | 9 | 0 | bare `now()` read (accumulator + wrap check) |
| epoch-read | **5** | 5 | 5 | 9 | 0 | bare `epoch()` read |
| stopwatch-cycle | **11** | 10 | 13 | 9 | 0 | start()+stop() full cycle |
| median9-noop | **98** | 95 | 101 | 9 | 0 | full median-of-9 protocol (prime + 9 samples + validation + median) |
| medianOf-31 | **86** | 85 | 87 | 9 | 0 | pure array median of 31 numbers |
| empty-loop-1e6 | **56,474** | 54,320 | 61,609 | 9 | 0 | 1e6-iteration empty loop (engine throughput control) |

`measureUs-noop` median was 9 µs in round 1 and 10 µs in round 3 (ranges shown parenthetically); `now-read` 4–5 µs. calibrate() (median of 100 raw reads) reported by the measureUs-noop lane: see raw JSON.

**Read overhead decomposition (engine):**
- raw `$.hiresTimer` read: median **1 µs** (p99 2 µs) — see research-probes.md G6
- facade `now()`: **5 µs** (accumulator + wrap-correction per read)
- facade `measureUs(noop)`: **9–10 µs** (prime + read + validation + reject path)
- median-of-9 protocol: **98 µs** (9 samples + per-sample validation + median sort)

## Sleep accuracy (sleep() actual µs vs requested ms, wallNow span)

| reqMs | sleptUs (median) | wallMs (median) | error % vs req |
|---|---|---|---|
| 2 | 2,004 | 2 | **+0.2 %** |
| 25 | 34,463 | 35 | **+37.9 %** |
| 50 | 60,810 | 61 | **+21.6 %** |
| 250 | 275,888 | 276 | **+10.4 %** |

Interpretation: the busy-wait lane (< 25 ms) lands within ~0.2 %. The coarse lane (≥ 25 ms: `$.sleep(ms-1)` + calibrated busy-wait) **never sleeps early but overshoots** — `$.sleep` polls at ~100 ms granularity (documented imprecision), and the landing policy is deliberately "never early". Observed overshoot spread across the 3 rounds: 25 ms → +5 % to +50 % (26.2–37.6 ms), 50 ms → +21 % to +23 % (60.3–61.7 ms), 250 ms → +9 % to +10 % (272–276 ms); median-round values in the table. Overshoot is reported via the return value (actual µs), which is the contract — never trust `sleep(ms)` to land on the millisecond, trust the returned µs.

## Node reference lane (parity, `npm run benchmark`)

| lane | medianUs (node) | medianUs (engine) | ratio engine/node |
|---|---|---|---|
| measureUs-noop | 0.40 | 10 | 25× |
| now-read | 0.70 | 5 | 7.1× |
| epoch-read | 0.70 | 5 | 7.1× |
| medianOf-31 | 4.10 | 86 | 21× |
| empty-loop-1e6 | 462.6 | 56,474 | 122× |

Node host: node v22.23.2, lane=node (performance.now×1000), calibrated read overhead 0.30 µs, wrapPolicy=correct, primed=true. The engine is 7–122× slower depending on lane (raw read overhead ~1 µs engine vs ~0.3 µs Node; interpreter throughput 122× slower on the empty loop).

## Engine-parity counts (live-verify, `npm run live-verify`)

**56/56 engine checks passed** on Illustrator 30.6.0 / ExtendScript 4.5.6 — covering: constants, lane detection, prime/now/epoch, 100-read monotonicity, measureUs validation (incl. capped-1 rejection), samples/median/best, stopwatch nesting (inner/outer/elapsed), wrap-policy round-trip, sleep lanes, calibrate, describe. Exit 0. See MEASURED-FACTS.md for the count and provenance.

## Environment / reproducibility

- Commands: `node bench/run-bench-live.mjs` (engine, all lanes + 3-round repeat), `node bench/run-bench-live.mjs --lanes median9-noop,measureUs-noop,now-read` (protocol lane), `npm run benchmark` (Node reference).
- Raw artifacts: `bench/raw/bench-live-raw-2026-08-11T16-46-23-853Z.json`, `bench/raw/bench-live-raw-2026-08-11T16-47-05-602Z.json`.
- All 9 samples valid in every lane (rej = 0) — no rejection events in the engine lanes this round.
