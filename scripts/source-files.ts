/** Tracked source files (`.ts`, `.tsx`, `.py`) and their line counts, shared by the size rule and the growth report. */
import { readFileSync } from 'node:fs'

export type SourceFile = { path: string; lines: number }

export async function trackedSourceFiles(cwd = process.cwd()): Promise<SourceFile[]> {
  const listed = Bun.spawnSync(['git', 'ls-files', '*.ts', '*.tsx', '*.py'], { cwd, stdout: 'pipe', stderr: 'inherit' })
  if (listed.exitCode !== 0) throw new Error('git ls-files failed')
  return listed.stdout
    .toString()
    .split('\n')
    .filter(Boolean)
    .map(path => ({ path, lines: readFileSync(`${cwd}/${path}`, 'utf8').split('\n').length - 1 }))
}
