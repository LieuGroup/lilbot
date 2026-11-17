/** `bun run t3:sign-in`: signs LilBot in to T3 Code with a one-time pairing code Oscar created.
 *  The code is read from stdin or `--code-file <path>`, never from the command line. Prints only
 *  the outcome and the expiry date; the access token goes straight to the data folder (mode 0600).
 *
 *  Options: `--code-file <path>`, `--label <name>` (shown in T3 under Sharing & access, default
 *  "LilBot"). Environment: `LILBOT_DATA_DIR`, `LILBOT_T3_MCP_URL`. */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { T3_DEFAULT_MCP_URL } from './t3-connection'
import { T3Grants } from './t3-grant'
import { signInToT3 } from './t3-sign-in'

const argument = (name: string) => {
  const index = process.argv.indexOf(name)
  return index > 0 ? process.argv[index + 1] : undefined
}

const dataDir = process.env.LILBOT_DATA_DIR ?? join(homedir(), '.local', 'share', 'lilbot')
const codeFile = argument('--code-file')
if (!codeFile && process.stdin.isTTY) process.stdout.write('Pairing code from T3 Code (Sharing & access → Create link → Copy code): ')
const code = codeFile
  ? readFileSync(codeFile, 'utf8')
  : ((await (async () => {
      for await (const line of console) return line
    })()) ?? '')

try {
  const grant = await signInToT3({ mcpUrl: process.env.LILBOT_T3_MCP_URL ?? T3_DEFAULT_MCP_URL, code, label: argument('--label') ?? 'LilBot' })
  new T3Grants(join(dataDir, 't3-grant.json')).save(grant)
  console.log(`Signed in to T3 Code as "${grant.label}" with Full access until ${new Date(grant.expiresAt).toISOString().slice(0, 10)}.`)
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Sign-in failed.')
  process.exit(1)
}
