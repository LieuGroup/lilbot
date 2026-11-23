/** Builds verified, zero-secret shell commands for "Add by command line". Pure.
 *  Computer names never enter the command; every interpolated value is validated against strict allowlists. */
import type { CommandLineSystem, HelperDownload } from '../../../shared/computer-add-schema'

const SAFE_ORIGIN = /^https?:\/\/[A-Za-z0-9._:[\]-]+$/
const SAFE_ARCHIVE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,100}\.tar\.gz$/
const SAFE_SHA256 = /^[a-f0-9]{64}$/
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost'])

export const SYSTEM_OPTIONS: readonly { os: CommandLineSystem['os']; arch: CommandLineSystem['arch']; label: string }[] = [
  { os: 'linux', arch: 'x64', label: 'Linux (x86-64)' },
  { os: 'linux', arch: 'arm64', label: 'Linux (ARM64)' },
  { os: 'macos', arch: 'arm64', label: 'macOS (Apple silicon)' },
  { os: 'macos', arch: 'x64', label: 'macOS (Intel)' }
]

export function systemLabel(system: CommandLineSystem): string {
  return SYSTEM_OPTIONS.find(option => option.os === system.os && option.arch === system.arch)?.label ?? `${system.os} (${system.arch})`
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${Math.round(bytes / 1_000_000)} MB`
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)} KB`
  return `${bytes} B`
}

function safeOrigin(raw: string): string | null {
  const trimmed = raw.replace(/\/$/, '')
  if (!SAFE_ORIGIN.test(trimmed)) return null
  try {
    const url = new URL(trimmed)
    if (url.origin !== trimmed || url.username || url.password || url.search || url.hash || url.pathname !== '/') return null
    if (url.protocol === 'https:') return trimmed
    if (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)) return trimmed
    return null
  } catch {
    return null
  }
}

function safeArchive(download: Pick<HelperDownload, 'fileName' | 'sha256' | 'os'>): { fileName: string; sha256: string; os: 'linux' | 'macos' } | null {
  if (!SAFE_ARCHIVE.test(download.fileName) || !SAFE_SHA256.test(download.sha256)) return null
  return { fileName: download.fileName, sha256: download.sha256, os: download.os }
}

const verifyStep = (os: 'linux' | 'macos', target: string, sha256: string) =>
  os === 'macos' ? `printf '%s  %s\\n' '${sha256}' ${target} | shasum -a 256 -c - >/dev/null` : `printf '%s  %s\\n' '${sha256}' ${target} | sha256sum -c - >/dev/null`

const MKTEMP = `( set -e; umask 077; d=$(mktemp -d "\${TMPDIR:-/tmp}/lilbot-helper.XXXXXX")`

/** Self-contained command for machines on the private tailnet: downloads over HTTPS with redirects refused,
 *  verifies the server's exact SHA-256 before unpacking only the two expected files, then runs `install`
 *  (which prompts privately for the one-time code). */
export function buildPrivateCommand(input: { privateOrigin: string; download: Pick<HelperDownload, 'fileName' | 'sha256' | 'os'>; helperUrl: string }): string | null {
  const origin = safeOrigin(input.privateOrigin)
  const door = safeOrigin(input.helperUrl)
  const archive = safeArchive(input.download)
  if (!origin || !door || !archive) return null
  const proto = origin.startsWith('https://') ? '=https' : '=http'
  const url = `${origin}/api/computers/download/${archive.fileName}`
  return [
    MKTEMP,
    `trap 'rm -rf "$d"' EXIT INT TERM`,
    `curl -fsSL --proto '${proto}' --max-redirs 0 '${url}' -o "$d/h.tar.gz"`,
    verifyStep(archive.os, '"$d/h.tar.gz"', archive.sha256),
    'tar -xzf "$d/h.tar.gz" -C "$d" lilbot-helper lilbot-helper.sha256',
    `"$d/lilbot-helper" install '${door}' )`
  ].join('\n')
}

/** Local verified command for machines outside the private network after the user downloads and copies the archive. */
export function buildOutsideCommand(input: { download: Pick<HelperDownload, 'fileName' | 'sha256' | 'os'>; helperUrl: string }): string | null {
  const door = safeOrigin(input.helperUrl)
  const archive = safeArchive(input.download)
  if (!door || !archive) return null
  const lines = [
    MKTEMP,
    `trap 'rm -rf "$d"' EXIT INT TERM`,
    `f="$HOME/${archive.fileName}"`,
    verifyStep(archive.os, '"$f"', archive.sha256),
    'tar -xzf "$f" -C "$d" lilbot-helper lilbot-helper.sha256'
  ]
  // A browser download copied locally on macOS can carry com.apple.quarantine; clear it only after SHA-256 passed.
  if (archive.os === 'macos') lines.push('xattr -d com.apple.quarantine "$d/lilbot-helper" 2>/dev/null || true')
  lines.push(`"$d/lilbot-helper" install '${door}' )`)
  return lines.join('\n')
}

export function installDetails(os: 'linux' | 'macos'): { summary: string; remove: string } {
  const service = os === 'macos' ? 'one login start-up item (info.lilbot.helper.plist)' : 'one user start-up service (lilbot-helper.service)'
  return {
    summary: `Installs one folder (~/.config/lilbot-helper) and ${service}. No sudo needed.`,
    remove: 'To remove later: click Remove in Settings > Computers, or run ~/.config/lilbot-helper/lilbot-helper reset on the machine.'
  }
}
