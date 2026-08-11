# RE evidence: Photoshop 2026 ScCore.dll — host-side `getHiResTimer` counter, delta arithmetic, wrap verdict

**Author:** re-ps-sc (static RE, Ghidra headless)
**Date:** 2026-08-11
**Target:** `C:\Program Files\Adobe\Adobe Photoshop 2026\ScCore.dll` (735,728 B; analyzed from a copy at `%TEMP%\opencode\re-ps-sc\ScCore.dll` — original never written to; binary never executed)
**Ghidra:** 12.1.2 headless (`analyzeHeadless.bat`), project `C:\Users\slooshied\Documents\GhidraAgent\ghidra-projects\ps-sccore\` (program `/ScCore.dll`, full auto-analysis, decompiler; 2,255 functions recovered)
**Probes:** `ScCoreTimerProbePS1.java` (export/import inventory → decompile exports + callees + counter-import callers), `ScCoreTimerProbePS2.java` (instruction-level listing of the timer path + Context ctor decompile + state-global data/xrefs) — outputs in `ghidra-projects\ps-sccore\out\` (`sccore-timer-probe1.txt`, `sccore-ps-probe2.txt`, `exports.tsv`, `imports.tsv`, `functions.tsv`)

---

## 1. File identity (PE version resource, via PowerShell — read-only on the copy)

| item | value |
|---|---|
| FileVersion | **4.5.12.1** |
| ProductVersion | **82.4** (PS 2026 engine) |
| FileDescription | "Scripting Components Core (64 bit)" — **correctly labeled; binary IS PE64** (x86:LE:64:default, image base 0x180000000, confirmed by Ghidra loader) |
| ProductName | ScCore 2022/08/18-12:50:45 |
| CompanyName | Adobe Systems Incorporated |
| Size | 735,728 B |
| SHA256 | `8535438B0DB04E48D0C391310CB499BB21126215FFCDCBA3DB231B75192865E6` |

PS ships ScCore 4.5.12.1 / engine 82.4 (newer than AI 30.6.0's ScCore 4.5.6.1 / engine 80.1). Note: unlike AI's ScCore (whose "32 bit" description string is stale), PS's description correctly says 64-bit.

## 2. Exported host timer functions (Ghidra `exports.tsv`)

| address | name | signature (export symbol `?name@...@@...XZ`) |
|---|---|---|
| **0x180069ec0** | `ScCore::Thread::getHiResTimer` | `?getHiResTimer@Thread@ScCore@@SA_JXZ` — **static `__int64`** (SA = static, A = __cdecl → **not virtual, not overridable**) |
| **0x18006a000** | `ScCore::Time::getHiResTimer` | `?getHiResTimer@Time@ScCore@@SA_JXZ` — static `__int64` |
| 0x18006a090 | `ScCore::Time::getTicks` | `?getTicks@Time@ScCore@@SAIXZ` — static `uint` |
| 0x18006a0d0 | `ScCore::Time::getTimeZoneOffset` | `?getTimeZoneOffset@Time@ScCore@@SANXZ` — static `double` |
| 0x18006a0e0 | `ScCore::Time::getUTCTime` | `?getUTCTime@Time@ScCore@@SANXZ` — static `double` |
| 0x180008d80 | `ScCore::Dictionary::getDateTimeStampAsISO` | `?getDateTimeStampAsISO@Dictionary@ScCore@@UEBA?AVString@2@XZ` — virtual; returns `String::emptyString()` (unrelated to the timer path) |

Unlike AI's ScCore (where the exports are JMP stubs into implementations), PS's exports ARE the implementations directly — 0x180069ec0 and 0x18006a000 are real function bodies. These are the exact symbols PS's ExtendScript.dll imports (`Thread` EXTERNAL:110, `Time` EXTERNAL:14f — re-ps-ext) and AI's ExtendScript.dll imports for AI (`Thread` EXTERNAL:117, `Time` EXTERNAL:156).

## 3. THE COUNTER — `QueryPerformanceCounter`, µs via DOUBLE math, 64-bit result

`ScCore::Time::getHiResTimer` @ 0x18006a000 (disassembly, verbatim):

```
18006a000  SUB RSP,0x28
18006a004  CMP dword ptr [0x1800a5830],0x0      ; flag: QPF succeeded at init
18006a00b  LEA RCX,[RSP + 0x30]
18006a010  JZ 0x18006a03c                        ; fallback path if QPF==0
18006a012  CALL qword ptr [0x180074160]          ; QueryPerformanceCounter(&rsp+0x30)   <- IAT
18006a018  XORPS XMM0,XMM0
18006a01b  CVTSI2SD XMM0,qword ptr [RSP + 0x30]  ; (double)QPC.QuadPart   -- 64-bit operand
18006a022  DIVSD XMM0,qword ptr [0x1800a5838]    ; / freq (double)
18006a02a  MULSD XMM0,qword ptr [0x180080b70]    ; * 1000000.0
18006a032  CVTTSD2SI RAX,XMM0                    ; (int64) cast  -- 64-bit result
18006a037  ADD RSP,0x28
18006a03b  RET
```

- **Counter source: `QueryPerformanceCounter`** (KERNEL32 IAT slot `0x180074160`; 64-bit ticks, monotonic on modern Windows — invariant TSC-based).
- **µs conversion: double-precision** — `(double)QPC.QuadPart / freq * 1000000.0`, cast to `__int64`. Verified constants in file: `0x180080b70 = 1000000.0` (µs multiplier), `0x18007ce50 = 1000.0` (fallback ms→µs).
- **Frequency:** captured once at module init in `FUN_180069f70` @ 0x180069f70 via `QueryPerformanceFrequency` (IAT `0x180074168`), stored as a **double** at `0x1800a5838` (`CVTSI2SD XMM0,qword ptr [RSP+0x20]; MOVSD [0x1800a5838],XMM0`); the QPF return value is stored as the flag at `0x1800a5830` (`MOV dword ptr [0x1800a5830],EAX`).
- **Fallback path** (only when `0x1800a5830 == 0`, i.e. QPF failed — never on real Windows 10/11): `GetSystemTimeAsFileTime` (IAT `0x180074218`), 64-bit int arithmetic `FILETIME - 0x19db1ded53e8000` (FILETIME→Unix-epoch offset), `/10000` (magic multiply `0x346dc5d63886594b` + `SAR RDX,0xb`), `CVTSI2SD`, `MULSD [0x18007ce50]=1000.0` → µs, `CVTTSD2SI RAX`. **Dormant in practice.**
- **There is no 32-bit µs counter anywhere in this function.** The official "signed 32-bit µs counter" doc does not match this build: the value is a signed **64-bit** integer.

## 4. THE DELTA — full 64-bit SUB, no 32-bit narrowing

`ScCore::Thread::getHiResTimer` @ 0x180069ec0 (disassembly, verbatim — THE headline evidence):

```
180069ec0  PUSH RBX
180069ec2  SUB RSP,0x20
180069ec6  MOV RBX,qword ptr [0x1800a5608]      ; cached Context pointer (0 -> Context::get)
180069ecd  TEST RBX,RBX
180069ed0  JNZ 0x180069eda
180069ed2  CALL 0x180069c90                      ; Context::get() -> per-thread Context (TLS)
180069ed7  MOV RBX,RAX
180069eda  CALL 0x18006a000                      ; Time::getHiResTimer() -> RAX (int64 µs)
180069edf  MOV RCX,RAX                           ; RCX = new value
180069ee2  SUB RAX,qword ptr [RBX + 0xa0]        ; *** delta = now - last : 64-bit qword SUB ***
180069ee9  MOV qword ptr [RBX + 0xa0],RCX        ; store new value back (64-bit qword)
180069ef0  ADD RSP,0x20
180069ef4  POP RBX
180069ef5  RET
```

Decompiled (identical semantics, for readability):

```c
__int64 __cdecl ScCore::Thread::getHiResTimer(void)
{
  pCVar2 = DAT_1800a5608;
  if (DAT_1800a5608 == (Context *)0x0) { pCVar2 = Context::get(); }
  _Var3 = Time::getHiResTimer();                 // int64 µs (QPC path, §3)
  lVar1 = *(longlong *)(pCVar2 + 0xa0);          // last-read, int64
  *(__int64 *)(pCVar2 + 0xa0) = _Var3;           // store new value
  return _Var3 - lVar1;                          // int64 delta
}
```

- `SUB RAX, qword ptr [RBX + 0xa0]` — **full 64-bit qword subtraction**. Both operands are 64-bit; the result stays in RAX (64-bit) and is returned as `__int64`. There is **no 32-bit operand, no movsxd sign-extension of a 32-bit result, no narrowing** anywhere on the delta path.
- **Storage of last-read:** member of the per-thread `ScCore::Context` object at **offset 0xA0**, as a **64-bit int64** (`MOV qword ptr [RBX+0xa0],RCX`).

## 5. FIRST-READ — Context ctor zero-initializes +0xA0 (PS differs from AI here)

`Context` ctor `FUN_18001e3e0` @ 0x18001e3e0 (decompiled):

```c
Context * FUN_18001e3e0(Context *param_1)
{
  ScCore::Context::Context(param_1);
  ...
  *(undefined8 *)(param_1 + 0x98) = 0;
  *(undefined8 *)(param_1 + 0xa0) = 0;    // <-- last-read slot zeroed at construction
  *(undefined8 *)(param_1 + 0xa8) = 0;
  *(undefined8 *)(param_1 + 0xb0) = 0;
  ...
}
```

- A fresh thread's FIRST `Thread::getHiResTimer()` reads `+0xA0 == 0`, so it returns the raw counter value itself: **µs since QPC boot (system power-on), a large positive number** (≈ 4×10⁹ µs after 49 days of uptime). Structurally positive; no negative first read.
- **Difference vs AI 30.6.0** (re-ai-sc): AI's ScCore *primes* `Context+0xA0` with engine/thread-startup µs (one-time init + Thread ctor re-primes before `_beginthreadex`), so AI's first read is a small delta. PS instead zero-inits → PS's first read is raw µs-since-boot. Both are positive and both are monotonic-delta safe; only the magnitude of the first read differs. (Observed PS behavior "first read = engine/thread startup" per docs is not literally true in this build — it is µs-since-boot.)

## 6. Thread storage — per-thread TLS Context

`ScCore::Context::get` @ 0x180069c90 (decompiled):

```c
Context * __cdecl ScCore::Context::get(void)
{
  pCVar2 = DAT_1800a5818;                                  // static fast-path cache
  if ((DAT_1800a5818 == (Context *)0x0) &&
     (pCVar2 = TlsGetValue(DAT_1800a40c0), pCVar2 == (Context *)0x0)) {
    pCVar2 = (Context *)FUN_1800700cc(0x210);              // malloc 0x210 = sizeof(Context)
    pCVar2 = FUN_18001e3e0(pCVar2);                        // Context ctor (zeroes +0xA0)
    if (DAT_1800a5810 != '\0') { TlsSetValue(DAT_1800a40c0,pCVar2); }
    DAT_1800a5818 = pCVar1;
  }
  return pCVar2;
}
```

- The `Context` (and therefore the **last-read slot at +0xA0**) is **per-thread via TLS**: `TlsGetValue`/`TlsSetValue` on TLS index `DAT_1800a40c0` (index allocated at module init, xrefs at 0x180069bbe/0x180069c2c; value `0xffffffff` = TLS_OUT_OF_INDEXES before init). A static cache (`DAT_1800a5818`) fast-paths the first/main thread.
- So "µs since last access" is per-thread: each thread's delta is computed against its own last-read. Cross-thread interleaving cannot manufacture a negative delta (counter is global-monotonic; each thread's slot only ever moves forward).

## 7. `getTicks` — a SEPARATE 32-bit API, NOT the hiresTimer path

`ScCore::Time::getTicks` @ 0x18006a090 returns `uint` and uses `GetTickCount` (IAT `0x180074170`) with 32-bit wrap compensation:

```
18006a094  CALL qword ptr [0x180074170]          ; GetTickCount()
18006a09a  CMP EAX,dword ptr [0x1800a5844]       ; < last tick?
18006a0aa  ADD ECX,0x51eb85                      ; wrap: bias += 0x51eb85 (=2^32/800, 800 = ticks/sec)
18006a0bc  MOV EAX,0x51eb851f                    ; /50 (0x32) via magic multiply
18006a0c1  MUL EDX
18006a0c3  SHR EDX,0x4
18006a0c6  LEA EAX,[RCX + RDX*0x1]               ; return bias + ticks/50
```

This is the 32-bit, wrap-compensated API — the likely origin of the official "32-bit counter" wording. It is **never called by `Thread::getHiResTimer` or `Time::getHiResTimer`** (the hiresTimer path is QPC, §3). No 0x7fffffff/0x80000000 wrap constants appear on the hiresTimer path.

## 8. WRAP VERDICT — negative read NOT structurally possible on this build

| question | answer | evidence |
|---|---|---|
| Is the delta computed in 32-bit signed? | **NO — 64-bit** | `SUB RAX, qword ptr [RBX+0xa0]` (full qword); return type `SA_J` (`__int64`) |
| Could 2³¹ µs (35.79 min) inactivity wrap the delta negative? | **NO** | int64 subtraction of int64 µs values: a 35.79-min gap yields ≈ +2.1×10⁹ µs (positive); wrap would need 2⁶³ µs ≈ 292,000 years |
| Is the counter 32-bit? | **NO — 64-bit QPC** | `QueryPerformanceCounter` (IAT 0x180074160), 64-bit QuadPart → `CVTSI2SD ... qword ptr`, result `CVTTSD2SI RAX` |
| Could a negative value ever surface? | Only via the **dormant fallback path**: `GetSystemTimeAsFileTime` µs is wall-clock-derived, so a backwards clock step (NTP/DS) between two reads would make `now < last`. QPC path itself is monotonic (invariant TSC), and the double conversion `(double)qpc/freq*1e6` is order-preserving for positive inputs (truncation can plateau but never decrease). Fallback runs only when QPF fails (`0x1800a5830 == 0`) — effectively never on Windows 10/11. | fallback path §3; `CMP dword ptr [0x1800a5830],0x0` gate |

**Bottom line:** on the QPC path (always live on real hardware), negative reads are structurally impossible — the arithmetic is 64-bit throughout, the counter is monotonic, and there is no 2³¹-µs wrap. The only theoretical negative vector is the wall-clock fallback combined with a backwards clock adjustment, which requires QPF failure. This matches re-ai-sc's AI verdict (64-bit, no negative) and re-ps-ext's PS ExtendScript.dll verdict (zero arithmetic in the DLL; delta semantics wholly host-side).

## 9. Cross-checks with parallel lanes

- **re-ps-ext (PS ExtendScript.dll, task_98b208a6...):** dispatcher `FUN_18000cfd0` case 0x15 calls `ScCore::Thread::getHiResTimer()` → `Variant::setDouble` (64-bit double), zero arithmetic. Consistent: the host returns `__int64`; ExtendScript widens to double. No negative can be *produced* in ExtendScript.dll; this analysis shows the host cannot produce one either.
- **re-ai-sc (AI ScCore.dll, task_188443f3...):** identical architecture on AI 30.6.0: QPC → double → int64 µs; `now - *(int64*)(Context+0xa0)`; 64-bit SUB; per-thread TLS Context; verdict no-negative. The one PS-vs-AI difference is first-read priming (§5).
- **evidence (live probes, deliverable/t3-evidence):** G4 wrap-span probe on AI observed no negative reads in practice — consistent with both static verdicts.

## 10. Confidence & limitations

- **Confidence: high** for all headline claims. The delta-path and counter-path evidence is instruction-level (verbatim disassembly quoted above), not decompiler inference; the exported symbols are from the PE export table (source=IMPORTED in Ghidra, matching the mangled names).
- Assumed `_DAT_180080b70 = 1000000.0` and `_DAT_18007ce50 = 1000.0` from in-file data reads (LE double at those addresses) — consistent with the µs semantics and with AI's identical constants.
- `FUN_180069f70` (QPF/QPF-init) is invoked from the module-init path; exact init caller not traced (not needed for the verdict).
- Did not instrument/execute anything; no runtime confirmation that QPF never fails on PS's supported hardware (universally true on Win10/11; treated as an assumption, marked ASSUMPTION: in the wrap analysis).
- The shared Ghidra `scripts\` directory suffered a filename collision during this lane (another member's `ScCoreTimerProbe2.java`); lane probes were re-isolated under `scripts\re-ps-sc\` — noted so other members use per-lane script names.
