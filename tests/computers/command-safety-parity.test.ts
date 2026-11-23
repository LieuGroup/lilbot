/**
 * Static parity suite against the baseline hardline command corpus (no engine dependency).
 *
 * Deliberate improvements over the engine's original rules (tested in command-safety-parser/rules):
 * - `kill -1 <pid>` is allowed as SIGHUP; only real kill-all forms (`kill -9 -1`, `kill -- -1`, bare `kill -1`) are refused.
 * - Heredoc bodies (`<<`, `<<-`) are treated as data unless fed to a shell or containing unquoted `$(...)`.
 * - The 4,096-char separator-free limit is removed (128 KiB total size, 25,000 separators, and depth 8 remain).
 * - `rm -rf '/ *'` (literal filename ` *` under `/`) is allowed.
 * - Non-system local script paths (`./bin/reboot`, `./scripts/shutdown`) are not matched by basename.
 * - Unparseable commands with no destructive rule token (such as `grep 'unterminated`) are allowed so odd quoting
 *   never blocks harmless work; unparseable commands carrying a destructive token stay refused.
 */
import { expect, test } from 'bun:test'
import { checkCommandSafety } from '../../server/computers/command-safety'
import parity from './command-safety-parity.json'

const DELIBERATE_ALLOW = new Set(["grep 'unterminated"])

test('matches static hardline parity corpus (blocked)', () => {
  for (const cmd of parity.block) {
    if (DELIBERATE_ALLOW.has(cmd)) expect(checkCommandSafety(cmd), `deliberately allowed: ${cmd}`).toBeNull()
    else expect(checkCommandSafety(cmd), `expected blocked: ${cmd}`).not.toBeNull()
  }
})

test('matches static hardline parity corpus (allowed)', () => {
  for (const cmd of parity.allow) {
    expect(checkCommandSafety(cmd), `expected allowed: ${cmd}`).toBeNull()
  }
})
