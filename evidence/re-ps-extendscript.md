# RE evidence: Photoshop 2026 ExtendScript.dll — `$.hiresTimer` dispatcher parity

**Author:** re-ps-ext (static RE, Ghidra headless)
**Date:** 2026-08-11
**Target:** `C:\Program Files\Adobe\Adobe Photoshop 2026\ExtendScript.dll` (analyzed from a copy at `%TEMP%\opencode\re-ps-ext\ExtendScript.dll`; the original was never written to)
**Ghidra:** 12.1.2 headless (`analyzeHeadless.bat`), project `C:\Users\slooshied\Documents\GhidraAgent\ghidra-projects\ps-extendscript\` (program `/ExtendScript.dll`, auto-analysis, decompiler)
**Probes:** `HiresTimerProbe.java` (strings/imports/xrefs), `HiresTimerProbe7.java` (import-thunk getter pass), `HiresTimerProbe8.java` (property-table linkage + wrap-constant scan) — outputs in `ghidra-projects\ps-extendscript\out\`, `out7\`, `out8\` (copies in `evidence/raw/`)

---

## 1. File identity (PE version resource, via PowerShell)

| item | value |
|---|---|
| FileVersion | **4.5.12.1** |
| ProductVersion | 82.4 (engine build) |
| FileDescription | Adobe ExtendScript scripting engine (64 bit) |
| ProductName | ExtendScript 2022/08/18-12:50:45 (build timestamp) |
| LegalCopyright | Copyright 1998-2024 Adobe |
| Size | 746,992 B (AI 30.6.0's ExtendScript.dll: 956,408 B) |
| SHA256 | see `evidence/raw/re-ps-extendscript.sha256.txt` |

PS ships a **newer** ExtendScript build than AI 30.6.0 (4.5.12.1 / engine 82.4 vs 4.5.6 / engine 80.1). The `$` dispatcher confirms this: `case 2` decodes `"4.5.12"`, `case 3` sets `"82.4"` (AI: `"4.5.6"` / `"80.1"`).

## 2. The `$` property dispatcher and the hiresTimer case

- **Dispatcher: `FUN_18000cfd0`** (AI equivalent: `FUN_1800197d0`). Same switch-on-`*(param_2+0x20)` shape, same case numbering.
- **hiresTimer case = `0x15`**, decompiled verbatim:

```c
case 0x15:
    pVVar4 = *(Variant **)(param_2 + 0x30);
    _Var12 = ScCore::Thread::getHiResTimer();
    ScCore::Variant::setDouble(pVVar4,(double)_Var12);
    break;
```

- **Property-table linkage (closed):** the `"hiresTimer"` string lives at `18007b140`; the `$` property table at `18007ab10` holds `->18007b140` followed by case id `0x15` (window dump in `out8\hiresTimer-linkage.txt`). This is byte-for-byte the same table shape as AI (`estimer-hires\out2`: `18009aa50 -> 18009b208, 0x15`).
- **64-bit double storage CONFIRMED:** the result of the host import is cast to `double` and stored via the imported `ScCore::Variant::setDouble` (`SCCORE.DLL::ScCore::Variant::setDouble` is in the import table). No integer variant, no truncation, no sign handling.

## 3. Getter call chain

`$.hiresTimer` → `$` dispatcher `FUN_18000cfd0` case 0x15 → import thunk `getHiResTimer` (`EXTERNAL:00000110`, `SCCORE.DLL::ScCore::Thread::getHiResTimer`) → host ScCore.dll. The DLL adds **zero** arithmetic on this path.

## 4. Dual getHiResTimer imports — same shape as AI

| import | PS ExtendScript.dll | AI ExtendScript.dll |
|---|---|---|
| `ScCore::Thread::getHiResTimer` | EXTERNAL:00000110 (thunk `18006f490`) | EXTERNAL:00000117 (thunk `1800827d6`) |
| `ScCore::Time::getHiResTimer` | EXTERNAL:0000014f (thunk `18006f61e`) | EXTERNAL:00000156 (thunk `180082950`) |
| `getTicks` | EXTERNAL:0000014e | EXTERNAL:00000155 |
| `getUTCTime` | EXTERNAL:0000011c | EXTERNAL:00000123 |
| `getDateTimeStampAsISO` | EXTERNAL:0000011a | EXTERNAL:00000121 |
| `getTimeZoneOffset` | EXTERNAL:000001ea | EXTERNAL:000001ef |

**PS has the same dual-import shape** (Thread:: + Time::), same thunk pattern (DATA ref in IAT + COMPUTED_JUMP thunk), same caller set structure.

## 5. Delta / wrap / TLS arithmetic inside the DLL — NONE on the `$` path

All 8 getHiResTimer callers decompiled (`out7\hiresTimer-getter.txt`):

| caller | role | arithmetic on the value |
|---|---|---|
| `FUN_18000cfd0` case 0x15 | **`$` dispatcher** | **none — raw → setDouble** |
| `FUN_180022600` | engine suspend/resume (AI `FUN_180031030`) | none — stores raw to engine+0x40 |
| `FUN_1800224c0` | jsRunner timing accumulator (AI `FUN_180030e80`) | 64-bit delta between two reads (`_Var3 - lVar2`) |
| `FUN_18001eb50` | eval dispatcher profiling (AI `FUN_18002f580`) | 64-bit delta between two reads |
| `FUN_180064840` | jsRunner ctor (AI `FUN_1800708f0`) | none — stores raw |
| `FUN_180064940` / `FUN_1800649c0` | jsRunner dtor (AI `FUN_180070a30`) | 64-bit delta between two reads |

- The only arithmetic anywhere is **64-bit signed subtraction between two host reads** feeding the engine's internal profiling accumulator — identical to AI, and unrelated to the `$` property.
- **Wrap-constant scan:** zero occurrences of `0x7fffffff` / `0x80000000` in any decompiled caller; every `0xffffffff` hit is a call argument, return-value mask, or jsRunner field init — none touches the timer value.
- **TLS imports: none** (no `TlsGetValue`/`TlsSetValue`/`TlsAlloc` in the 584-entry import table).
- **No `GetTickCount`/`GetTickCount64`/`timeGetTime`/`GetSystemTime`**; `QueryPerformanceCounter` is imported but referenced only by CRT `__security_init_cookie` (cookie seeding), and there is no `QueryPerformanceFrequency` import at all. The timer is entirely host-side (ScCore.dll), as in AI.

## 6. Verdict on the parity question

**Parity with the Illustrator 30.6.0 finding is confirmed at the DLL level.** Photoshop 2026's ExtendScript.dll (4.5.12.1 / engine 82.4) implements `$.hiresTimer` with the identical structure: `$` dispatcher case 0x15 calls the host import `ScCore::Thread::getHiResTimer()` and stores the raw value as a **64-bit double** via `ScCore::Variant::setDouble`, with **no delta, TLS, or wrap arithmetic inside the DLL**. A signed-32-bit-wrap (negative-read) is therefore **not structurally possible inside PS's ExtendScript.dll** — the value handed to the script is exactly the host's 64-bit counter converted to double. Whether a negative read can ever surface depends solely on the host-side ScCore.dll implementation (Photoshop's ScCore.dll, 735,728 B vs AI's 888,824 B — covered by re-ps-sc's task), not on this DLL.

## 7. Confidence & limitations

- Dispatcher case 0x15, property-table linkage, dual imports, and the no-arithmetic path: **high confidence** (decompiler output + table window + import table all agree; identical to the AI baseline).
- The delta-arithmetic callers were classified by decompiler inference; their exact role (profiling accumulator) is inferred from the AI baseline, not from symbols.
- No live probing was performed (static RE only); live PS behavior is evidence's lane.
- Decompiler warnings ("Could not recover jumptable", "Treating indirect jump as call") on the import thunks are expected for delay-load-style thunks and do not affect the dispatcher analysis.

## 8. Artifacts

- `ghidra-projects\ps-extendscript\out\` — inventory (imports.tsv, exports.tsv, strings.tsv, functions) + `hiresTimer-functions.c` + `hiresTimer-summary.tsv`
- `ghidra-projects\ps-extendscript\out7\hiresTimer-getter.txt` — import thunks, xrefs, all 8 callers decompiled
- `ghidra-projects\ps-extendscript\out8\hiresTimer-linkage.txt` — string/table linkage + wrap scan
- `evidence/raw/re-ps-extendscript.*` — copies of the above + sha256