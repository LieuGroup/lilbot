/** CPU milliseconds this process has used so far. A busy machine delays synchronous work (wall time) but does not make it
 *  execute more, so a speed bound on such work is measured here: a quadratic rule still costs seconds of CPU, and a
 *  rule that is only slow because other processes are running does not fail. */
export function cpuNow() {
  const { user, system } = process.cpuUsage()
  return (user + system) / 1000
}

/** CPU milliseconds `work` uses. */
export function cpuMs(work: () => void) {
  const start = cpuNow()
  work()
  return cpuNow() - start
}
