/** Shared boundary constants, metadata allow-list rules, and exact display/copy allow-lists for the engine and helper-driver guard. */
import ts from 'typescript'
import { forbiddenSubfolderImports, type NameScanAllowlist, parseSource, specifiersInSource } from './boundary-scanner'

const SERVER_REGISTRATION_POINT = 'server/engines/registry.ts'
export const SERVER_METADATA_POINT = 'server/engines/metadata.ts'
export const SERVER_REGISTRATION_POINTS = [SERVER_REGISTRATION_POINT, SERVER_METADATA_POINT] as const
export const HELPER_REGISTRATION_POINT = 'helper/drivers/registry.ts'
export const LEADER_DRIVER_DECLARATION = 'server/computers/remote-worker-drivers.ts'
export const SCANNED_ROOTS = ['server', 'shared', 'web', 'ios', 'helper'] as const

const METADATA_MODULE_RE = /^server\/engines\/([^/]+)\/\1-(?:env-rules|rollback)(?:\.[cm]?[jt]s)?$/

/** True when `path` is an engine's declarative metadata module (`server/engines/<id>/<id>-env-rules` or `<id>-rollback`). */
export function isEngineMetadataModule(path: string, engines: readonly string[]): boolean {
  const match = METADATA_MODULE_RE.exec(path)
  return match !== null && engines.includes(match[1])
}

/** Disallowed server-engine imports:
 *  - `server/engines/registry.ts` may import concrete server engines.
 *  - `server/engines/metadata.ts` may import ONLY each engine's `<id>-env-rules` and `<id>-rollback` metadata modules.
 *  - Engine metadata modules (`<id>-env-rules`, `<id>-rollback`) may import NOTHING from any concrete engine folder (including their own).
 *  - Other files inside `server/engines/<id>/` may import only within their own folder; outsiders may import none. */
export function forbiddenServerEngineImports(file: string, targets: readonly string[], engines: readonly string[]): string[] {
  if (file === SERVER_REGISTRATION_POINT) return []
  const hitsEngineFolder = (target: string) => engines.some(id => target === `server/engines/${id}` || target.startsWith(`server/engines/${id}/`))
  if (file === SERVER_METADATA_POINT) {
    return targets.filter(target => hitsEngineFolder(target) && !isEngineMetadataModule(target, engines)).map(target => `${file} -> ${target}`)
  }
  if (isEngineMetadataModule(file, engines)) {
    return targets.filter(hitsEngineFolder).map(target => `${file} -> ${target}`)
  }
  return forbiddenSubfolderImports(file, targets, 'server/engines', engines, SERVER_REGISTRATION_POINT)
}

/** Flags Bun-specific imports (`bun`, `bun:*`) and runtime globals (`Bun`, `import.meta.dir`) in files that must stay Node/Vite-safe. */
export function bunUsagesInSource(source: string, filePath: string): string[] {
  const hits: string[] = []
  for (const spec of specifiersInSource(source, filePath)) {
    if (spec === 'bun' || spec.startsWith('bun:')) hits.push(`${filePath} -> ${spec}`)
  }
  const sf = parseSource(source, filePath)
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && node.text === 'Bun') {
      const parent = node.parent
      const isPropName = (ts.isPropertyAccessExpression(parent) && parent.name === node) || (ts.isPropertyAssignment(parent) && parent.name === node)
      if (!isPropName) hits.push(`${filePath} -> Bun`)
    } else if (
      ts.isPropertyAccessExpression(node) &&
      ts.isMetaProperty(node.expression) &&
      node.expression.keywordToken === ts.SyntaxKind.ImportKeyword &&
      node.name.text === 'dir'
    ) {
      hits.push(`${filePath} -> import.meta.dir`)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return [...new Set(hits)].sort()
}

/** Exact UI display-label entries and documented user-facing example copy strings (never whole-file exemptions).
 *  Bot-facing guides/skills live in Markdown (`.md`), which is prose outside this TS/JS code guard. */
export const NAME_ALLOWLIST: Record<string, NameScanAllowlist> = {
  'web/src/computers/coding-engines.ts': {
    labels: [
      { table: 'ENGINE_NAMES', key: 'hermes', label: 'Hermes' },
      { table: 'ENGINE_NAMES', key: 'claude-code', label: 'Claude Code' },
      { table: 'ENGINE_NAMES', key: 'codex', label: 'Codex' }
    ]
  },
  'web/src/computers/coding-worker-status.tsx': {
    copy: [
      '. Install a supported coding engine (for example, Claude Code) and sign in there. LilBot checks again every 5 minutes.',
      'No coding engine found on this computer. Install a coding engine (for example, Claude Code) and sign in there. LilBot checks again every 5 minutes.'
    ]
  },
  'web/src/computers/command-line-setup.tsx': {
    copy: ['To run coding workers on this computer, install a coding engine on it (for example, Claude Code) and sign in there. Files and terminal work without it.']
  }
}

export function isNameExempt(file: string, engines: readonly string[], drivers: readonly string[]): boolean {
  if ((SERVER_REGISTRATION_POINTS as readonly string[]).includes(file) || file === HELPER_REGISTRATION_POINT || file === LEADER_DRIVER_DECLARATION) return true
  return engines.some(id => file.startsWith(`server/engines/${id}/`)) || drivers.some(id => file.startsWith(`helper/drivers/${id}/`))
}
