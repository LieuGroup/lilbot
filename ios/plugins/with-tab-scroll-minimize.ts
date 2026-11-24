/** Expo config plugin that works around software-mansion/react-native-screens#4145 so iOS 26
 *  `tabBarMinimizeBehavior="onScrollDown"` works when a NativeTabs tab hosts a nested native Stack.
 *  Controlled by `ENABLE_NESTED_TAB_SCROLL_MINIMIZE` in `ios/app.config.ts`. Delete this file and
 *  `ios/plugins/LilBotTabScrollMinimize.m` once react-native-screens resolves #4145 natively
 *  without `RNS_GAMMA_ENABLED=1`. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const TAB_SCROLL_MINIMIZE_FILE = 'LilBotTabScrollMinimize.m'
export const TAB_SCROLL_MINIMIZE_SOURCE = readFileSync(join(__dirname, TAB_SCROLL_MINIMIZE_FILE), 'utf8')

export interface TabScrollMinimizeConfig {
  name?: string
  slug?: string
  plugins?: unknown[]
  [key: string]: unknown
}

export type WithBuildSourceFile = <T extends TabScrollMinimizeConfig>(
  config: T,
  props: { filePath: string; contents: string; overwrite?: boolean }
) => T

export interface TabScrollMinimizeOptions {
  enabled?: boolean
  withBuildSourceFile?: WithBuildSourceFile
}

declare function require(id: string): unknown

function defaultWithBuildSourceFile(): WithBuildSourceFile {
  // Loaded lazily so root-only TypeScript checks and unit tests can import this file
  // without `ios/node_modules` installed while Expo prebuild resolves `expo/config-plugins`.
  const mod = require('expo/config-plugins') as {
    IOSConfig: { XcodeProjectFile: { withBuildSourceFile: WithBuildSourceFile } }
  }
  return mod.IOSConfig.XcodeProjectFile.withBuildSourceFile
}

export function withTabScrollMinimize<T extends TabScrollMinimizeConfig>(config: T, options: TabScrollMinimizeOptions = {}): T {
  if (options.enabled === false) return config
  const addSourceFile = options.withBuildSourceFile ?? defaultWithBuildSourceFile()
  return addSourceFile(config, {
    filePath: TAB_SCROLL_MINIMIZE_FILE,
    contents: TAB_SCROLL_MINIMIZE_SOURCE,
    overwrite: true
  })
}

export default withTabScrollMinimize
