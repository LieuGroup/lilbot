/** Gateway connections made in advance, one per recently opened bot, so opening that bot's chat
 *  again skips `hermes gateway attach` (about a second, the slowest step of opening a chat).
 *  A spare is attached to the bot's profile but holds no session until a chat takes it. */
import { HermesSocket } from './hermes-socket'

const LIMIT = 4
const IDLE_MS = 10 * 60_000

type Connect = (profile: string) => Promise<HermesSocket>
type Spare = { socket: Promise<HermesSocket | null>; timer: ReturnType<typeof setTimeout> }

const ignore = () => {}

export class SpareSockets {
  private spares = new Map<string, Spare>()

  constructor(
    private connect: Connect = profile => HermesSocket.connect(profile, ignore, ignore),
    private limit = LIMIT,
    private idleMs = IDLE_MS
  ) {}

  /** The profile's spare when one is ready and still open; otherwise null (never waits for one). */
  async take(profile: string): Promise<HermesSocket | null> {
    const spare = this.spares.get(profile)
    if (!spare) return null
    const socket = await Promise.race([spare.socket, Promise.resolve(null)])
    if (!socket) return null
    this.forget(profile, spare)
    return socket.isOpen ? socket : null
  }

  /** Makes a spare for the profile in the background, unless it has one. The least recently
   *  refilled profile gives its spare up when there are too many. */
  refill(profile: string) {
    const existing = this.spares.get(profile)
    if (existing) {
      // Most recently used goes last.
      this.spares.delete(profile)
      this.spares.set(profile, existing)
      return
    }
    const socket = this.connect(profile).then(
      made => {
        // `drop` closes a spare that is given up while it connects.
        made.rebind(ignore, () => this.forget(profile, spare))
        return made
      },
      () => {
        // Opening the chat attaches as usual; only the head start is lost.
        console.error('[hermes] could not prepare a spare connection')
        this.forget(profile, spare)
        return null
      }
    )
    const spare: Spare = { socket, timer: setTimeout(() => this.drop(profile), this.idleMs) }
    spare.timer.unref?.()
    this.spares.set(profile, spare)
    while (this.spares.size > this.limit) this.drop(this.spares.keys().next().value!)
  }

  /** Closes the profile's spare, for example before the profile is deleted. */
  drop(profile: string) {
    const spare = this.spares.get(profile)
    if (!spare) return
    this.forget(profile, spare)
    void spare.socket.then(socket => socket?.close())
  }

  close() {
    for (const profile of [...this.spares.keys()]) this.drop(profile)
  }

  private forget(profile: string, spare: Spare) {
    if (this.spares.get(profile) !== spare) return
    clearTimeout(spare.timer)
    this.spares.delete(profile)
  }
}
