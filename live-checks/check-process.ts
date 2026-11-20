export function startServer(env: Record<string, string | undefined>) {
  return Bun.spawn(['bun', 'server/main.ts'], { env, stdout: 'ignore', stderr: 'inherit' })
}

export function deleteProfile(id: string, stderr: 'pipe' | 'ignore' | 'inherit' = 'inherit') {
  return Bun.spawn([process.env.LILBOT_HERMES_BIN ?? 'hermes', 'profile', 'delete', id, '-y'], {
    env: process.env,
    stdout: 'ignore',
    stderr
  })
}
