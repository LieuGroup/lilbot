/** Tests for the iOS 26 nested-stack tab-bar scroll-hiding Expo config plugin (#4145 workaround).
 *
 *  Test coverage split (GitHub CI installs root dependencies only, not `ios/node_modules`):
 *  - Runs on CI and locally:
 *    1. Plugin on/off behavior (`withTabScrollMinimize` writes `LilBotTabScrollMinimize.m` with `overwrite: true` when on,
 *       returns config untouched and leaves the file absent when off, and exports itself as the default Expo plugin).
 *    2. Single-switch wiring in `ios/app.config.ts` (`ENABLE_NESTED_TAB_SCROLL_MINIMIZE = true`) and `ios/AGENTS.md` note.
 *    3. Objective-C source invariants: strict public-header allowlist, zero private selectors/swizzling/KVC,
 *       fail-safe `class_addMethod` + `objc_msgSendSuper` + bounded BFS + bottom-edge / minimize-behavior / inverted-list guards,
 *       and upstream issue `#4145` deletion note.
 *  - Runs locally only (explicitly reported as `(skip)` on CI via `test.skipIf(!hasIosNodeModules)`):
 *    4. End-to-end Expo `xcodeproj` mod pipeline via `ios/app.config.ts` (`buildAppConfig` + `BaseMods` + `evalModsAsync`)
 *       verifying disk write, `project.pbxproj` linking, repeated-run idempotence, and full omission when off. */
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import withTabScrollMinimizeDefault, {
  TAB_SCROLL_MINIMIZE_FILE,
  TAB_SCROLL_MINIMIZE_SOURCE,
  type TabScrollMinimizeConfig,
  type WithBuildSourceFile,
  withTabScrollMinimize
} from '../../ios/plugins/with-tab-scroll-minimize'

const tempDirs: string[] = []
const iosRoot = resolve(process.cwd(), 'ios')
const hasIosNodeModules = existsSync(join(iosRoot, 'node_modules', 'expo', 'config-plugins.js'))

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

/** Minimal valid Xcode project structure matching Expo prebuild output for `LilBotDev`. */
function createSyntheticIosProject(projectName = 'LilBotDev') {
  const projectRoot = mkdtempSync(join(tmpdir(), 'lilbot-plugin-'))
  tempDirs.push(projectRoot)
  const sourceDir = join(projectRoot, 'ios', projectName)
  const xcodeprojDir = join(projectRoot, 'ios', `${projectName}.xcodeproj`)
  mkdirSync(sourceDir, { recursive: true })
  mkdirSync(xcodeprojDir, { recursive: true })
  writeFileSync(join(sourceDir, 'AppDelegate.swift'), '// synthetic app delegate\n', 'utf8')
  const pbxprojPath = join(xcodeprojDir, 'project.pbxproj')
  const pbxproj = `// !$*UTF8*$!
{
\tarchiveVersion = 1;
\tclasses = {};
\tobjectVersion = 54;
\tobjects = {
/* Begin PBXBuildFile section */
\t\t13B07FBC1A68108700A75B9A /* AppDelegate.swift in Sources */ = {isa = PBXBuildFile; fileRef = 13B07FB01A68108700A75B9A /* AppDelegate.swift */; };
/* End PBXBuildFile section */
/* Begin PBXFileReference section */
\t\t13B07F961A680F5B00A75B9A /* ${projectName}.app */ = {isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = ${projectName}.app; sourceTree = BUILT_PRODUCTS_DIR; };
\t\t13B07FB01A68108700A75B9A /* AppDelegate.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; name = AppDelegate.swift; path = ${projectName}/AppDelegate.swift; sourceTree = "<group>"; };
/* End PBXFileReference section */
/* Begin PBXGroup section */
\t\t13B07FAE1A68108700A75B9A /* ${projectName} */ = { isa = PBXGroup; children = ( 13B07FB01A68108700A75B9A /* AppDelegate.swift */, ); name = ${projectName}; sourceTree = "<group>"; };
\t\t83CBB9F61A601CBA00E9B192 = { isa = PBXGroup; children = ( 13B07FAE1A68108700A75B9A /* ${projectName} */, ); sourceTree = "<group>"; };
/* End PBXGroup section */
/* Begin PBXNativeTarget section */
\t\t13B07F861A680F5B00A75B9A /* ${projectName} */ = { isa = PBXNativeTarget; buildPhases = ( 13B07F871A680F5B00A75B9A /* Sources */, ); name = ${projectName}; productName = ${projectName}; productReference = 13B07F961A680F5B00A75B9A /* ${projectName}.app */; productType = "com.apple.product-type.application"; };
/* End PBXNativeTarget section */
/* Begin PBXProject section */
\t\t83CBB9F71A601CBA00E9B192 /* Project object */ = { isa = PBXProject; mainGroup = 83CBB9F61A601CBA00E9B192; targets = ( 13B07F861A680F5B00A75B9A /* ${projectName} */, ); };
/* End PBXProject section */
/* Begin PBXSourcesBuildPhase section */
\t\t13B07F871A680F5B00A75B9A /* Sources */ = { isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = ( 13B07FBC1A68108700A75B9A /* AppDelegate.swift in Sources */, ); runOnlyForDeploymentPostprocessing = 0; };
/* End PBXSourcesBuildPhase section */
\t};
\trootObject = 83CBB9F71A601CBA00E9B192 /* Project object */;
}
`
  writeFileSync(pbxprojPath, pbxproj, 'utf8')
  return { projectRoot, pbxprojPath, sourceDir }
}

describe('withTabScrollMinimize config plugin', () => {
  test('[CI + local] injects LilBotTabScrollMinimize.m when on and omits it completely when off', () => {
    expect(withTabScrollMinimizeDefault).toBe(withTabScrollMinimize)
    const { sourceDir } = createSyntheticIosProject()
    const calls: Array<{ filePath: string; overwrite?: boolean }> = []
    const stubAddSourceFile: WithBuildSourceFile = (config, { filePath, contents, overwrite }) => {
      writeFileSync(join(sourceDir, filePath), contents, 'utf8')
      calls.push({ filePath, overwrite })
      return { ...config, injectedFile: filePath }
    }

    const base: TabScrollMinimizeConfig = { name: 'LilBot Dev', slug: 'lilbot' }
    const disabled = withTabScrollMinimize(base, { enabled: false, withBuildSourceFile: stubAddSourceFile })
    expect(disabled).toBe(base)
    expect(calls).toEqual([])
    expect(existsSync(join(sourceDir, TAB_SCROLL_MINIMIZE_FILE))).toBe(false)

    const enabledDefault = withTabScrollMinimize(base, { withBuildSourceFile: stubAddSourceFile })
    expect(enabledDefault.injectedFile).toBe(TAB_SCROLL_MINIMIZE_FILE)
    expect(calls).toEqual([{ filePath: TAB_SCROLL_MINIMIZE_FILE, overwrite: true }])
    expect(readFileSync(join(sourceDir, TAB_SCROLL_MINIMIZE_FILE), 'utf8')).toBe(TAB_SCROLL_MINIMIZE_SOURCE)
  })

  test('[CI + local] app.config.ts gates plugin behind ENABLE_NESTED_TAB_SCROLL_MINIMIZE and ios/AGENTS.md notes #4145', () => {
    const appConfigSource = readFileSync(join(iosRoot, 'app.config.ts'), 'utf8')
    expect(appConfigSource).toContain('export const ENABLE_NESTED_TAB_SCROLL_MINIMIZE = true')
    expect(appConfigSource).toContain('const enableScrollMinimize = options.enableTabScrollMinimize ?? ENABLE_NESTED_TAB_SCROLL_MINIMIZE')
    expect(appConfigSource).toContain("...(enableScrollMinimize ? ['./plugins/with-tab-scroll-minimize'] : [])")

    const agentsDoc = readFileSync(join(iosRoot, 'AGENTS.md'), 'utf8')
    expect(agentsDoc).toContain('with-tab-scroll-minimize.ts')
    expect(agentsDoc).toContain('software-mansion/react-native-screens#4145')
  })

  test('[CI + local] Objective-C source enforces public-API-only, fail-safe, and #4145 tracking invariants', () => {
    const imports = [...TAB_SCROLL_MINIMIZE_SOURCE.matchAll(/^\s*#(?:import|include)\s+(.+)$/gm)].map(m => m[1].trim())
    expect(imports).toEqual(['<QuartzCore/QuartzCore.h>', '<UIKit/UIKit.h>', '<objc/message.h>', '<objc/runtime.h>'])

    expect(TAB_SCROLL_MINIMIZE_SOURCE).toContain('software-mansion/react-native-screens#4145')
    expect(TAB_SCROLL_MINIMIZE_SOURCE).toContain('NSClassFromString(className)')
    expect(TAB_SCROLL_MINIMIZE_SOURCE).toContain('isSubclassOfClass:UIViewController.class')
    expect(TAB_SCROLL_MINIMIZE_SOURCE).toContain('class_addMethod(')
    expect(TAB_SCROLL_MINIMIZE_SOURCE).toContain('objc_msgSendSuper')
    expect(TAB_SCROLL_MINIMIZE_SOURCE).toContain('NSDirectionalRectEdgeBottom')
    expect(TAB_SCROLL_MINIMIZE_SOURCE).toContain('UITabBarMinimizeBehaviorNever')
    expect(TAB_SCROLL_MINIMIZE_SOURCE).toContain('UITextView.class')
    expect(TAB_SCROLL_MINIMIZE_SOURCE).toContain('layer.transform.m22 < 0.0')
    expect(TAB_SCROLL_MINIMIZE_SOURCE).toContain('kLilBotMaxVisitedViews')

    expect(TAB_SCROLL_MINIMIZE_SOURCE).not.toContain('method_exchangeImplementations')
    expect(TAB_SCROLL_MINIMIZE_SOURCE).not.toContain('class_replaceMethod')
    expect(TAB_SCROLL_MINIMIZE_SOURCE).not.toContain('method_setImplementation')
    expect(TAB_SCROLL_MINIMIZE_SOURCE).not.toContain('NSSelectorFromString')
    expect(TAB_SCROLL_MINIMIZE_SOURCE).not.toContain('performSelector')
    expect(TAB_SCROLL_MINIMIZE_SOURCE).not.toContain('valueForKey:')
    expect(TAB_SCROLL_MINIMIZE_SOURCE).not.toMatch(/@selector\(_/)
  })

  test.skipIf(!hasIosNodeModules)('[local only — requires ios/node_modules] runs Expo xcodeproj mod end-to-end (on, idempotent, off)', async () => {
    const iosRequire = createRequire(join(iosRoot, 'package.json'))
    const { BaseMods, evalModsAsync } = iosRequire('expo/config-plugins') as {
      BaseMods: {
        withIosBaseMods: (config: unknown, opts: { providers: Record<string, unknown> }) => unknown
        getIosModFileProviders: () => { xcodeproj: unknown }
      }
      evalModsAsync: (config: unknown, opts: { projectRoot: string; platforms: string[] }) => Promise<unknown>
    }
    const appConfigMod = (await import(pathToFileURL(join(iosRoot, 'app.config.ts')).href)) as {
      ENABLE_NESTED_TAB_SCROLL_MINIMIZE: boolean
      buildAppConfig: (
        ctx: { config: Record<string, unknown>; projectRoot: string; staticConfigPath: null; packageJsonPath: string },
        opts?: { enableTabScrollMinimize?: boolean }
      ) => TabScrollMinimizeConfig & { mods?: { ios?: { xcodeproj?: unknown } } }
    }
    expect(appConfigMod.ENABLE_NESTED_TAB_SCROLL_MINIMIZE).toBe(true)

    const runPipeline = async (projectRoot: string, enableTabScrollMinimize: boolean) => {
      const cfg = appConfigMod.buildAppConfig({ config: {}, projectRoot, staticConfigPath: null, packageJsonPath: join(projectRoot, 'package.json') }, { enableTabScrollMinimize })
      const applied = cfg.plugins?.includes('./plugins/with-tab-scroll-minimize') ? withTabScrollMinimize(cfg) : cfg
      const withBase = BaseMods.withIosBaseMods(applied, { providers: { xcodeproj: BaseMods.getIosModFileProviders().xcodeproj } })
      await evalModsAsync(withBase, { projectRoot, platforms: ['ios'] })
      return cfg
    }

    const enabledProj = createSyntheticIosProject()
    const enabledCfg = await runPipeline(enabledProj.projectRoot, true)
    expect(enabledCfg.plugins).toContain('./plugins/with-tab-scroll-minimize')
    expect(readFileSync(join(enabledProj.sourceDir, TAB_SCROLL_MINIMIZE_FILE), 'utf8')).toBe(TAB_SCROLL_MINIMIZE_SOURCE)
    const afterFirst = readFileSync(enabledProj.pbxprojPath, 'utf8')
    expect(afterFirst).toContain(`LilBotDev/${TAB_SCROLL_MINIMIZE_FILE}`)
    expect(afterFirst).toContain(`${TAB_SCROLL_MINIMIZE_FILE} in Sources`)

    await runPipeline(enabledProj.projectRoot, true)
    expect(readFileSync(enabledProj.pbxprojPath, 'utf8')).toBe(afterFirst)

    const disabledProj = createSyntheticIosProject()
    const originalPbxproj = readFileSync(disabledProj.pbxprojPath, 'utf8')
    const prevTeam = process.env.APPLE_TEAM_ID
    const prevProfile = process.env.IOS_PROVISIONING_PROFILE_NAME
    delete process.env.APPLE_TEAM_ID
    delete process.env.IOS_PROVISIONING_PROFILE_NAME
    try {
      const disabledCfg = await runPipeline(disabledProj.projectRoot, false)
      expect(disabledCfg.plugins).not.toContain('./plugins/with-tab-scroll-minimize')
      expect(disabledCfg.mods?.ios?.xcodeproj).toBeUndefined()
      expect(existsSync(join(disabledProj.sourceDir, TAB_SCROLL_MINIMIZE_FILE))).toBe(false)
      expect(readFileSync(disabledProj.pbxprojPath, 'utf8')).toBe(originalPbxproj)
    } finally {
      if (prevTeam !== undefined) process.env.APPLE_TEAM_ID = prevTeam
      if (prevProfile !== undefined) process.env.IOS_PROVISIONING_PROFILE_NAME = prevProfile
    }
  })
})
