# ESTIMER MEASURED-FACTS.md — the only file the publisher may quote numbers from

Every number below was measured, not assumed. Each entry carries its environment line and the exact command/artifact that produced it. No invented numbers.

**Provenance legend:**
- `[evidence]` = live engine probe via COM tool (this session, evidence member)
- `[live-verify]` = `npm run live-verify` in `estimer/` (56/56 engine checks)
- `[t2-infra]` = infra-tests' t2 run (provenance: t2-infra run; corroborated by core-dev)
- `[bench-engine]` = `node bench/run-bench-live.mjs` (evidence, 3 rounds)
- `[bench-node]` = `npm run benchmark` (evidence re-run; infra-tests/core-dev same lanes)

---

## 1. Host strings

| item | value | provenance |
|---|---|---|
| Application | Adobe Illustrator **30.6.0** (build **109R**) | `[evidence]` `app.version`/`app.buildNumber` in probe |
| ExtendScript | **4.5.6** (engine build 80.1) | `[evidence]` `$.version`/`$.build`; live-verify host line |
| OS | Windows 10/64 (10.0), x86-64, en_US | `[evidence]` `$.os`/`$.locale` |
| Node (bench reference lane) | v22.23.2 | `[bench-node]` `process.version` |
| Engine creation (main) | ≈2026-08-11T11:13:50 local (process started 02:12:14 — engine is NOT the process) | `[evidence]` G1 first-read math |
| ESD engines available | `main`, `transient` only (`#targetengine` not honored via evalFile/DoJavaScriptFile) | `[evidence]` `debug attach` |

## 2. G1–G8 measured facts

### G1 — first read magnitude (engine/thread uptime µs)
- Main engine, first-ever access (11:25:06): **675,881,881 µs** = engine age ≈11.26 min. Second read 1 µs, third 1 µs. → first read is ENGINE age µs, must be discarded, NOT ~0.
- Fresh engine (ESD `transient`, 11:34:58): **13,147,054 µs** = its own 13.15 s age (independent clock).
- Env: Illustrator 30.6.0 (109R) / ES 4.5.6 / Windows 10/64. Provenance: `[evidence]` `scripts/probe_hirestimer.jsx` `probes.g1` + ESD transient eval; `evidence/raw/probe_main_2026-08-11T112506.json`.
- ESTIMER behavior: `prime()` discards it; live-verify "prime/now first read tiny" passed. `[live-verify]`

### G2 — fresh-engine first read / thread-locality
- Fresh engine (transient) first read = its own init µs (13.15 s age), independent of main. `[evidence]`
- `#targetengine` NOT honored via `$.evalFile`/`DoJavaScriptFile`: files ran in `main`, returned continuing deltas (75,642,147 µs at 11:26:24; 36,149,200 µs at 11:32:06). Engines list stayed `["main","transient"]`. `[evidence]`
- Delta clock continues across eval invocations within an engine (transient: 13,147,054 → 17,496,676 µs over 18 s). `[evidence]`
- Env as above. Provenance: `[evidence]` engine-locality probe set; `evidence/raw/engine_locality_2026-08-11.json`.

### G3 — $.sleep inclusion
- read, `$.sleep(200)`, read → **212,726 µs** hires vs **214 ms** Date wall; follow-up 48 µs (no jump). Sleep time IS included (wall-based). Env as above. `[evidence]` `probes.g3`.

### G4 — long deltas + 32-bit wrap evidence
- 60 s span delta: **64,330,333 µs** vs Date 64,331 ms (ratio 0.99999); follow-up 32 µs. Deltas accurate over minute-scale spans. `[evidence]` `probe_g4_longdelta.jsx` (11:36:50).
- Wrap math (engine-side): wrap point 2^31 µs = 35.79 min of **engine** age; correction period 2^32 µs = 71.58 min. Main engine wraps ≈11:49:39, transient ≈12:10:30 (engine-creation + 35.79 min).
- **Wrap-span live read (transient engine, 12:12:30, spans the 12:10:30 wrap; last read 11:35:16):** *result appended after the probe fires* — `evidence/raw/transient_wrap_result.json`. Env as above. `[evidence]` scheduled probe.
- ESTIMER wrap policy: default `'correct'` (negative delta += 2^32, single-wrap, exact for interval in [2^31, 2^32) µs; still-negative → 0); `'reject'` never advances on negatives. Live-verify wrap round-trip passed. `[live-verify]`

### G5 — monotonicity (10k consecutive reads)
- **negatives: 0**; zeros 2,758 (27.6 %); positives 7,242; non-increase (≤0) 2,758; min 0 / max 43 µs; no huge (>1e6) samples. → monotone non-negative; zero deltas legitimate (sub-µs intervals). `[evidence]` `probes.g5`.
- Corroborated: live-verify "100 reads monotonic non-negative". `[live-verify]`

### G6 — read overhead (engine, raw)
- Raw `$.hiresTimer` read, n=250: **median 1 µs**, mean 1.016, p99 2 µs, max 9 µs. Env as above. `[evidence]` `probes.g6`.
- ESTIMER `calibrate()` (median of 100 raw reads, through the facade): **2 µs** (describe.calibratedUs=2, reads=260 after bench lanes). `[bench-engine]` raw JSON.
- Facade overhead (engine): now-read median **5 µs**, measureUs-noop **9–10 µs**, stopwatch-cycle **11 µs**, median9 protocol **98 µs**. `[bench-engine]`

### G7 — ScriptUI callback continuity
- ScriptUI button onClick via `notify()`: callback first read **15,586 µs** vs wall gap 15 ms since main-thread prime → same engine thread, shared delta clock. Second read 2 µs. `[evidence]` `probe_scriptui_callback.jsx` (11:35:53).
- evalFile/DoJavaScriptFile boundaries: clock continues (G2 deltas). Stopwatch nesting-safe live: outer ≥ inner, elapsed ≥ outer. `[live-verify]`

### G8 — rejection ceiling consensus
- All real reads 0–675.9e6 µs (first-read) / 0–64.3e6 µs (deltas). (0, 1e8] µs = 100 s is sound for sub-100 s ops; per-op override for known-slow lanes; ceiling must not double as the wrap guard (that's the accumulator+wrap policy). ESTIMER defaults: MAX_VALID_US 1e8, MIN_VALID_US 0, override per-op, rejected reduce set. `[evidence]`+`[live-verify]` (measureUs capped(1) → null passed live).

## 3. Live-verify engine parity count

- **56/56 engine checks passed** on Illustrator 30.6.0 / ExtendScript 4.5.6 — `npm run live-verify`, exit 0. Counted by the harness's `ok()` counter (one per assertion). Provenance: `[live-verify]` (evidence re-run 11:46); `[t2-infra]` identical 56/56.

## 4. dist artifact sizes (bytes)

| artifact | bytes | provenance |
|---|---|---|
| `dist/ESTIMER.jsx` | **13,765** | `Get-ChildItem dist` (evidence, 11:47); `[t2-infra]` + core-dev byte-identical |
| `dist/vendor-estimer.js` | **14,002** | same |
| `dist/estimer-core.esm.mjs` | **10,462** | same |

## 5. Benchmark medians (µs, medians-of-9, warmup 5, 0 rejections, 3 rounds)

### Engine lane (real $.hiresTimer, Illustrator 30.6.0) — `[bench-engine]`
| lane | medianUs | minUs | p95Us |
|---|---|---|---|
| measureUs-noop | **10** | 9 | 10–11 |
| now-read | **5** | 4 | 5 |
| epoch-read | **5** | 5 | 5 |
| stopwatch-cycle | **11** | 10 | 13 |
| median9-noop | **98** | 95 | 101 |
| medianOf-31 | **86** | 85 | 87 |
| empty-loop-1e6 | **56,474** | 54,320 | 61,609 |

### Sleep accuracy (engine) — `[bench-engine]`
| reqMs | sleptUs median | wallMs median | error % |
|---|---|---|---|
| 2 | 2,004 | 2 | +0.2 |
| 25 | 34,463 | 35 | +37.9 |
| 50 | 60,810 | 61 | +21.6 |
| 250 | 275,888 | 276 | +10.4 |

### Node reference lane — `[bench-node]` (evidence re-run; t2-infra/core-dev agree within normal µs variance)
| lane | medianUs (node) | engine median | ratio |
|---|---|---|---|
| measureUs-noop | 0.40 | 10 | 25× |
| now-read | 0.70 | 5 | 7.1× |
| epoch-read | 0.70 | 5 | 7.1× |
| medianOf-31 | 4.10 | 86 | 21× |
| empty-loop-1e6 | 462.6 | 56,474 | 122× |

## 6. Test/fuzz counts — `[t2-infra]` (also re-run by evidence, identical)

- `npm test`: **5,165 checks passed** (10 clock vectors ×2 lanes + 9 stats vectors + 8 medianOf vectors + 2000 medianOf differential + 3000 stats differential + ~100 direct unit checks). Counted by harness `passed` counter.
- `npm run fuzz`: **2,000,028 differential iterations passed, seed 1337, 0 divergences** (4 lanes; 70% clean deltas 0..200000 µs, 30% adversarial incl. negatives to −3e9, huge positives to 5e12, wrap-boundary ±[2^31,2^32), startup 1e9; random caps; random int/float arrays).

## 7. Research corrections (publisher: ## Research corrections section)

1. **Counter base = ExtendScript engine creation, not process start** (G1/G2) — first read = engine age µs; fresh engines get fresh bases.
2. **`#targetengine` not honored via `$.evalFile`/`DoJavaScriptFile`** in AI 30.6.0 (G2).
3. **Read overhead median 1 µs (p99 2 µs)** on 30.6.0 (G6) — prior round-2 figure ~2 µs compatible.
4. **Zero-delta rate 27.6 % on empty intervals is legitimate** (G5) — validation must accept 0 (ESTIMER does: MIN_VALID_US 0).
5. **G4 wrap sign**: pending the 12:12:30 live probe (this file updated when it fires).
