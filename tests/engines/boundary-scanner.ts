/** TypeScript AST-based import and engine-name scanner for boundary and structure tests. */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'
import ts from 'typescript'

export const ROOT = join(import.meta.dir, '../..')

export function concreteEngineIds(): string[] {
  const dir = join(ROOT, 'server/engines')
  return readdirSync(dir)
    .filter(name => statSync(join(dir, name)).isDirectory())
    .sort()
}

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

export function importsOf(file: string): string[] {
  return relativeImportsInSource(readFileSync(join(ROOT, file), 'utf8'), file)
}

/** Splits an identifier or string into lowercase whole words (camelCase, snake_case, kebab-case, punctuation). */
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
    for (let j = 0; j < target.length; j++) {
      if (words[i + j] !== target[j]) {
        ok = false
        break
      }
    }
    if (ok) return true
  }
  return false
}

/** Returns which engine ids appear as whole tokens in code (identifiers, string literals, template chunks,
 *  built strings, JSX text, import paths). Comments are ignored because only AST code nodes are visited. */
export function engineNamesInSource(source: string, filePath: string, engines: readonly string[]): string[] {
  const sf = parseSource(source, filePath)
  const targets = engines.map(id => ({ id, words: tokenizeWords(id) })).filter(t => t.words.length > 0)
  const found = new Set<string>()
  const check = (text: string) => {
    if (!text) return
    const words = tokenizeWords(text)
    for (const target of targets) if (!found.has(target.id) && hasWordSequence(words, target.words)) found.add(target.id)
  }
  const visit = (node: ts.Node) => {
    if (found.size === targets.length) return
    if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) {
      check(node.text)
    } else if (ts.isStringLiteralLike(node) || ts.isJsxText(node)) {
      check(node.text)
    } else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      check(node.text)
    } else if (ts.isBinaryExpression(node) || ts.isTemplateExpression(node) || ts.isCallExpression(node)) {
      const built = evalStaticString(node)
      if (built !== null) check(built)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return [...found].sort()
}
