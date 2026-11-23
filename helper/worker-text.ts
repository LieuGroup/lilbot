/** Engine-neutral text cleaning and path helpers shared by helper binary probes and worker drivers. */
import { homedir } from 'node:os'
import { join } from 'node:path'

export const expandWorkerCwd = (raw: string) => (raw === '~' ? homedir() : raw.startsWith('~/') ? join(homedir(), raw.slice(2)) : raw)

export const cleanAgentText = (text: string, max: number, secret?: string) => {
  let out = secret ? text.replaceAll(secret, '[redacted]') : text
  // biome-ignore lint/suspicious/noControlCharactersInRegex: strip C0/C1 controls (except tab/newline) and Unicode format chars from untrusted agent output
  out = out.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\p{Cf}]/gu, '')
  if (secret) while (out.includes(secret)) out = out.replaceAll(secret, '[redacted]')
  if (out.length <= max) return out
  return max > 14 ? `${out.slice(0, max - 14)} [truncated]` : out.slice(0, max)
}

/** Single-line variant of `cleanAgentText` that strips every control and format character before redacting. */
export const cleanAgentLine = (text: string, max: number, secret?: string) => {
  let out = secret ? text.replaceAll(secret, '[redacted]') : text
  out = out.replace(/[\p{Cc}\p{Cf}]/gu, '')
  if (secret) while (out.includes(secret)) out = out.replaceAll(secret, '[redacted]')
  out = out.trim()
  if (out.length <= max) return out
  return max > 14 ? `${out.slice(0, max - 14)} [truncated]` : out.slice(0, max)
}
