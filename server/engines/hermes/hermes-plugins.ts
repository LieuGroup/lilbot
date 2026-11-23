/** Configures one of LilBot's profile plug-ins and, when asked, enables it and loads it into the profile's
 *  running gateway. Hermes admits plug-in changes under one install lock that looks at every profile and
 *  answers "retry" when any profile's plug-in configuration changed meanwhile. So these changes take turns
 *  across bots, and a refused one is repeated. Other `config set` calls stay parallel across profiles. */
import { HermesSocket } from './hermes-socket'

const profileArgs = (id: string) => (id === 'default' ? [] : ['-p', id])
const ATTEMPTS = 3
const PAUSE_MS = 1_500

let turn: Promise<unknown> = Promise.resolve()

/** Runs one `hermes` CLI command for the profile; a failed exit throws with the start of its error output. */
export async function hermesCli(id: string, args: string[]): Promise<void> {
  const child = Bun.spawn([process.env.LILBOT_HERMES_BIN ?? 'hermes', ...profileArgs(id), ...args], { env: process.env, stdout: 'ignore', stderr: 'pipe' })
  const error = await new Response(child.stderr).text()
  if ((await child.exited) !== 0) throw new Error(`hermes ${args.slice(0, 2).join(' ')} failed: ${error.slice(0, 200)}`)
}

/** Enables the plug-in in the profile and loads it into the running gateway. */
async function load(socket: HermesSocket, plugin: string) {
  const toggle = (enable: boolean) => socket.request('plugins.manage', { action: 'toggle', name: plugin, enable })
  let result = await toggle(true)
  if (result.unchanged) {
    // Already enabled: the gateway may hold older plug-in code, so off and on again makes it load what was just copied in.
    await toggle(false)
    result = await toggle(true)
  }
  if (!result.ok) throw new Error(`Plugin ${plugin} activation failed`)
}

/** Sets the plug-in's config keys and, with `activate`, enables and loads it. Only the admission itself takes a turn. */
export async function configurePlugin(id: string, plugin: string, values: Record<string, string>, activate: boolean): Promise<void> {
  for (const [key, value] of Object.entries(values)) await hermesCli(id, ['config', 'set', key, value])
  if (!activate) return
  const socket = await HermesSocket.connect(id === 'default' ? '' : id)
  const run = turn
    .catch(() => {})
    .then(async () => {
      for (let attempt = 1; ; attempt++) {
        try {
          return await load(socket, plugin)
        } catch (error) {
          if (attempt >= ATTEMPTS) throw error
          await Bun.sleep(PAUSE_MS * attempt)
        }
      }
    })
  turn = run
  try {
    await run
  } finally {
    socket.close()
  }
}

type PluginSocket = { request(method: string, params?: Record<string, unknown>): Promise<{ ok?: boolean }>; close(): void }

/** Disables and removes a retired user plug-in through Hermes' own `plugins.manage` RPC, serialized on the shared install lock. */
export async function removePlugin(
  id: string,
  plugin: string,
  connect: (profile: string) => Promise<PluginSocket> = profile => HermesSocket.connect(profile),
  pauseMs = PAUSE_MS
): Promise<void> {
  const socket = await connect(id === 'default' ? '' : id)
  const run = turn
    .catch(() => {})
    .then(async () => {
      for (let attempt = 1; ; attempt++) {
        try {
          await socket.request('plugins.manage', { action: 'toggle', name: plugin, enable: false }).catch(() => {})
          const removed = await socket.request('plugins.manage', { action: 'remove', name: plugin })
          if (!removed.ok) throw new Error(`Plugin ${plugin} removal failed`)
          return
        } catch (error) {
          if (attempt >= ATTEMPTS) throw error
          await Bun.sleep(pauseMs * attempt)
        }
      }
    })
  turn = run
  try {
    await run
  } finally {
    socket.close()
  }
}
