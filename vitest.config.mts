import { cpus } from "node:os";
import { defineConfig } from "vitest/config";

// Root cause (investigated while stabilizing Issue #33's test suite): with
// Vitest's default worker count (one per CPU core), several test files'
// first cold import of a real, non-trivial dependency graph can compete for
// CPU at the same time and occasionally exceed the 5s per-test timeout —
// not because of any bug in application or test code, but because that many
// concurrent workers leave each one too little CPU headroom to finish a
// one-time transform in time. Confirmed by reproducing the failure at full
// default concurrency, then finding it disappears reliably (across many
// runs) once concurrent workers are capped below the core count, while
// still running multiple test files in parallel — this is not the same as
// --no-file-parallelism, which serializes everything. A quarter of the
// available cores (minimum 2, so real parallelism is always preserved)
// reproduced zero failures across many runs on an 8-core machine, versus
// frequent failures at the default (one worker per core).
const maxWorkers = Math.max(2, Math.floor(cpus().length / 4));

export default defineConfig({
  test: {
    maxWorkers,
  },
});
