/** Reads the one-time install code from a hidden TTY prompt or from piped stdin.
 *  Never echoes, logs, or includes user input in error messages. */
import { readSync } from 'node:fs'
import { INSTALL_CODE } from './settings'

const MAX_CODE_BYTES = 4096
const MAX_ATTEMPTS = 3

export const INVALID_CODE_MESSAGE = 'That does not look like a one-time code. Paste only the code from LilBot (not the whole command).'
export const NO_CODE_MESSAGE = 'No valid one-time code was entered. Get a fresh code in LilBot and run the command again.'

/** Fixed, non-secret message that `helper/main.ts` may show to the user. */
export class HelperUserError extends Error {}

export function parseInstallCode(raw: string): string | null {
  // Strip terminal bracketed-paste wrappers if the user's terminal sent them.
  const cleaned = raw.replaceAll('\x1b[200~', '').replaceAll('\x1b[201~', '').trim()
  return INSTALL_CODE.test(cleaned) ? cleaned : null
}

function readHiddenTtyLine(prompt: string, write: (text: string) => void): string | null {
  const stdin = process.stdin as NodeJS.ReadStream & { setRawMode?: (mode: boolean) => void }
  if (typeof stdin.setRawMode !== 'function') throw new HelperUserError('Could not hide terminal input. Pipe the one-time code on stdin instead.')
  const restore = () => {
    try {
      stdin.setRawMode?.(false)
    } catch {}
  }
  const onSignal = (code: number) => () => {
    restore()
    write('\n')
    process.exit(code)
  }
  const onSigint = onSignal(130)
  const onSigterm = onSignal(143)
  process.once('SIGINT', onSigint)
  process.once('SIGTERM', onSigterm)
  // Turn off echo before writing the prompt so fast pastes cannot echo.
  stdin.setRawMode(true)
  try {
    write(prompt)
    const chunks: number[] = []
    const buf = Buffer.alloc(1)
    let eof = false
    while (true) {
      let read = 0
      try {
        read = readSync(0, buf, 0, 1, null)
      } catch (error) {
        if ((error as { code?: string }).code === 'EAGAIN') continue
        throw error
      }
      if (read === 0) {
        eof = chunks.length === 0
        break
      }
      const byte = buf[0]
      if (byte === 0x03) {
        restore()
        write('\n')
        process.exit(130)
      }
      if (byte === 0x04) {
        eof = chunks.length === 0
        break
      }
      if (byte === 0x0a || byte === 0x0d) break
      if (byte === 0x7f || byte === 0x08) {
        chunks.pop()
        continue
      }
      if (chunks.length < MAX_CODE_BYTES) chunks.push(byte)
    }
    write('\n')
    return eof ? null : Buffer.from(chunks).toString('utf8')
  } finally {
    restore()
    process.off('SIGINT', onSigint)
    process.off('SIGTERM', onSigterm)
  }
}

export interface ReadCodePorts {
  isTTY?: boolean
  readPipe?: () => Promise<string>
  readTtyLine?: () => Promise<string | null> | string | null
  write?: (text: string) => void
}

const PROMPT = 'Paste only the one-time code from LilBot, then press Enter: '

export async function readInstallCode(ports: ReadCodePorts = {}): Promise<string> {
  const isTTY = ports.isTTY ?? Boolean(process.stdin.isTTY)
  const write = ports.write ?? (text => void process.stderr.write(text))
  if (!isTTY) {
    const raw = await (ports.readPipe ?? (() => Bun.stdin.text()))()
    const parsed = parseInstallCode(raw)
    if (!parsed) throw new HelperUserError(INVALID_CODE_MESSAGE)
    return parsed
  }
  const customRead = ports.readTtyLine
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (customRead) write(PROMPT)
    const line = customRead ? await customRead() : readHiddenTtyLine(PROMPT, write)
    if (line === null) break
    const parsed = parseInstallCode(line)
    if (parsed) return parsed
    write(`${INVALID_CODE_MESSAGE}\n`)
  }
  throw new HelperUserError(NO_CODE_MESSAGE)
}
