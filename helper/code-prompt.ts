/** Reads the one-time install code from a hidden TTY prompt or from piped stdin.
 *  Never echoes, logs, or includes user input in error messages. */
import { INSTALL_CODE } from './settings'

const MAX_CODE_BYTES = 4096
const MAX_ATTEMPTS = 3
const BURST_QUIET_MS = 120
const PASTE_IDLE_MS = 1500
const PASTE_START = '\x1b[200~'
const PASTE_END = '\x1b[201~'
const PROMPT = 'Paste only the one-time code from LilBot, then press Enter: '

export const INVALID_CODE_MESSAGE = 'That does not look like a one-time code. Paste only the code from LilBot (not the whole command).'
export const NO_CODE_MESSAGE = 'No valid one-time code was entered. Get a fresh code in LilBot and run the command again.'

/** Fixed, non-secret message that `helper/main.ts` may show to the user. */
export class HelperUserError extends Error {}

export function parseInstallCode(raw: string): string | null {
  const cleaned = raw.replaceAll(PASTE_START, '').replaceAll(PASTE_END, '').trim()
  return INSTALL_CODE.test(cleaned) ? cleaned : null
}

type RawStdin = NodeJS.ReadStream & { setRawMode?: (mode: boolean) => void; unref?: () => void }
type AttemptHooks = { chunk: (data: Buffer) => void; end: () => void; error: (err: Error) => void; cancel: () => void }

const quiet = (fn: () => void) => {
  try {
    fn()
  } catch {}
}

/** Keeps raw mode and bracketed paste on across retries so multi-line pastes cannot echo or spill
 *  into the parent shell, and reads asynchronously so SIGINT/SIGTERM restore the terminal at once. */
async function withRawTty<T>(write: (text: string) => void, run: (readBurst: () => Promise<string | null>) => Promise<T>): Promise<T> {
  const stdin = process.stdin as RawStdin
  if (typeof stdin.setRawMode !== 'function') throw new HelperUserError('Could not hide terminal input. Pipe the one-time code on stdin instead.')
  let active: AttemptHooks | null = null
  let restored = false
  let ended = false
  let streamError: Error | null = null

  const onData = (data: Buffer | string) => active?.chunk(typeof data === 'string' ? Buffer.from(data, 'utf8') : data)
  const onEnd = () => {
    ended = true
    active?.end()
  }
  const onError = (err: Error) => {
    streamError = err
    active?.error(err)
  }
  const restore = () => {
    if (restored) return
    restored = true
    active?.cancel()
    active = null
    stdin.off('data', onData).off('end', onEnd).off('error', onError)
    process.off('SIGINT', onSigint).off('SIGTERM', onSigterm).off('SIGHUP', onSighup)
    quiet(() => write('\x1b[?2004l'))
    quiet(() => stdin.setRawMode?.(false))
    quiet(() => stdin.pause())
    quiet(() => stdin.unref?.())
  }
  const exitOnSignal = (code: number) => {
    restore()
    quiet(() => write('\n'))
    process.exit(code)
  }
  const onSigint = () => exitOnSignal(130)
  const onSigterm = () => exitOnSignal(143)
  const onSighup = () => exitOnSignal(129)

  const readBurst = (): Promise<string | null> => {
    if (streamError) return Promise.reject(streamError)
    if (ended) return Promise.resolve(null)
    return new Promise((resolve, reject) => {
      const chunks: number[] = []
      let overflow = false
      let inPaste = false
      let sawNewline = false
      let pendingEsc = ''
      let settled = false
      let timer: ReturnType<typeof setTimeout> | null = null

      const stopTimer = () => {
        if (timer) clearTimeout(timer)
        timer = null
      }
      const pushByte = (byte: number) => {
        if (chunks.length < MAX_CODE_BYTES) chunks.push(byte)
        else overflow = true
      }
      const settle = (fn: () => void) => {
        if (settled) return
        settled = true
        stopTimer()
        active = null
        fn()
      }
      const finish = (eof: boolean) =>
        settle(() => {
          for (const ch of pendingEsc) pushByte(ch.charCodeAt(0))
          pendingEsc = ''
          write('\n')
          resolve(eof ? null : overflow ? '' : Buffer.from(chunks).toString('utf8'))
        })
      const arm = (ms: number) => {
        stopTimer()
        timer = setTimeout(() => finish(false), ms)
      }
      const onByte = (byte: number) => {
        if (byte === 0x03) return exitOnSignal(130)
        if (pendingEsc || byte === 0x1b) {
          const next = pendingEsc + String.fromCharCode(byte)
          if (next === PASTE_START || next === PASTE_END) {
            pendingEsc = ''
            inPaste = next === PASTE_START
            if (sawNewline || overflow) arm(inPaste ? PASTE_IDLE_MS : BURST_QUIET_MS)
            return
          }
          if (PASTE_START.startsWith(next) || PASTE_END.startsWith(next)) {
            pendingEsc = next
            return
          }
          for (const ch of pendingEsc) pushByte(ch.charCodeAt(0))
          pendingEsc = ''
          if (byte === 0x1b) {
            pendingEsc = '\x1b'
            return
          }
        }
        if (byte === 0x04) {
          if (!inPaste && !sawNewline && !chunks.length && !overflow) return finish(true)
          if (!inPaste && !sawNewline) {
            sawNewline = true
            arm(BURST_QUIET_MS)
          }
          return
        }
        if (byte === 0x0a || byte === 0x0d) {
          sawNewline = true
          pushByte(0x0a)
          return arm(inPaste ? PASTE_IDLE_MS : BURST_QUIET_MS)
        }
        if ((byte === 0x7f || byte === 0x08) && !inPaste && !sawNewline && !overflow) return void chunks.pop()
        pushByte(byte)
        if (sawNewline || overflow) arm(inPaste ? PASTE_IDLE_MS : BURST_QUIET_MS)
      }

      active = {
        chunk: data => {
          for (const byte of data) if (!settled) onByte(byte)
        },
        end: () => finish(!chunks.length && !sawNewline && !overflow),
        error: err => settle(() => reject(err)),
        cancel: stopTimer
      }
    })
  }

  process.once('SIGINT', onSigint).once('SIGTERM', onSigterm).once('SIGHUP', onSighup)
  // Turn off echo before writing the prompt so fast pastes cannot echo.
  stdin.setRawMode(true)
  write('\x1b[?2004h')
  stdin.on('data', onData).on('end', onEnd).on('error', onError).resume()
  try {
    return await run(readBurst)
  } finally {
    restore()
  }
}

export interface ReadCodePorts {
  isTTY?: boolean
  readPipe?: () => Promise<string>
  readTtyLine?: () => Promise<string | null> | string | null
  write?: (text: string) => void
}

export async function readInstallCode(ports: ReadCodePorts = {}): Promise<string> {
  const isTTY = ports.isTTY ?? Boolean(process.stdin.isTTY)
  const write = ports.write ?? (text => void process.stderr.write(text))
  if (!isTTY) {
    const parsed = parseInstallCode(await (ports.readPipe ?? (() => Bun.stdin.text()))())
    if (!parsed) throw new HelperUserError(INVALID_CODE_MESSAGE)
    return parsed
  }
  const runAttempts = async (nextLine: () => Promise<string | null> | string | null) => {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      write(PROMPT)
      const line = await nextLine()
      if (line === null) break
      const parsed = parseInstallCode(line)
      if (parsed) return parsed
      write(`${INVALID_CODE_MESSAGE}\n`)
    }
    throw new HelperUserError(NO_CODE_MESSAGE)
  }
  return ports.readTtyLine ? runAttempts(ports.readTtyLine) : withRawTty(write, runAttempts)
}
