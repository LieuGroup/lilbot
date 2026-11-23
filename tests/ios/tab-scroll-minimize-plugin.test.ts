/** Tests for the iOS 26 nested-stack tab-bar scroll-hiding Expo config plugin (#4145 workaround).
 *
 *  Test coverage split (GitHub CI installs root dependencies only, not `ios/node_modules`):
 *  - `[CI + local]` (always run): plugin on/off injection + default export, single switch in `ios/app.config.ts`
 *    + `ios/AGENTS.md` note + lazy loader target check, and all Obj-C public-API & fail-safe source guards.
 *  - `[CI only — without ios/node_modules]` (reported as `(skip)` locally): asserts calling the plugin without
 *    `expo/config-plugins` installed throws loudly naming `expo/config-plugins`.
 *  - `[local only — requires ios/node_modules]` (reported as `(skip)` on CI): runs the full Expo `xcodeproj`
 *    mod pipeline (`buildAppConfig` + `BaseMods` + `evalModsAsync`) for on, idempotence, and off. */
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

/** Minimal valid Xcode project matching Expo prebuild output for `LilBotDev`. */
function createSyntheticIosProject(projectName = 'LilBotDev') {
  const projectRoot = mkdtempSync(join(tmpdir(), 'lilbot-plugin-'))
  tempDirs.push(projectRoot)
  const sourceDir = join(projectRoot, 'ios', projectName)
  const xcodeprojDir = join(projectRoot, 'ios', `${projectName}.xcodeproj`)
  mkdirSync(sourceDir, { recursive: true })
  mkdirSync(xcodeprojDir, { recursive: true })
  writeFileSync(join(sourceDir, 'AppDelegate.swift'), '// synthetic app delegate\n', 'utf8')
  const pbxprojPath = join(xcodeprojDir, 'project.pbxproj')
  const pbxproj = `// !$*UTF8*$!\n{\n\tarchiveVersion = 1;\n\tclasses = {};\n\tobjectVersion = 54;\n\tobjects = {\n/* Begin PBXBuildFile section */\n\t\t13B07FBC1A68108700A75B9A /* AppDelegate.swift in Sources */ = {isa = PBXBuildFile; fileRef = 13B07FB01A68108700A75B9A /* AppDelegate.swift */; };\n/* End PBXBuildFile section */\n/* Begin PBXFileReference section */\n\t\t13B07F961A680F5B00A75B9A /* ${projectName}.app */ = {isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = ${projectName}.app; sourceTree = BUILT_PRODUCTS_DIR; };\n\t\t13B07FB01A68108700A75B9A /* AppDelegate.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; name = AppDelegate.swift; path = ${projectName}/AppDelegate.swift; sourceTree = "<group>"; };\n/* End PBXFileReference section */\n/* Begin PBXGroup section */\n\t\t13B07FAE1A68108700A75B9A /* ${projectName} */ = { isa = PBXGroup; children = ( 13B07FB01A68108700A75B9A /* AppDelegate.swift */, ); name = ${projectName}; sourceTree = "<group>"; };\n\t\t83CBB9F61A601CBA00E9B192 = { isa = PBXGroup; children = ( 13B07FAE1A68108700A75B9A /* ${projectName} */, ); sourceTree = "<group>"; };\n/* End PBXGroup section */\n/* Begin PBXNativeTarget section */\n\t\t13B07F861A680F5B00A75B9A /* ${projectName} */ = { isa = PBXNativeTarget; buildPhases = ( 13B07F871A680F5B00A75B9A /* Sources */, ); name = ${projectName}; productName = ${projectName}; productReference = 13B07F961A680F5B00A75B9A /* ${projectName}.app */; productType = "com.apple.product-type.application"; };\n/* End PBXNativeTarget section */\n/* Begin PBXProject section */\n\t\t83CBB9F71A601CBA00E9B192 /* Project object */ = { isa = PBXProject; mainGroup = 83CBB9F61A601CBA00E9B192; targets = ( 13B07F861A680F5B00A75B9A /* ${projectName} */, ); };\n/* End PBXProject section */\n/* Begin PBXSourcesBuildPhase section */\n\t\t13B07F871A680F5B00A75B9A /* Sources */ = { isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = ( 13B07FBC1A68108700A75B9A /* AppDelegate.swift in Sources */, ); runOnlyForDeploymentPostprocessing = 0; };\n/* End PBXSourcesBuildPhase section */\n\t};\n\trootObject = 83CBB9F71A601CBA00E9B192 /* Project object */;\n}\n`
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
    expect(withTabScrollMinimize(base, { enabled: false, withBuildSourceFile: stubAddSourceFile })).toBe(base)
    expect(calls).toEqual([])
    expect(existsSync(join(sourceDir, TAB_SCROLL_MINIMIZE_FILE))).toBe(false)

    const enabledDefault = withTabScrollMinimize(base, { withBuildSourceFile: stubAddSourceFile })
    expect(enabledDefault.injectedFile).toBe(TAB_SCROLL_MINIMIZE_FILE)
    expect(calls).toEqual([{ filePath: TAB_SCROLL_MINIMIZE_FILE, overwrite: true }])
    expect(readFileSync(join(sourceDir, TAB_SCROLL_MINIMIZE_FILE), 'utf8')).toBe(TAB_SCROLL_MINIMIZE_SOURCE)
  })

  test('[CI + local] app.config.ts switch, lazy Expo loader path, and ios/AGENTS.md #4145 note are intact', () => {
    const appConfigSource = readFileSync(join(iosRoot, 'app.config.ts'), 'utf8')
    expect(appConfigSource).toContain('export const ENABLE_NESTED_TAB_SCROLL_MINIMIZE = true')
    expect(appConfigSource).toContain('const enableScrollMinimize = options.enableTabScrollMinimize ?? ENABLE_NESTED_TAB_SCROLL_MINIMIZE')
    expect(appConfigSource).toContain("...(enableScrollMinimize ? ['./plugins/with-tab-scroll-minimize'] : [])")

    const pluginSource = readFileSync(join(iosRoot, 'plugins/with-tab-scroll-minimize.ts'), 'utf8')
    expect(pluginSource).toContain("require('expo/config-plugins')")
    expect(pluginSource).toContain('mod.IOSConfig.XcodeProjectFile.withBuildSourceFile')

    const agentsDoc = readFileSync(join(iosRoot, 'AGENTS.md'), 'utf8')
    expect(agentsDoc).toContain('with-tab-scroll-minimize.ts')
    expect(agentsDoc).toContain('software-mansion/react-native-screens#4145')
  })

  test('[CI + local] Objective-C source enforces public-API-only and every fail-safe guard', () => {
    const src = TAB_SCROLL_MINIMIZE_SOURCE
    const imports = [...src.matchAll(/^\s*#(?:import|include)\s+(.+)$/gm)].map(m => m[1].trim())
    expect(imports).toEqual(['<QuartzCore/QuartzCore.h>', '<UIKit/UIKit.h>', '<objc/message.h>', '<objc/runtime.h>'])

    // Missing/renamed classes, yielding to super, OS availability, hidden views, horizontal scrollers, BFS caps, inverted/text skips:
    for (const guard of [
      'software-mansion/react-native-screens#4145',
      'if (cls == Nil || ![cls isSubclassOfClass:UIViewController.class]) return;',
      'class_addMethod(cls, selector, imp, types)',
      'objc_msgSendSuper',
      'if (superResult != nil || !LilBotShouldResolveForTabBar(self, edge)) return superResult;',
      'if (superResult != nil || !LilBotShouldResolveForTabBar(self, edge) || !self.isViewLoaded)',
      'if ((edge & NSDirectionalRectEdgeBottom) == 0) return NO;',
      'tabBarController.tabBarMinimizeBehavior != UITabBarMinimizeBehaviorNever',
      'if (view.isHidden || view.alpha <= 0.01) continue;',
      'if (view.layer.transform.m22 < 0.0) continue;',
      'if ([view isKindOfClass:UITextView.class]) continue;',
      '(scrollView.alwaysBounceHorizontal && !scrollView.alwaysBounceVertical)',
      'contentSize.width > boundsSize.width + 1.0',
      'contentSize.height <= boundsSize.height + 1.0',
      'if (!horizontalOnly) return scrollView;',
      'while (head < queue.count && visited < kLilBotMaxVisitedViews)',
      'if (queue.count >= kLilBotMaxVisitedViews) break;'
    ]) {
      expect(src).toContain(guard)
    }
    expect(src.match(/if \(@available\(iOS 26\.0, \*\)\)/g)?.length).toBeGreaterThanOrEqual(2)

    for (const forbidden of ['method_exchangeImplementations', 'class_replaceMethod', 'method_setImplementation', 'NSSelectorFromString', 'performSelector', 'valueForKey:']) {
      expect(src).not.toContain(forbidden)
    }
    expect(src).not.toMatch(/@selector\(_/)
  })

  test.skipIf(hasIosNodeModules)('[CI only — without ios/node_modules] default loader throws clearly naming expo/config-plugins', () => {
    expect(() => withTabScrollMinimize({ name: 'LilBot Dev', slug: 'lilbot' })).toThrow(/expo\/config-plugins/)
  })

  test.skipIf(!hasIosNodeModules)('[local only — requires ios/node_modules] runs Expo xcodeproj mod end-to-end (on, idempotent, off)', async () => {
    const iosRequire = createRequire(join(iosRoot, 'package.json'))
    const { BaseMods, evalModsAsync } = iosRequire('expo/config-plugins') as {
      BaseMods: { withIosBaseMods: (config: unknown, opts: { providers: Record<string, unknown> }) => unknown; getIosModFileProviders: () => { xcodeproj: unknown } }
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
