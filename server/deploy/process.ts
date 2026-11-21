import { spawn } from 'node:child_process'

/** Bounded commands, with no shell interpolation and no raw stderr (which can contain secrets). */
export async function command(args: string[], cwd?: string, timeout = 30_000, env?: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(args[0], args.slice(1), { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', data => {
      output = (output + data).slice(-1_000_000)
    })
    child.stderr.resume()
    const timer = setTimeout(() => child.kill('SIGKILL'), timeout)
    child.on('error', () => {
      clearTimeout(timer)
      reject(new Error(`${args[0]} could not start`))
    })
    child.on('close', code => {
      clearTimeout(timer)
      if (code === 0) resolve(output.trim())
      else reject(new Error(`${args.slice(0, 3).join(' ')} failed (${code ?? 'timeout'})`))
    })
  })
}
export const systemctl = (...args: string[]) => command(['systemctl', '--user', ...args])
export const git = (cwd: string, ...args: string[]) => command(['git', ...args], cwd)
export async function cleanHead(cwd: string) {
  if (await git(cwd, 'status', '--porcelain', '--untracked-files=all')) throw new Error('Deploy refuses a dirty checkout; commit or move your work first.')
  return git(cwd, 'rev-parse', 'HEAD')
}
