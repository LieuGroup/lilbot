/** The installer's window. macOS: native dialogs through osascript, script on stdin and answers on stdout, so a
 *  pasted line never reaches argv. Elsewhere: the terminal the helper was started from. */

export interface SetupWindow {
  /** The pasted line, or null when cancelled, timed out or closed by `close()`. */
  ask(message: string, seconds: number): Promise<string | null>
  show(message: string): Promise<void>
  close(): void
}
const quote = (text: string) => `"${text.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`

function macWindow(): SetupWindow {
  let open: ReturnType<typeof Bun.spawn> | undefined
  const run = async (script: string) => {
    const child = Bun.spawn(['/usr/bin/osascript', '-'], { stdin: 'pipe', stdout: 'pipe', stderr: 'ignore' })
    open = child
    child.stdin.write(script)
    child.stdin.end()
    const output = await new Response(child.stdout).text()
    const status = await child.exited
    if (open === child) open = undefined
    return status === 0 ? output.replace(/\n$/, '') : null
  }
  return {
    async ask(message, seconds) {
      const answer = await run(
        `activate\nset reply to display dialog ${quote(message)} default answer "" with title "LilBot helper" buttons {"Cancel", "Connect"} default button "Connect" cancel button "Cancel" giving up after ${Math.max(1, Math.floor(seconds))}\nif gave up of reply then error number -128\ntext returned of reply`
      )
      return answer
    },
    async show(message) {
      await run(`activate\ndisplay dialog ${quote(message)} with title "LilBot helper" buttons {"Done"} default button "Done" giving up after 120`)
    },
    close() {
      open?.kill()
    }
  }
}

function terminalWindow(): SetupWindow {
  let cancel: (() => void) | undefined
  const lines = console[Symbol.asyncIterator]()
  return {
    ask(message, seconds) {
      console.log(`${message}\n> `)
      return new Promise<string | null>(resolve => {
        const timer = setTimeout(() => resolve(null), seconds * 1000)
        cancel = () => {
          clearTimeout(timer)
          resolve(null)
        }
        // Opened without a terminal, stdin ends at once: keep waiting for the page until the attempt runs out.
        lines.next().then(
          next => {
            if (next.done) return
            clearTimeout(timer)
            resolve(next.value)
          },
          () => {}
        )
      })
    },
    async show(message) {
      console.log(message)
    },
    close() {
      cancel?.()
    }
  }
}

export const setupWindow = (): SetupWindow => (process.platform === 'darwin' ? macWindow() : terminalWindow())
