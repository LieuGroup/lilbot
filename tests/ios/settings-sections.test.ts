import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { isBotsTabSegments } from '../../ios/src/bots/roster-state'
import { createConnectionStore, type PlainStorage, SETTINGS_KEY, type SecretStorage, TOKEN_KEY } from '../../ios/src/connection/store-core'
import { findSettingsSectionRoute, type SettingsSectionDefinition, visibleSettingsSections } from '../../ios/src/settings/sections'
import { buildOutsideCommand, buildPrivateCommand } from '../../shared/client/computers/command-line-script'
import { computerRows } from '../../shared/client/computers/computer-rows'
import { deviceLine } from '../../shared/client/devices/device-line'

const StubComponent = () => null
const StubDetail = () => null

describe('extensible Settings section registry and Computers rules', () => {
  test('orders built-in and sibling-thread sections (Notifications, Memory) and resolves [section] routes without editing SettingsScreen', () => {
    const base: SettingsSectionDefinition[] = [
      { id: 'general', order: 40, group: 'inline', Component: StubComponent },
      { id: 'computers', order: 10, group: 'navigation', routeName: 'computers', routeTitle: 'Computers', Component: StubComponent, DetailScreen: StubDetail }
    ]
    const withSiblings: SettingsSectionDefinition[] = [
      ...base,
      { id: 'memory', order: 30, group: 'navigation', routeName: 'memory', routeTitle: 'Memory', Component: StubComponent, DetailScreen: StubDetail },
      { id: 'notifications', order: 20, group: 'navigation', routeName: 'notifications', routeTitle: 'Notifications', Component: StubComponent, DetailScreen: StubDetail }
    ]

    expect(visibleSettingsSections(withSiblings, { hasServer: false }).map(s => s.id)).toEqual([])
    expect(visibleSettingsSections(withSiblings, { hasServer: true, group: 'navigation' }).map(s => s.id)).toEqual(['computers', 'notifications', 'memory'])
    expect(visibleSettingsSections(withSiblings, { hasServer: true, group: 'inline' }).map(s => s.id)).toEqual(['general'])

    expect(findSettingsSectionRoute(withSiblings, 'computers')?.routeTitle).toBe('Computers')
    expect(findSettingsSectionRoute(withSiblings, 'notifications')?.routeTitle).toBe('Notifications')
    expect(findSettingsSectionRoute(withSiblings, 'memory')?.routeTitle).toBe('Memory')
    expect(findSettingsSectionRoute(withSiblings, 'unknown')).toBeNull()
    expect(findSettingsSectionRoute(withSiblings, undefined)).toBeNull()
  })

  test('respects showBeforeSetup for sections meant to appear before first server connection', () => {
    const sections: SettingsSectionDefinition[] = [
      { id: 'before', order: 5, group: 'inline', showBeforeSetup: true, Component: StubComponent },
      { id: 'after', order: 10, group: 'inline', Component: StubComponent }
    ]
    expect(visibleSettingsSections(sections, { hasServer: false }).map(s => s.id)).toEqual(['before'])
    expect(visibleSettingsSections(sections, { hasServer: true }).map(s => s.id)).toEqual(['before', 'after'])
  })

  test('isBotsTabSegments recognizes both (settings) stack group and legacy settings segment as Settings tab', () => {
    expect(isBotsTabSegments(['(tabs)', '(settings)'])).toBe(false)
    expect(isBotsTabSegments(['(tabs)', '(settings)', '[section]'])).toBe(false)
    expect(isBotsTabSegments(['(tabs)', 'settings'])).toBe(false)
    expect(isBotsTabSegments(['(tabs)', '(bots)'])).toBe(true)
    expect(isBotsTabSegments(['(tabs)', '(bots)', 'bot-details'])).toBe(true)
  })

  test('Settings and Computers screens exclude forbidden Round 4 items and keep offline dots muted grey', () => {
    const root = process.cwd()
    const settingsSrc = readFileSync(resolve(root, 'ios/src/settings/screen.tsx'), 'utf8')
    const generalSrc = readFileSync(resolve(root, 'ios/src/settings/sections/general-section.tsx'), 'utf8')
    const computersSrc = readFileSync(resolve(root, 'ios/src/computers/computers-screen.tsx'), 'utf8')
    const computersRowSrc = readFileSync(resolve(root, 'ios/src/computers/computer-row-card.tsx'), 'utf8')
    const combined = `${settingsSrc}\n${generalSrc}\n${computersSrc}\n${computersRowSrc}`

    for (const forbidden of ['Default model', 'Compact density', 'Hide bars on scroll', 'Scan QR', '12ms']) {
      expect(combined).not.toContain(forbidden)
    }
    expect(computersRowSrc).toContain("row.status === 'offline' ? 0.4 : 1")
    expect(computersRowSrc).not.toContain("row.status === 'offline' ? theme.destructive")
  })

  test('shared Computers and Devices helpers format rows, device resolution, and install commands', () => {
    const now = Date.UTC(2026, 10, 25, 12, 0, 0)
    const rows = computerRows(
      [
        {
          id: 'c2',
          name: 'Build box',
          os: 'linux',
          home: '/home/build',
          capabilities: ['exec', 'read', 'worker'],
          workerAgents: [{ driver: 'codex', version: '1.0.0', supported: true, signedIn: true }],
          online: false,
          lastSeen: now - 3 * 3_600_000,
          keyConflict: false,
          main: false
        },
        {
          id: 'leader',
          name: 'Leader',
          os: 'linux',
          home: '/home/leader',
          capabilities: ['exec', 'read'],
          online: true,
          lastSeen: now,
          keyConflict: false,
          main: true
        }
      ],
      now,
      'leader'
    )
    expect(rows.map(r => r.id)).toEqual(['leader', 'c2'])
    expect(rows[0].status).toBe('online')
    expect(rows[0].main).toBe(true)
    expect(rows[0].thisDevice).toBe(true)
    expect(rows[0].line).toContain('where LilBot runs')
    expect(rows[1].status).toBe('offline')
    expect(rows[1].line).toContain('offline')
    expect(rows[1].workerText).toContain('Coding workers (Codex)')

    expect(deviceLine({ via: 'linked', computerId: 'leader', name: 'Leader', online: true })).toContain('Leader')
    expect(deviceLine({ via: 'none' })).toContain('No main computer')

    const sha256 = 'a'.repeat(64)
    const download = { os: 'linux' as const, fileName: 'lilbot-helper-linux-x64.tar.gz', sha256 }
    expect(buildPrivateCommand({ privateOrigin: 'https://lilbot.internal', download, helperUrl: 'https://helper.example.com' })).toContain(sha256)
    expect(buildOutsideCommand({ download, helperUrl: 'https://helper.example.com' })).toContain('helper.example.com')
  })

  test('Bot Details and Settings stack routes reserve Duo horizontal strip padding', () => {
    for (const rel of ['ios/src/app/(tabs)/(bots)/bot-details.tsx', 'ios/src/app/(tabs)/(settings)/index.tsx', 'ios/src/app/(tabs)/(settings)/[section].tsx']) {
      const src = readFileSync(resolve(process.cwd(), rel), 'utf8')
      expect(src).toContain('computeShellLayout')
      expect(src).toContain('layout.horizontalPadding.right')
    }
  })

  test('disconnect clears saved server address and Keychain token', async () => {
    const plainMap = new Map<string, string>([[SETTINGS_KEY, JSON.stringify({ serverUrl: 'http://127.0.0.1:3370' })]])
    const secretMap = new Map<string, string>([[TOKEN_KEY, 'jwt-1']])
    const plain: PlainStorage = {
      getItem: async k => plainMap.get(k) ?? null,
      setItem: async (k, v) => {
        plainMap.set(k, v)
      }
    }
    const secret: SecretStorage = {
      getItem: async k => secretMap.get(k) ?? null,
      setItem: async (k, v) => {
        secretMap.set(k, v)
      },
      deleteItem: async k => {
        secretMap.delete(k)
      }
    }
    let disconnectedCount = 0
    const store = createConnectionStore({
      plain,
      secret,
      onDisconnect: () => {
        disconnectedCount += 1
      }
    })
    await store.getState().load()
    expect(store.getState().settings?.serverUrl).toBe('http://127.0.0.1:3370')

    await store.getState().disconnect()
    expect(disconnectedCount).toBe(1)
    expect(store.getState().settings).toBeNull()
    expect(store.getState().connected).toBe(false)
    expect(secretMap.has(TOKEN_KEY)).toBe(false)
  })
})
