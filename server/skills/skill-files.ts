import { createHash } from 'node:crypto'
import { lstatSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { LilBotError } from '../../shared/lilbot-error'

const SAFE_PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
// biome-ignore lint/suspicious/noControlCharactersInRegex: reject control, newline, and invisible/bidi characters in paths
const UNSAFE_PATH_CHARS = /[\u0000-\u001f\u007f\u061c\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u

/** Strict printable relative path allow-list for skill supporting-file writes. */
export function safeSkillFilePath(file: string): boolean {
  if (!file || file.length > 300 || file.includes('\\')) return false
  return file.split('/').every(segment => SAFE_PATH_SEGMENT.test(segment))
}

/** Safe relative path for reading an existing skill file (no traversal, hidden segments, control, newline, or invisible/bidi chars). */
export function safeSkillReadPath(file: string): boolean {
  if (!file || file.length > 300 || file.includes('\\') || UNSAFE_PATH_CHARS.test(file)) return false
  return !file.split('/').some(segment => !segment || segment === '.' || segment === '..' || segment.startsWith('.'))
}

/** Whether `root` holds only the exact relative paths in `expected` (no extra files, dotfiles, binaries, symlinks, or empty dirs). */
export function hasExactFiles(root: string, expected: ReadonlySet<string>): boolean {
  const seen = new Set<string>()
  function walk(dir: string, prefix: string): boolean {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isSymbolicLink() || lstatSync(full).isSymbolicLink()) return false
      const rel = prefix + entry.name
      if (entry.isDirectory()) {
        const sub = `${rel}/`
        if (![...expected].some(path => path.startsWith(sub)) || !walk(full, sub)) return false
      } else {
        if (!expected.has(rel)) return false
        seen.add(rel)
      }
    }
    return true
  }
  return walk(root, '') && seen.size === expected.size
}

/** Removes any file, symlink, dotfile, or directory under `root` not belonging to `expected` (never following symlinks). */
export function pruneUnexpectedFiles(root: string, expected: ReadonlySet<string>) {
  const dirs = new Set<string>()
  for (const rel of expected) {
    const parts = rel.split('/')
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'))
  }
  function walk(dir: string, prefix: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      const rel = prefix + entry.name
      if (entry.isSymbolicLink() || lstatSync(full).isSymbolicLink()) {
        rmSync(full, { force: true })
        continue
      }
      if (entry.isDirectory()) {
        if (!dirs.has(rel)) rmSync(full, { recursive: true, force: true })
        else walk(full, `${rel}/`)
      } else if (!expected.has(rel)) {
        rmSync(full, { force: true })
      }
    }
  }
  walk(root, '')
}

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
