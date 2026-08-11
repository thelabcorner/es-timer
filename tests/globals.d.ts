// Test-harness globals (Node side; not part of the library).
declare var console: {
  log(...args: any[]): void;
  error(...args: any[]): void;
};

interface Math {
  imul(x: number, y: number): number;
}

// Node timers used for the sleep-accuracy lane and the benchmark protocol.
declare function setTimeout(cb: () => void, ms: number): any;
declare function clearTimeout(handle: any): void;

// Node high-resolution wall clock used as the real-timer source in Node.
interface PerformanceLike {
  now(): number;
}
declare var performance: PerformanceLike;
