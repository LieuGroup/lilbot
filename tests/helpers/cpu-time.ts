/** Thread CPU milliseconds when supported (64-bit Linux/macOS `CLOCK_THREAD_CPUTIME_ID`), falling back to process CPU time.
 *  A busy machine delays wall time, and process-wide `process.cpuUsage()` sums concurrent JIT/GC/worker threads onto the
 *  test thread. Measuring only the calling thread keeps speed bounds stable under parallel test runs while still catching
 *  quadratic regressions immediately. */
import { dlopen, FFIType, ptr } from 'bun:ffi'

const threadClock = (() => {
  if (process.arch !== 'x64' && process.arch !== 'arm64') return null
  const clockId = process.platform === 'linux' ? 3 : process.platform === 'darwin' ? 16 : null
  const libName = process.platform === 'linux' ? 'libc.so.6' : process.platform === 'darwin' ? 'libSystem.B.dylib' : null
  if (clockId === null || !libName) return null
  try {
    const lib = dlopen(libName, { clock_gettime: { args: [FFIType.i32, FFIType.ptr], returns: FFIType.i32 } })
    const buf = new BigInt64Array(2)
    const read = () => {
      if (lib.symbols.clock_gettime(clockId, ptr(buf)) !== 0) throw new Error('clock_gettime failed')
      return Number(buf[0]) * 1000 + Number(buf[1]) / 1e6
    }
    const sample = read()
    return Number.isFinite(sample) && sample >= 0 ? read : null
  } catch {
    return null
  }
})()

export function cpuNow(): number {
  if (threadClock) return threadClock()
  const { user, system } = process.cpuUsage()
  return (user + system) / 1000
}

/** CPU milliseconds `work` uses on this thread. */
export function cpuMs(work: () => void): number {
  const start = cpuNow()
  work()
  return cpuNow() - start
}

/** Minimum thread CPU milliseconds across up to `runs` calls. Noise can only add time, so taking the minimum filters
 *  one-off main-thread GC or JIT spikes. Stops early once under `budgetMs` (zero extra work when fast) or far above
 *  it (`> budgetMs * 5`, so a multi-second quadratic regression fails immediately). */
export function bestCpuMs(work: () => void, budgetMs: number, runs = 3): number {
  let best = Number.POSITIVE_INFINITY
  for (let i = 0; i < runs; i++) {
    const elapsed = cpuMs(work)
    if (elapsed < best) best = elapsed
    if (best < budgetMs || (i === 0 && elapsed > budgetMs * 5)) break
  }
  return best
}

/** Returns the 4x-input scaling ratio (large / small) when `largeMs` is above the noise floor (`floorMs`), or null.
 *  A linear rule scales ~4x from 64 KiB to 256 KiB; a quadratic rule scales ~16x. */
export function scalingRatio(smallWork: () => void, largeWork: () => void, largeMs: number, floorMs = 8, runs = 3): number | null {
  if (largeMs < floorMs) return null
  let small = Number.POSITIVE_INFINITY
  for (let i = 0; i < runs; i++) small = Math.min(small, cpuMs(smallWork))
  let large = largeMs
  for (let i = 1; i < runs; i++) large = Math.min(large, cpuMs(largeWork))
  return large / Math.max(small, 0.5)
}
