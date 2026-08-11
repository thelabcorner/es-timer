// ExtendScript (ES3) globals referenced by ESTIMER.
declare var $: {
  version: string;
  hiresTimer: number;
  sleep(ms: number): void;
  global: any;
  evalFile(path: string, timeout?: number): any;
};

// Node lane: performance.now() (absolute monotonic ms, sub-µs precision).
// Absent in the engine — every access is typeof-guarded (see src/index.ts
// detectSource).
declare var performance: {
  now(): number;
};
