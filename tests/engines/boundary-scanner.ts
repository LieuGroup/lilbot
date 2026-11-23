/** TypeScript AST-based import and engine-name scanner for boundary and structure tests.
 *  Accepted lexical limits: runtime variable assembly (`const a = 'her'; a + 'mes'`, `import(varPath)`),
 *  odd mixed case (`'HeRmEs'`), and non-JS/TS config or Markdown guide/skill files (`.json`, `.yaml`, `.py`, `.md`; left to review) are not scanned here. */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'
import ts from 'typescript'

export const ROOT = join(import.meta.dir, '../..')

/** Standard JS built-in objects whose own property names (`Math.PI`, `Object.is`, `Number.EPSILON`, etc.)
 *  are language primitives rather than engine names. */
const JS_BUILTIN_OBJECTS = new Set(
  'Math Number String Boolean Symbol BigInt Object Array Function Date RegExp Error Map Set WeakMap WeakSet Promise Proxy Reflect JSON Intl Atomics ArrayBuffer SharedArrayBuffer DataView URL URLSearchParams Uint8Array Int8Array Uint16Array Int16Array Uint32Array Int32Array Float32Array Float64Array BigInt64Array BigUint64Array'.split(
    ' '
  )
)

/** Exact display-label entry (`const <table> = { <key>: '<label>' }`) allowed to name an engine for UI display. */
interface DisplayLabelEntry {
  table: string
  key: string
  label: string
}

export interface NameScanAllowlist {
  labels?: readonly DisplayLabelEntry[]
  /** Exact trimmed literal/JSX/template-chunk copy strings (e.g. `(for example, Claude Code)`); never matches identifiers. */
  copy?: readonly string[]
}

function subdirsOf(folder: string): string[] {
  const dir = join(ROOT, folder)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(name => statSync(join(dir, name)).isDirectory())
    .sort()
}

export const concreteEngineIds = () => subdirsOf('server/engines')
export const concreteDriverIds = () => subdirsOf('helper/drivers')
export const allEngineAndDriverIds = () => [...new Set([...concreteEngineIds(), ...concreteDriverIds()])].sort()

export function sourceFiles(folder: string): string[] {
  const full = join(ROOT, folder)
  if (!existsSync(full)) return []
  return readdirSync(full).flatMap(name => {
    if (name === 'node_modules' || name === 'dist' || name === '.expo') return []
    const path = join(folder, name)
    if (statSync(join(ROOT, path)).isDirectory()) return sourceFiles(path)
    return /\.[cm]?[jt]sx?$/.test(name) ? [path] : []
  })
}

function parseSource(source: string, filePath: string): ts.SourceFile {
  const kind = filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : filePath.endsWith('.jsx') ? ts.ScriptKind.JSX : /\.[cm]?js$/.test(filePath) ? ts.ScriptKind.JS : ts.ScriptKind.TS
  return ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, kind)
}

/** Evaluates compile-time string expressions: literals, templates, `+` chains, `[...].join(...)`, and `.concat(...)`. */
function evalStaticString(node: ts.Node): string | null {
  if (ts.isStringLiteralLike(node)) return node.text
  if (ts.isParenthesizedExpression(node)) return evalStaticString(node.expression)
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = evalStaticString(node.left)
    const right = evalStaticString(node.right)
    return left !== null && right !== null ? left + right : null
  }
  if (ts.isTemplateExpression(node)) {
    let out = node.head.text
    for (const span of node.templateSpans) {
      const val = evalStaticString(span.expression)
      if (val === null) return null
      out += val + span.literal.text
    }
    return out
  }
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
    const method = node.expression.name.text
    if (method === 'join' && ts.isArrayLiteralExpression(node.expression.expression) && node.arguments.length <= 1) {
      const sep = node.arguments.length === 1 ? evalStaticString(node.arguments[0]) : ','
      if (sep === null) return null
      const parts: string[] = []
      for (const el of node.expression.expression.elements) {
        const val = evalStaticString(el)
        if (val === null) return null
        parts.push(val)
      }
      return parts.join(sep)
    }
    if (method === 'concat') {
      const head = evalStaticString(node.expression.expression)
      if (head === null) return null
      let out = head
      for (const arg of node.arguments) {
        const val = evalStaticString(arg)
        if (val === null) return null
        out += val
      }
      return out
    }
  }
  return null
}

/** Every relative module specifier imported, re-exported, required, or dynamically imported in `source`. */
export function relativeImportsInSource(source: string, filePath: string): string[] {
  const sf = parseSource(source, filePath)
  const specs: string[] = []
  const add = (spec: string | null) => {
    if (spec && (spec.startsWith('./') || spec.startsWith('../'))) specs.push(normalize(join(dirname(filePath), spec)))
  }
  const visit = (node: ts.Node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      add(evalStaticString(node.moduleSpecifier))
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      add(evalStaticString(node.argument.literal))
    } else if (ts.isCallExpression(node) && node.arguments.length >= 1) {
      const isDynImport = node.expression.kind === ts.SyntaxKind.ImportKeyword
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require'
      if (isDynImport || isRequire) add(evalStaticString(node.arguments[0]))
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return specs
}

export const importsOf = (file: string) => relativeImportsInSource(readFileSync(join(ROOT, file), 'utf8'), file)

/** Disallowed imports from `file` into `<baseDir>/<id>/`; only `allowed` registration points and the same folder may import it. */
export function forbiddenSubfolderImports(file: string, targets: readonly string[], baseDir: string, ids: readonly string[], allowed: string | readonly string[]): string[] {
  if (Array.isArray(allowed) ? allowed.includes(file) : file === allowed) return []
  const ownId = ids.find(id => file.startsWith(`${baseDir}/${id}/`))
  return targets.filter(target => ids.some(id => id !== ownId && (target === `${baseDir}/${id}` || target.startsWith(`${baseDir}/${id}/`)))).map(target => `${file} -> ${target}`)
}

function tokenizeWords(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

function hasWordSequence(words: string[], target: string[]): boolean {
  if (!target.length || words.length < target.length) return false
  for (let i = 0; i <= words.length - target.length; i++) {
    let ok = true
    for (let j = 0; j < target.length; j++)
      if (words[i + j] !== target[j]) {
        ok = false
        break
      }
    if (ok) return true
  }
  return false
}

function isAllowedDisplayEntry(node: ts.Node, allowed: readonly DisplayLabelEntry[]): boolean {
  if (!allowed.length || !ts.isPropertyAssignment(node) || !ts.isStringLiteralLike(node.initializer)) return false
  const label = node.initializer.text
  const key = ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name) ? node.name.text : null
  if (!key) return false
  const obj = node.parent
  const decl = obj && ts.isObjectLiteralExpression(obj) ? obj.parent : null
  const table = decl && ts.isVariableDeclaration(decl) && ts.isIdentifier(decl.name) ? decl.name.text : null
  return !!table && allowed.some(entry => entry.table === table && entry.key === key && entry.label === label)
}

/** Returns engine/driver ids appearing as whole tokens in code (identifiers, strings, templates, built strings, JSX text).
 *  Comments, exact `allowlist.labels` display entries, exact `allowlist.copy` strings, and JS built-in properties are ignored. */
export function engineNamesInSource(source: string, filePath: string, engines: readonly string[], allowlist: NameScanAllowlist = {}): string[] {
  const sf = parseSource(source, filePath)
  const targets = engines.map(id => ({ id, words: tokenizeWords(id) })).filter(t => t.words.length > 0)
  const labels = allowlist.labels ?? []
  const copy = new Set(allowlist.copy ?? [])
  const found = new Set<string>()
  const check = (text: string) => {
    const words = tokenizeWords(text)
    for (const target of targets) if (!found.has(target.id) && hasWordSequence(words, target.words)) found.add(target.id)
  }
  const visit = (node: ts.Node) => {
    if (found.size === targets.length || isAllowedDisplayEntry(node, labels)) return
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && JS_BUILTIN_OBJECTS.has(node.expression.text)) return
    if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) check(node.text)
    else if (ts.isStringLiteralLike(node) || ts.isJsxText(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      if (!copy.has(node.text.trim())) check(node.text)
    } else if (ts.isBinaryExpression(node) || ts.isTemplateExpression(node) || ts.isCallExpression(node)) {
      const built = evalStaticString(node)
      if (built !== null && !copy.has(built.trim())) check(built)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return [...found].sort()
}
