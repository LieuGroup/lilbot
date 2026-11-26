/** Text LilBot hard-codes for a bot calls its person "the owner", never by a personal name: guide topics, shipped
 *  skills, tool descriptions and answers, notices sent into a turn, error texts and record labels. Scans every string
 *  literal and template chunk in `server/` and protocol `shared/` (comments and identifiers are not text a bot reads),
 *  and every Markdown file under `server/`. */
import { expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'

const ROOT = join(import.meta.dir, '../..')
const NAME = /\bOscar\b/
/** "The owner" is the person only. These phrasings would use it for a bot (the one that did a work item). */
const OWNER_AS_BOT =
  /\b(?:its|item's|their|a bot's) owner\b|\bthe owner is you\b|\bsession of the owner\b|\bowner's (?:evidence|claim|folder|definition|commands|output|links|result|work item)\b|\bonly the owner reports\b|\bback to (?:its|the) owner\b/i

/** Files that may still hold the name, each with the reason. */
const ALLOWED: Record<string, string> = {
  // Owned by the base-prompt work (PR 321), which renames the person there.
  'server/prompts/base-prompt.ts': 'base prompt',
  'server/bots/system-note.ts': 'system note',
  'server/system/system-note-facts.ts': 'system note facts',
  // Screen-only: the roster shows "Waiting for you" for it; no bot reads it.
  'server/activity/activity-service.ts': 'screen-only activity text'
}
/** Earlier wording still present in stored conversations, kept only to recognise and strip it; never sent. */
const LEGACY = new Set(['[LilBot notice, not from Oscar: a run of your webhook'])

function files(folder: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(ROOT, folder))) {
    const path = join(folder, name)
    if (name === 'node_modules' || path === join('shared', 'client')) continue
    if (statSync(join(ROOT, path)).isDirectory()) files(path, out)
    else if (/\.(ts|md)$/.test(name)) out.push(path)
  }
  return out
}

function literals(code: string): string[] {
  const source = ts.createSourceFile('scan.ts', code, ts.ScriptTarget.Latest, true)
  const found: string[] = []
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node)) found.push(node.text)
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

/** Every piece of text a bot can read: Markdown lines and string literals, outside the allowed files. */
function botText(): { where: string; text: string }[] {
  const found: { where: string; text: string }[] = []
  for (const path of [...files('server'), ...files('shared')]) {
    const file = relative(ROOT, join(ROOT, path))
    if (ALLOWED[file]) continue
    if (file.endsWith('.md')) {
      for (const [i, line] of readFileSync(join(ROOT, file), 'utf8').split('\n').entries()) if (NAME.test(line)) hits.push(`${file}:${i + 1}: ${line.trim().slice(0, 120)}`)
      continue
    }
    for (const text of literals(readFileSync(join(ROOT, file), 'utf8'))) if (!LEGACY.has(text)) found.push({ where: file, text })
  }
  return found
}

test('no personal name in text LilBot sends to a bot', () => {
  const hits = botText().filter(({ text }) => NAME.test(text))
  expect(hits.map(({ where, text }) => `${where}: ${text.trim().slice(0, 120)}`)).toEqual([])
})

test('"the owner" means the person, never the bot that did the work', () => {
  const hits = botText().filter(({ text }) => OWNER_AS_BOT.test(text))
  expect(hits.map(({ where, text }) => `${where}: ${text.trim().slice(0, 120)}`)).toEqual([])
  for (const old of ['goes back to its owner once', 'the owner is you', 'a fresh session of the owner', "The owner's evidence", 'only the owner reports'])
    expect(OWNER_AS_BOT.test(old)).toBe(true)
  for (const fine of ['Tell the owner briefly', "the owner's words", "the owner's answer", "the owner's board"]) expect(OWNER_AS_BOT.test(fine)).toBe(false)
})

test('the scan finds the name in strings and templates, not in comments or identifiers', () => {
  const code = `// Oscar\nconst needsOscar = 'needs_oscar'\nconst a = 'Ask Oscar'\nconst b = \`$\{a} told Oscar\``
  expect(literals(code).filter(text => NAME.test(text))).toEqual(['Ask Oscar', ' told Oscar'])
})
