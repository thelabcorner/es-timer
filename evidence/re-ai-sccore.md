# RE evidence: Illustrator 30.6.0 ScCore.dll — host-side `getHiResTimer` counter, delta arithmetic, first-read

**Author:** re-ai-sc (static RE, Ghidra headless)
**Date:** 2026-08-11
**Target:** `C:\Program Files\Adobe\Adobe Illustrator 2026\Support Files\Contents\Windows\ScCore.dll` (888,824 B; analyzed from a copy at `%TEMP%\opencode\re-ai-sc\ScCore.dll` — the original was never written to; source never executed)
**Ghidra:** 12.1.2 headless (`analyzeHeadless.bat`), project `C:\Users\slooshied\Documents\GhidraAgent\ghidra-projects\ai-sccore\` (program `/ScCore.dll`, full auto-analysis, decompiler)
**Probes:** `ScCoreTimerProbe.java` (exports → decompile → callees → counter-import callers), `ScCoreTimerProbe2.java` (constant dumps + Thread ctor/go), `ScCoreTimerProbe3.java` (instruction-level verification + Context ctor) — outputs in `ghidra-projects\ai-sccore\out\`

---

## 1. File identity (PE version resource, via PowerShell)

| item | value |
|---|---|
| FileVersion | **4.5.6.1** |
| ProductVersion | **80.1** (Illustrator 30.6.0 engine) |
| FileDescription | "Scripting Components Core (32 bit)" — stale string; **binary is PE64** (x86:LE:64, image base 0x180000000) |
| ProductName | ScCore 2014/12/03-09:00:00 |
| CompanyName | Adobe Inc |
| Size | 888,824 B |
| SHA256 | `DE8972AD09CF7690EBFDEB55B1783E083069D61A9D8A3DB06B08137844AE3BFA` |
| Build tag | `__BUILDINFO__ScCore_4_5_6_80` (string at 0x1800c1000) |

AI ships ScCore 4.5.6.80 / engine 80.1. (For comparison: PS 2026's ExtendScript.dll is 4.5.12.1 / engine 82.4 — newer; PS's ScCore.dll, 735,728 B, is re-ps-sc's lane.)

## 2. Exported host timer functions (Ghidra `exports.tsv`)

| address (export thunk) | name | signature (from export symbols `?name@...@@...XZ`) |
|---|---|---|
| 0x180002e1e | `ScCore::Thread::getHiResTimer` | `?getHiResTimer@Thread@ScCore@@SA_JXZ` — static `__int64` |
| 0x180001ff5 | `ScCore::Time::getHiResTimer` | `?getHiResTimer@Time@ScCore@@SA_JXZ` — static `__int64` |
| 0x180003189 | `ScCore::Time::getTicks` | `?getTicks@Time@ScCore@@SAIXZ` — static `uint` |
| 0x18000359e | `ScCore::Time::getUTCTime` | `?getUTCTime@Time@ScCore@@SANXZ` — static `double` |
| 0x180003724 | `ScCore::Time::getTimeZoneOffset` | `?getTimeZoneOffset@Time@ScCore@@SANXZ` — static `double` |
| 0x1800030b2 | `ScCore::Dictionary::getDateTimeStampAsISO` | `?getDateTimeStampAsISO@Dictionary@ScCore@@UEBA?AVString@2@XZ` |

Both `getHiResTimer` exports are **JMP stubs** into the real implementations:
- `0x180001ff5: JMP 0x18006c240` (Time impl)
- `0x180002e1e: JMP 0x18006c0d0` (Thread impl — the delta function)

These are the exact exports AI's ExtendScript.dll imports (`Thread` EXTERNAL:00000117, `Time` EXTERNAL:00000156 — proven in the prior `estimer-hires` project). PS's ExtendScript.dll imports the same two (`EXTERNAL:110`, `EXTERNAL:14f` — re-ps-ext).

## 3. THE COUNTER — `QueryPerformanceCounter`, µs via DOUBLE math, 64-bit result

`ScCore::Time::getHiResTimer` impl `FUN_18006c240` @ 0x18006c240 (decompiled verbatim):

```c
__int64 __cdecl ScCore::Time::getHiResTimer(void)
{
  double dVar1;
  LARGE_INTEGER aLStackX_8 [4];

  if (DAT_1800c4778 != 0) {                       // flag: QPF succeeded at init
    QueryPerformanceCounter(aLStackX_8);
    return (longlong)(((double)aLStackX_8[0].QuadPart / _DAT_1800c4780) * _DAT_18008c940);
  }
  dVar1 = getUTCTime();
  return (longlong)(dVar1 * DAT_1800889c8);
}
```

- **Counter source: `QueryPerformanceCounter`** (KERNEL32 import `EXTERNAL:0000002a`; 64-bit ticks, monotonic on modern Windows).
- **µs conversion: double-precision** — `(double)QPC.QuadPart / freq * 1000000.0`, cast to `__int64`. Verified constants in file: `DAT_18008c940 = 1000000.0` (µs multiplier), `DAT_1800889c8 = 1000.0` (fallback ms→µs).
- **Frequency:** captured once at init in `FUN_18006c190` (below) via `QueryPerformanceFrequency`, stored as a **double** at `0x1800c4780`; the success value of QPF is stored at `0x1800c4778` (nonzero → QPC path).
- **Fallback path** (`QPF` returned 0 — effectively never on real Windows): `getUTCTime()` = `GetSystemTimeAsFileTime`, `(FILETIME - 0x19db1ded53e8000) / 10000` ms since 1970, × 1000 → µs. Dormant in practice.
- There is **no 32-bit µs counter anywhere in this function**: the official "signed 32-bit µs" description does not match this build. The value is a signed **64-bit** integer.

The init, `FUN_18006c190` @ 0x18006c190 (called once, guarded by `ScAtomicInc`):

```c
void FUN_18006c190(char param_1)
{
  ...
  if (param_1 != '\0') {
    _tzset();
    DVar1 = GetTimeZoneInformation(&local_c8);
    if (DVar1 != 0xffffffff) { DAT_1800c4770 = (double)local_c8.Bias * 60000.0; }
    DAT_1800c4778 = QueryPerformanceFrequency(local_d8);   // flag
    _DAT_1800c4780 = (double)local_d8[0].QuadPart;          // freq as double
  }
}
```

## 4. THE DELTA — per-thread `Context+0xa0`, **64-bit** subtraction

**Getter-role distinction (for the record):** the two exported getters have different jobs. `Time::getHiResTimer` (impl `FUN_18006c240`) is the **counter→µs converter** — it reads QPC and produces the absolute int64 µs value. `Thread::getHiResTimer` (impl `FUN_18006c0d0`) is the **delta wrapper** — it calls the Time variant and returns `now − last-read`. ExtendScript.dll's `$` dispatcher calls the **Thread** variant (per the ExtendScript.dll RE), so the value handed to a script is already a 64-bit µs delta; the µs conversion happened host-side in the Time variant, and the dispatcher's `setDouble` cast adds no arithmetic. No behavioral consequence — both legs are 64-bit and order-preserving.

`ScCore::Thread::getHiResTimer` impl `FUN_18006c0d0` @ 0x18006c0d0 (decompiled verbatim):

```c
longlong __cdecl ScCore::Thread::getHiResTimer(void)
{
  longlong lVar1;
  Context *pCVar2;
  __int64 _Var3;

  pCVar2 = DAT_1800c44a8;
  if (DAT_1800c44a8 == (Context *)0x0) { pCVar2 = Context::get(); }
  _Var3 = Time::getHiResTimer();               // now, as int64 µs
  lVar1 = *(longlong *)(pCVar2 + 0xa0);        // last-read, int64
  *(__int64 *)(pCVar2 + 0xa0) = _Var3;          // store now
  return _Var3 - lVar1;                         // 64-bit delta
}
```

x86 at 0x18006c0d0 (instruction-level confirmation):

```
18006c0d0  PUSH RBX
18006c0d6  MOV RBX,qword ptr [0x1800c44a8]   ; cached Context ptr (or Context::get)
18006c0ea  CALL 0x180001ff5                  ; Time::getHiResTimer() -> RAX
18006c0ef  MOV RCX,RAX
18006c0f2  SUB RAX,qword ptr [RBX + 0xa0]    ; RAX = now - last  (64-bit SUB, no truncation)
```

- **Where last-read lives:** offset `+0xa0` of the per-thread `ScCore::Context` object. `Context::get` @ 0x180001e42 is TLS-backed: `TlsGetValue(DAT_1800c27fc)`, lazily allocating a 0x210-byte Context and caching it (`DAT_1800c4760`). TLS imports are host-side in ScCore (ExtendScript.dll has none — matches re-ps-ext's PS finding).
- **Subtraction width: 64-bit signed** (`SUB RAX, qword [RBX+0xa0]`; both operands `__int64`, return type `__int64`). There is **no 32-bit truncation** — a 2^31-µs (35.8 min) or 2^32-µs (71.6 min) wrap is structurally impossible on this path. This matches the live probe: positive reads at 52.7 min engine age (past 2^31 twice).

## 5. FIRST-READ — primed at ScCore init / thread creation; fresh contexts zero-init

Three priming sites:

1. **One-time ScCore init** `FUN_18001cf80` @ 0x18001cf80 (guarded by `ScAtomicInc(&DAT_1800c45e8)`, runs once per process):
   ```c
   if (iVar1 == 1) {
     thunk_FUN_18006c190('\x01');                 // QPF init (freq+flag)
     _Var2 = ScCore::Time::getHiResTimer();       // capture current QPC-derived µs
     ...
     pCVar3 = Context::get();
     ...
     *(__int64 *)(pCVar3 + 0xa0) = _Var2;         // PRIME last-read = engine-startup µs
   }
   ```
   → the main thread's **first `Thread::getHiResTimer()` delta ≈ 0** (µs since engine/ScCore startup) — matches observed "first-read = engine startup".

2. **Thread ctor** `ScCore::Thread::Thread` @ 0x180001019 (same body as FUN_18006be60): captures `_Var1 = Time::getHiResTimer()` **before** `_beginthreadex`, and on success stores it into the **creating** thread's `Context+0xa0`:
   ```c
   _Var1 = Time::getHiResTimer();
   uVar2 = _beginthreadex((void *)0x0,0,go,this,4,auStackX_10);
   ...
   pCVar3 = Context::get();
   *(__int64 *)(pCVar3 + 0xa0) = _Var1;           // PRIME creator's last-read
   ```
   → after creating a `ScCore::Thread`, the creating thread's next read ≈ µs since the spawn ("thread startup"). New threads run `Thread::go` → their own Context is created lazily by `Context::get()`.

3. **Context ctor** `FUN_1800285f0` zero-initializes the member: `*(undefined8 *)(param_1 + 0xa0) = 0;`. A brand-new thread whose Context was never primed therefore first-reads `now - 0` = full µs since boot — still **positive** (e.g. ~1.7e12 µs at 20 days, well within int64).

## 6. WRAP VERDICT (Illustrator 30.6.0 host)

**NO — a negative read cannot surface from this code path.**

Evidence chain: the counter is QPC-derived µs computed in **double** and carried as **int64**; the delta is a **64-bit signed** `now − last` with the last-read stored as int64 in per-thread TLS Context. QPC is monotonic non-decreasing on modern Windows, and the double→int64 conversion (`/freq * 1e6`, all positive constants) is order-preserving, so `now ≥ last` always ⇒ delta ≥ 0 always. The 32-bit `getTicks` API (GetTickCount-based, with explicit wrap compensation `+0x51eb85` per 2^32-ms wrap) is a separate coarse timer and is **not** on the hiresTimer path. The only theoretical negative would require the dormant UTCTime fallback (QPF failing) *and* the wall clock being set backward between two reads — not reachable on this build in practice.

**Library implication:** the official "signed 32-bit µs counter" documentation describes an older/other implementation (or stale metadata). On AI 30.6.0 the host's counter is 64-bit; ESTIMER's "+2^32 on negative" policy is a **safety net, not a live necessity on AI 30.6.0** — it only has teeth if another host (e.g. PS's ScCore.dll, re-ps-sc's lane) computes a 32-bit wrap. **ESTIMER's facade is sign-convention-agnostic by design and covers both cases identically with zero code change:** the 64-bit-AI host (negative structurally impossible; +2^32 branch never fires) and a hypothetical 32-bit-signed host (wrap real; +2^32 branch live) are both handled by the same correct-delta policy. Note for readers: ESTIMER's `WRAP_PERIOD_US` (2^32) / `WRAP_POINT_US` (2^31) constants describe the **policy correction constants**, not the engine counter width — on AI 30.6.0 the counter is 64-bit (this file).

## 7. Comparison pair note (PS side) — CLOSED

re-ps-ext has confirmed PS 2026's ExtendScript.dll is byte-for-byte the same `$`-dispatcher shape (case 0x15 → `ScCore::Thread::getHiResTimer()` → `setDouble`, zero arithmetic) and imports the same dual `Thread::`/`Time::` symbols. **re-ps-sc's host RE of PS's ScCore.dll (ScCore 4.5.12.1 / engine 82.4, PE64) is now complete and converges with this file: QPC counter, int64 µs via double math, full 64-bit signed delta (`SUB RAX,qword [RBX+0xa0]` @ 0x180069ec0), negative read structurally impossible** — see `estimer/evidence/re-ps-sccore.md`. One behavioral difference: PS zero-inits `Context+0xa0` (first read = raw µs-since-boot, positive) whereas AI primes it at init (first read ≈ 0 / engine-startup); both positive, matching live probes. **Cross-host closure: neither AI nor PS can produce a negative hiresTimer read — ESTIMER's +2^32 'correct' branch is a confirmed never-firing safety net on both hosts.**

## 8. Confidence & limitations

- Counter (QPC + double µs + int64 cast), delta width (64-bit SUB), storage (Context+0xa0, TLS), and both priming sites: **high confidence** — decompiler C, instruction-level dump, and in-file constant values all agree.
- `DAT_1800c44a8` (cached Context pointer) is read-but-never-written in the analyzed functions; `Context::get()`'s own cache `DAT_1800c4760` is used instead. The `DAT_1800c44a8` check is a fast-path that is effectively always taken. No impact on the verdict.
- Timebox honored: counter + delta path (the priority) fully covered. First-read verified at all three sites. Not pursued: deeper dump of the remaining `FUN_18001cf80` one-time-init sub-system calls (unrelated to the timer).
- No live probing performed (static RE only); live behavior on AI 30.6.0 is evidence's lane (already: 0 negatives in 10k reads, positive at 52.7 min — consistent with this analysis).
- `getTicks` wrap-compensation constant `0x51eb85` ≈ 2^32/800 is a *different* timer; included for completeness only.

## 9. Artifacts

- `ghidra-projects\ai-sccore\out\inv\` — full inventory: `exports.tsv`, `imports.tsv`, `strings.tsv`, `function-inventory.tsv`, `program.txt`
- `ghidra-projects\ai-sccore\out\sccore-timer.txt` — export thunks, counter-import xrefs, 51-function decompilation set (incl. both getHiResTimer impls, init, Thread ctor, Context::get, getTicks, getUTCTime)
- `ghidra-projects\ai-sccore\out\sccore-timer2.txt` — constant dumps (µs multipliers 1000000.0 / 1000.0 / 60000.0), Thread ctor + go + delta impl decompiled
- `ghidra-projects\ai-sccore\out\sccore-timer3.txt` — instruction-level dump of the delta (`SUB RAX,qword ptr [RBX+0xa0]`), Context ctor zero-init
- Project: `ghidra-projects\ai-sccore\ai-sccore.rep` (persistent, reusable with `-process`)
