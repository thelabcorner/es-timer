
// ===== __security_init_cookie @ 180070b0c — xref->import:QueryPerformanceCounter =====

/* Library Function - Single Match
    __security_init_cookie
   
   Libraries: Visual Studio 2017 Release, Visual Studio 2019 Release */

void __cdecl __security_init_cookie(void)

{
  DWORD DVar1;
  _FILETIME local_res8;
  LARGE_INTEGER local_res10;
  _FILETIME local_18 [2];
  
  if (DAT_1800ac080 == 0x2b992ddfa232) {
    local_res8.dwLowDateTime = 0;
    local_res8.dwHighDateTime = 0;
    GetSystemTimeAsFileTime(&local_res8);
    local_18[0] = local_res8;
    DVar1 = GetCurrentThreadId();
    local_18[0] = (_FILETIME)((ulonglong)local_18[0] ^ (ulonglong)DVar1);
    DVar1 = GetCurrentProcessId();
    local_18[0] = (_FILETIME)((ulonglong)local_18[0] ^ (ulonglong)DVar1);
    QueryPerformanceCounter(&local_res10);
    DAT_1800ac080 =
         ((ulonglong)local_res10.s.LowPart << 0x20 ^
          CONCAT44(local_res10.s.HighPart,local_res10.s.LowPart) ^ (ulonglong)local_18[0] ^
         (ulonglong)local_18) & 0xffffffffffff;
    if (DAT_1800ac080 == 0x2b992ddfa232) {
      DAT_1800ac080 = 0x2b992ddfa233;
    }
  }
  DAT_1800ac0c0 = ~DAT_1800ac080;
  return;
}



// ===== entry @ 1800704a0 — caller-of:__security_init_cookie =====

void entry(Callback *param_1,int param_2,Engine *param_3)

{
  if (param_2 == 1) {
    __security_init_cookie();
  }
  FUN_180070378(param_1,param_2,param_3);
  return;
}


