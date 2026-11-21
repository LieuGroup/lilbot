import { createHash } from 'node:crypto'
import { lstatSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { LilBotError } from '../../shared/protocol'

export function safeText(text: string) {
  if (
    // biome-ignore lint/suspicious/noControlCharactersInRegex: reject hidden control characters
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u.test(text) ||
    /-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:sk|pk|rk)-[A-Za-z0-9_-]{20,}|\bAKIA[0-9A-Z]{16}\b|\bgh[pousr]_[A-Za-z0-9]{30,}|\bxox[abprs]-[A-Za-z0-9-]{10,}|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.|\b(?:password|secret|api[_ -]?key|token)\s*(?:is|=|:)\s*\S{6,}/i.test(
      text
    )
  )
    throw new LilBotError('unsafe_skill', 'Skills cannot contain secrets or hidden characters.')
}
export function files(root: string, prefix = ''): Record<string, string> {
  const result: Record<string, string> = {}
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isSymbolicLink() || lstatSync(path).isSymbolicLink()) throw new LilBotError('unsafe_skill', 'Skill symlinks are not supported.')
    if (entry.name.startsWith('.')) continue
    const key = prefix + entry.name
    if (entry.isDirectory()) Object.assign(result, files(path, `${key}/`))
    else {
      const bytes = readFileSync(path)
      const text = bytes.toString('utf8')
      if (!Buffer.from(text).equals(bytes)) continue // Binary support assets are copied unchanged by the importer.
      result[key] = text
    }
  }
  return result
}
export const digest = (data: Record<string, string>) =>
  createHash('sha256')
    .update(JSON.stringify(Object.entries(data).sort()))
    .digest('hex')
export function metadata(text: string) {
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1]
  const field = (key: string) => {
    const value = new RegExp(`^${key}:[ \\t]*(.*)$`, 'm').exec(front ?? '')?.[1]?.trim()
    const quote = value?.[0]
    return value && (quote === '"' || quote === "'") && value.length > 1 && value.endsWith(quote) ? value.slice(1, -1).trim() : value
  }
  const name = field('name')
  const description = field('description')
  if (!front || !name || !description) throw new LilBotError('invalid_skill', 'SKILL.md needs name and description frontmatter.')
  return { name, description }
}

/** Hash all bytes, including binary assets; reject redirects anywhere in an imported tree. */
export function treeDigest(root: string): string {
  const hash = createHash('sha256')
  function visit(path: string, prefix: string) {
    for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = join(path, entry.name)
      if (entry.isSymbolicLink()) throw new LilBotError('unsafe_skill', 'Skill symlinks are not supported.')
      const relative = prefix + entry.name
      if (entry.isDirectory()) visit(full, `${relative}/`)
      else {
        hash.update(relative)
        hash.update(readFileSync(full))
      }
    }
  }
  visit(root, '')
  return hash.digest('hex')
}
