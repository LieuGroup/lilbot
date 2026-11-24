/** Expo config plugin enabling iOS 27.1+ `UIBarButtonItemAxisBehaviorVerticalPreferred` on native
 *  `RNSBarButtonItem` and custom header subview bar items opted in via `lilbot.duo.vertical.`.
 *  Controlled by `ENABLE_DUO_VERTICAL_BAR_ITEMS` in `ios/app.config.ts`. Reads the plain Objective-C
 *  source from `LilBotDuoVerticalBar.m`. Delete once `react-native-screens` exposes `axisBehavior` natively. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const DUO_VERTICAL_BAR_FILE = 'LilBotDuoVerticalBar.m'
export const DUO_VERTICAL_ITEM_PREFIX = 'lilbot.duo.vertical.'

export interface DuoVerticalBarConfig {
  name?: string
  slug?: string
  plugins?: unknown[]
  [key: string]: unknown
}

export type WithBuildSourceFile = <T extends DuoVerticalBarConfig>(
  config: T,
  props: { filePath: string; contents: string; overwrite?: boolean }
) => T

export interface DuoVerticalBarOptions {
  enabled?: boolean
  withBuildSourceFile?: WithBuildSourceFile
}

declare function require(id: string): unknown

function defaultWithBuildSourceFile(): WithBuildSourceFile {
  const mod = require('expo/config-plugins') as {
    IOSConfig: { XcodeProjectFile: { withBuildSourceFile: WithBuildSourceFile } }
  }
  return mod.IOSConfig.XcodeProjectFile.withBuildSourceFile
}

export function readDuoVerticalBarSource(): string {
  return readFileSync(join(__dirname, DUO_VERTICAL_BAR_FILE), 'utf8')
}

export function withDuoVerticalBar<T extends DuoVerticalBarConfig>(config: T, options: DuoVerticalBarOptions = {}): T {
  if (options.enabled === false) return config
  const addSourceFile = options.withBuildSourceFile ?? defaultWithBuildSourceFile()
  return addSourceFile(config, {
    filePath: DUO_VERTICAL_BAR_FILE,
    contents: readDuoVerticalBarSource(),
    overwrite: true
  })
}

export default withDuoVerticalBar
