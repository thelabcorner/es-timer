// ESTIMER stats — pure sample statistics, no timer dependency. Mirrors the
// esarr/esstr bench conventions exactly: upper-median (sorted[floor(n/2)])
// and percentile = sorted[floor(n * p)] clamped to the last index — the same
// indexing the house harnesses use (esarr/src/index.ts item(): median =
// sorted[Math.floor(len/2)], p95 = sorted[Math.min(len-1, floor(len*0.95))]).
import { SampleSet, Stats } from './types';

export function medianOf(values: number[]): number {
  if (!values || values.length === 0) {
    return 0;
  }
  var sorted = values.slice(0);
  sorted.sort(function (a: number, b: number): number { return a - b; });
  return sorted[Math.floor(sorted.length / 2)];
}

export function minOf(values: number[]): number {
  if (!values || values.length === 0) {
    return 0;
  }
  var m = values[0];
  var i = 0;
  for (i = 1; i < values.length; i++) {
    if (values[i] < m) {
      m = values[i];
    }
  }
  return m;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

function rejectedCount(samples: SampleSet | number[]): number {
  var s = samples as SampleSet;
  if (s && s.rejected && s.rejected.length) {
    return s.rejected.length;
  }
  return 0;
}

// stats(samples) -> { count, min, max, mean, median, p95, p99, rejected }.
// Edge cases (design doc §7): n = 0 -> every metric is 0 (rejected count
// preserved); n = 1 -> every metric is that single value. `rejected` is the
// number of samples() rejections carried on the array when collectRejected
// was set; a plain number[] input always reports 0.
export function stats(samples: SampleSet | number[]): Stats {
  var arr = samples || [];
  var n = arr.length;
  if (n === 0) {
    return { count: 0, min: 0, max: 0, mean: 0, median: 0, p95: 0, p99: 0, rejected: rejectedCount(samples) };
  }
  var sorted = arr.slice(0);
  sorted.sort(function (a: number, b: number): number { return a - b; });
  var sum = 0;
  var i = 0;
  for (i = 0; i < n; i++) {
    sum += sorted[i];
  }
  return {
    count: n,
    min: sorted[0],
    max: sorted[n - 1],
    mean: sum / n,
    median: sorted[Math.floor(n / 2)],
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    rejected: rejectedCount(samples)
  };
}
