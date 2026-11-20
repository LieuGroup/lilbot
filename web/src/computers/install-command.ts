/** The address helpers connect to: LilBot's public helper door (docs/cloudflare.md). The browser
 *  is on another hostname, so the server does not tell it this one. */
const HELPER_ORIGIN = 'https://lilbot-connect.lilgroup.studio'

/** What to run on a machine without a screen. The code goes in on stdin, never in the process list. */
export const installCommand = (code: string) => `printf '%s' '${code}' | ./lilbot-helper install ${HELPER_ORIGIN}`
