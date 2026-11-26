/** Tests covering LILA-51 Round 1 review fixes for PR 302: MOBILE_SCALE typography, Duo side-strip Bot Details,
 *  iPad inspector reachability, Settings ErrorBoundary isolation, clipboard-only secret copy, Disconnect socket stop,
 *  visible Computers Remove + error banner, AX5 reflow, RenameDeviceModal scroll, multiline Done, and web parity. */
import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildDuoVerticalBarItems, DUO_VERTICAL_BAR_TABLE } from '../../ios/src/duo/vertical-bar'
import { copyText } from '../../ios/src/ui/copy'
import { MOBILE_SCALE } from '../../ios/src/ui/tokens'

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8')

const ERROR_BOUNDARY_HARNESS = `
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { mock } from 'bun:test'
import * as React from 'react'
import { createElement } from 'react'
import * as ReactJsxRuntime from 'react/jsx-runtime'
import * as ReactJsxDevRuntime from 'react/jsx-dev-runtime'
import { renderToStaticMarkup } from 'react-dom/server'
mock.module('react', () => React)
const iosReactDir = resolve(process.cwd(), 'ios/node_modules/react')
if (existsSync(iosReactDir)) {
  mock.module(resolve(iosReactDir, 'index.js'), () => React)
  mock.module(resolve(iosReactDir, 'jsx-runtime.js'), () => ReactJsxRuntime)
  mock.module(resolve(iosReactDir, 'jsx-dev-runtime.js'), () => ReactJsxDevRuntime)
}
const host = tag => ({ children, testID }) => createElement(tag, testID ? { 'data-testid': testID } : undefined, children)
mock.module('react-native', () => ({ Pressable: host('rn-pressable'), Text: host('rn-text'), View: host('rn-view'), useColorScheme: () => 'light' }))
const { SettingsSectionErrorBoundary } = await import(resolve(process.cwd(), 'ios/src/settings/section-error-boundary.tsx'))
const okMarkup = renderToStaticMarkup(createElement(SettingsSectionErrorBoundary, { sectionId: 'ok' }, createElement('rn-text', null, 'Healthy section')))
const nextState = SettingsSectionErrorBoundary.getDerivedStateFromError()
const failedInstance = new SettingsSectionErrorBoundary({ sectionId: 'broken', children: createElement('rn-text', null, 'Hidden child') })
failedInstance.state = nextState
const failedMarkup = renderToStaticMarkup(failedInstance.render())
process.stdout.write(JSON.stringify({ okMarkup, nextState, failedMarkup }))
`

describe('PR 302 Round 2 fixes (scale, Duo strip, safety, ErrorBoundary, AX5, keyboard, web parity)', () => {
  test('MOBILE_SCALE.details matches approved roster/chat scale and is adopted across Bot Details and Settings', () => {
    expect(MOBILE_SCALE.details.sectionHeader).toEqual(MOBILE_SCALE.roster.sectionHeader)
    expect(MOBILE_SCALE.details.rowTitle).toEqual(MOBILE_SCALE.roster.rowName)
    expect(MOBILE_SCALE.details.rowSubtitle).toEqual(MOBILE_SCALE.roster.rowPreview)
    expect(MOBILE_SCALE.details.input.fontSize).toBeGreaterThanOrEqual(17)

    const screens = [
      'ios/src/ui/grouped-card.tsx',
      'ios/src/bots/details-screen.tsx',
      'ios/src/activity/activity-tab.tsx',
      'ios/src/routines/routines-card.tsx',
      'ios/src/routines/routine-detail-sheet.tsx',
      'ios/src/webhooks/webhooks-card.tsx',
      'ios/src/webhooks/webhook-detail-sheet.tsx',
      'ios/src/library/library-tab.tsx',
      'ios/src/library/library-item-row.tsx',
      'ios/src/bots/setup-tab.tsx',
      'ios/src/bots/setup-form.tsx',
      'ios/src/skills/skills-section.tsx',
      'ios/src/settings/screen.tsx',
      'ios/src/settings/server-section.tsx',
      'ios/src/settings/sections/computers-section.tsx',
      'ios/src/settings/sections/general-section.tsx',
      'ios/src/computers/computers-screen.tsx',
      'ios/src/computers/computer-row-card.tsx',
      'ios/src/computers/device-modals.tsx',
      'ios/src/computers/command-line-sheet.tsx'
    ]
    for (const file of screens) {
      const src = read(file)
      expect(src).toContain('MOBILE_SCALE.details')
      expect(src).not.toMatch(/fontSize:\s*1[2-5]\b/)
    }
  })

  test('Folded Duo Bot Details moves Back and bot-menu into the 84 pt side strip and iPad Chat header opens inspector', () => {
    expect(DUO_VERTICAL_BAR_TABLE['folded-details'].map(s => s.id)).toEqual(['bot-menu'])
    const items = buildDuoVerticalBarItems({
      screen: 'folded-details',
      actions: { 'bot-menu': { label: 'More for Atlas', onPress: () => {} } }
    })
    expect(items).toHaveLength(1)
    expect(items[0].type).toBe('button')

    const routeSrc = read('ios/src/app/(tabs)/(bots)/bot-details.tsx')
    expect(routeSrc).toContain('isDuoVerticalBarActive')
    expect(routeSrc).toContain('duoVerticalHeaderOptions')
    expect(routeSrc).toContain("screen: 'folded-details'")
    expect(routeSrc).toContain('backVisible: true')
    expect(routeSrc).toContain('compact={!verticalBarActive}')

    const chatSrc = read('ios/src/chat/screen.tsx')
    const shellSrc = read('ios/src/duo/shell.tsx')
    expect(chatSrc).toContain('chat-inline-details-button')
    expect(shellSrc).toContain('onOpenDetails={renderInspector ? toggleInspector : undefined}')
  })

  test('SettingsSectionErrorBoundary isolates throwing sections in both SettingsScreen and [section].tsx', () => {
    const boundarySrc = read('ios/src/settings/section-error-boundary.tsx')
    const screenSrc = read('ios/src/settings/screen.tsx')
    const routeSrc = read('ios/src/app/(tabs)/(settings)/[section].tsx')

    expect(boundarySrc).toContain('getDerivedStateFromError')
    expect(boundarySrc).toContain('componentDidCatch')
    expect(screenSrc).toContain('<SettingsSectionErrorBoundary')
    expect(routeSrc).toContain('<SettingsSectionErrorBoundary')

    const out = JSON.parse(execFileSync(process.execPath, ['-e', ERROR_BOUNDARY_HARNESS], { cwd: process.cwd(), encoding: 'utf8' })) as {
      okMarkup: string
      nextState: { failed: boolean }
      failedMarkup: string
    }
    expect(out.okMarkup).toContain('Healthy section')
    expect(out.nextState).toEqual({ failed: true })
    expect(out.failedMarkup).toContain('settings-section-error-broken')
    expect(out.failedMarkup).toContain('This section could not load.')
    expect(out.failedMarkup).toContain('Try again')
    expect(out.failedMarkup).not.toContain('Hidden child')
  })

  test('copyText never falls back to Share.share and returns failed when clipboard is unavailable', async () => {
    const copySrc = read('ios/src/ui/copy.ts')
    expect(copySrc).not.toContain("from 'react-native'")
    expect(copySrc).not.toMatch(/\bShare\.share\s*\(/)
    expect(copySrc).toContain('expo-clipboard')

    // On Linux bun test, expo-clipboard native module is absent so copyText must fail closed (never throw or share).
    expect(await copyText('https://secret.example/hook/abc')).toBe('failed')

    const hookSrc = read('ios/src/webhooks/use-webhooks.ts')
    const sheetSrc = read('ios/src/webhooks/webhook-detail-sheet.tsx')
    expect(hookSrc).toContain("if (outcome !== 'copied') throw new Error")
    expect(sheetSrc).not.toContain('Shared')
    expect(sheetSrc).toContain('copyingRef')
    expect(sheetSrc).toContain('deletingRef')
    expect(sheetSrc).toContain('[webhook?.id]')
  })

  test('Disconnect stops the live socket and Computers exposes visible Remove, single-send guards, and error banner', () => {
    expect(read('ios/src/connection/lilbot.ts')).toContain('export function stopSocket()')
    expect(read('ios/src/connection/start.ts')).toContain('export function stopConnection()')
    expect(read('ios/src/app/_layout.tsx')).toContain('stopConnection()')
    expect(read('ios/src/settings/server-section.tsx')).toContain('stopConnection()')
    expect(read('ios/src/settings/server-section.tsx')).toContain('disconnectingRef')

    const rowSrc = read('ios/src/computers/computer-row-card.tsx')
    const screenSrc = read('ios/src/computers/computers-screen.tsx')
    const hookSrc = read('ios/src/computers/use-computers.ts')
    expect(rowSrc).toContain('computer-remove-')
    expect(rowSrc).toContain('accessibilityLabel={`Remove ')
    expect(rowSrc).not.toContain('onLongPress')
    expect(screenSrc).toContain('computers-action-error')
    expect(hookSrc).toContain('busyRef')
  })

  test('AX5 reflow, RenameDeviceModal scroll, multiline Done, SetupContextCard, and paginated run transcripts are wired', () => {
    const librarySrc = read('ios/src/library/library-tab.tsx')
    expect(librarySrc).toContain("flexWrap: 'wrap'")
    expect(librarySrc).toContain('FlatList')
    expect(librarySrc).toContain('rosterRowTextLines')

    const modalSrc = read('ios/src/computers/device-modals.tsx')
    expect(modalSrc).toContain('rename-device-scroll')
    expect(modalSrc).toContain('KEYBOARD_SCROLL_PROPS')
    expect(modalSrc).toContain('disabled={!canSave}')
    expect(modalSrc).toContain('transparent animationType="fade" supportedOrientations={["portrait", "landscape"]}')

    const formSrc = read('ios/src/bots/setup-form.tsx')
    expect(formSrc).toContain('setup-multiline-done')
    expect(formSrc.match(/inputAccessoryViewID=\{MULTILINE_DONE_ID\}/g)?.length).toBe(2)
    expect(formSrc).toContain('<InputAccessoryView nativeID={MULTILINE_DONE_ID}')

    const setupSrc = read('ios/src/bots/setup-tab.tsx')
    expect(setupSrc).toContain('<SetupContextCard')

    const runListSrc = read('ios/src/routines/run-list-section.tsx')
    const transcriptSrc = read('ios/src/routines/run-transcript-sheet.tsx')
    expect(runListSrc).toContain('Show older runs')
    expect(transcriptSrc).toContain('routines.openRun')
    expect(transcriptSrc).toContain('webhooks.openRun')
    expect(transcriptSrc).toContain("'chat.close'")
    expect(transcriptSrc).not.toContain('<Modal')

    const detailsSrc = read('ios/src/bots/details-screen.tsx')
    expect(detailsSrc).toContain('usePanGesture')
    expect(detailsSrc).toContain('disableReanimated: true')
    expect(detailsSrc).not.toContain('Gesture.Pan(')
  })
})
