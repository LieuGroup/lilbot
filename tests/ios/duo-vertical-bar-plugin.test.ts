/** Tests for the iOS 27.1+ Duo vertical-preferred bar-item Expo config plugin.
 *
 *  Coverage split (GitHub CI installs root dependencies only, not `ios/node_modules`):
 *  - `[CI + local]`: plugin on/off injection + default export, single switch in `ios/app.config.ts` +
 *    `ios/AGENTS.md` note + prefix parity with `ios/src/duo/vertical-bar.ts`, and Obj-C availability / public-API guards.
 *  - `[CI only — without ios/node_modules]`: calling default loader without `expo/config-plugins` throws cleanly.
 *  - `[local only — requires ios/node_modules]`: runs full Expo `xcodeproj` mod pipeline (on, idempotent, off). */
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import withDuoVerticalBarDefault, {
  DUO_VERTICAL_BAR_FILE,
  DUO_VERTICAL_BAR_SOURCE,
  type DuoVerticalBarConfig,
  DUO_VERTICAL_ITEM_PREFIX as PLUGIN_PREFIX,
  type WithBuildSourceFile,
  withDuoVerticalBar
} from '../../ios/plugins/with-duo-vertical-bar'
import { DUO_VERTICAL_ITEM_PREFIX } from '../../ios/src/duo/vertical-bar'

const tempDirs: string[] = []
const iosRoot = resolve(process.cwd(), 'ios')
const hasIosNodeModules = existsSync(join(iosRoot, 'node_modules', 'expo', 'config-plugins.js'))

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function createSyntheticIosProject(projectName = 'LilBotDev') {
  const projectRoot = mkdtempSync(join(tmpdir(), 'lilbot-duo-bar-plugin-'))
  tempDirs.push(projectRoot)
  const sourceDir = join(projectRoot, 'ios', projectName)
  const xcodeprojDir = join(projectRoot, 'ios', `${projectName}.xcodeproj`)
  mkdirSync(sourceDir, { recursive: true })
  mkdirSync(xcodeprojDir, { recursive: true })
  writeFileSync(join(sourceDir, 'AppDelegate.swift'), '// synthetic app delegate\n', 'utf8')
  const pbxprojPath = join(xcodeprojDir, 'project.pbxproj')
  const pbxproj = `// !$*UTF8*$!\n{\n\tarchiveVersion = 1;\n\tclasses = {};\n\tobjectVersion = 54;\n\tobjects = {\n/* Begin PBXBuildFile section */\n\t\t13B07FBC1A68108700A75B9A /* AppDelegate.swift in Sources */ = {isa = PBXBuildFile; fileRef = 13B07FB01A68108700A75B9A /* AppDelegate.swift */; };\n/* End PBXBuildFile section */\n/* Begin PBXFileReference section */\n\t\t13B07F961A680F5B00A75B9A /* ${projectName}.app */ = {isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = ${projectName}.app; sourceTree = BUILT_PRODUCTS_DIR; };\n\t\t13B07FB01A68108700A75B9A /* AppDelegate.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; name = AppDelegate.swift; path = ${projectName}/AppDelegate.swift; sourceTree = "<group>"; };\n/* End PBXFileReference section */\n/* Begin PBXGroup section */\n\t\t13B07FAE1A68108700A75B9A /* ${projectName} */ = { isa = PBXGroup; children = ( 13B07FB01A68108700A75B9A /* AppDelegate.swift */, ); name = ${projectName}; sourceTree = "<group>"; };\n\t\t83CBB9F61A601CBA00E9B192 = { isa = PBXGroup; children = ( 13B07FAE1A68108700A75B9A /* ${projectName} */, ); sourceTree = "<group>"; };\n/* End PBXGroup section */\n/* Begin PBXNativeTarget section */\n\t\t13B07F861A680F5B00A75B9A /* ${projectName} */ = { isa = PBXNativeTarget; buildPhases = ( 13B07F871A680F5B00A75B9A /* Sources */, ); name = ${projectName}; productName = ${projectName}; productReference = 13B07F961A680F5B00A75B9A /* ${projectName}.app */; productType = "com.apple.product-type.application"; };\n/* End PBXNativeTarget section */\n/* Begin PBXProject section */\n\t\t83CBB9F71A601CBA00E9B192 /* Project object */ = { isa = PBXProject; mainGroup = 83CBB9F61A601CBA00E9B192; targets = ( 13B07F861A680F5B00A75B9A /* ${projectName} */, ); };\n/* End PBXProject section */\n/* Begin PBXSourcesBuildPhase section */\n\t\t13B07F871A680F5B00A75B9A /* Sources */ = { isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = ( 13B07FBC1A68108700A75B9A /* AppDelegate.swift in Sources */, ); runOnlyForDeploymentPostprocessing = 0; };\n/* End PBXSourcesBuildPhase section */\n\t};\n\trootObject = 83CBB9F71A601CBA00E9B192;\n}\n`
  writeFileSync(pbxprojPath, pbxproj, 'utf8')
  return { projectRoot, pbxprojPath, sourceDir }
}

describe('withDuoVerticalBar config plugin', () => {
  test('[CI + local] injects LilBotDuoVerticalBar.m when on, omits when off, and matches JS prefix', () => {
    expect(withDuoVerticalBarDefault).toBe(withDuoVerticalBar)
    expect(PLUGIN_PREFIX).toBe(DUO_VERTICAL_ITEM_PREFIX)
    const { sourceDir } = createSyntheticIosProject()
    const calls: Array<{ filePath: string; overwrite?: boolean }> = []
    const stubAddSourceFile: WithBuildSourceFile = (config, { filePath, contents, overwrite }) => {
      writeFileSync(join(sourceDir, filePath), contents, 'utf8')
      calls.push({ filePath, overwrite })
      return { ...config, injectedFile: filePath }
    }

    const base: DuoVerticalBarConfig = { name: 'LilBot Dev', slug: 'lilbot' }
    expect(withDuoVerticalBar(base, { enabled: false, withBuildSourceFile: stubAddSourceFile })).toBe(base)
    expect(calls).toEqual([])
    expect(existsSync(join(sourceDir, DUO_VERTICAL_BAR_FILE))).toBe(false)

    const enabledDefault = withDuoVerticalBar(base, { withBuildSourceFile: stubAddSourceFile })
    expect(enabledDefault.injectedFile).toBe(DUO_VERTICAL_BAR_FILE)
    expect(calls).toEqual([{ filePath: DUO_VERTICAL_BAR_FILE, overwrite: true }])
    expect(readFileSync(join(sourceDir, DUO_VERTICAL_BAR_FILE), 'utf8')).toBe(DUO_VERTICAL_BAR_SOURCE)
  })

  test('[CI + local] app.config.ts switch and ios/AGENTS.md note are intact', () => {
    const appConfigSource = readFileSync(join(iosRoot, 'app.config.ts'), 'utf8')
    expect(appConfigSource).toContain('export const ENABLE_DUO_VERTICAL_BAR_ITEMS = true')
    expect(appConfigSource).toContain('const enableDuoVerticalBar = options.enableDuoVerticalBar ?? ENABLE_DUO_VERTICAL_BAR_ITEMS')
    expect(appConfigSource).toContain("...(enableDuoVerticalBar ? ['./plugins/with-duo-vertical-bar'] : [])")

    const agentsDoc = readFileSync(join(iosRoot, 'AGENTS.md'), 'utf8')
    expect(agentsDoc).toContain('with-duo-vertical-bar.ts')
    expect(agentsDoc).toContain('DUO_VERTICAL_BAR_TABLE')
  })

  test('[CI + local] Objective-C source enforces iOS 27.1+ availability, public API only, and zero swizzling', () => {
    const src = DUO_VERTICAL_BAR_SOURCE
    const imports = [...src.matchAll(/^\s*#(?:import|include)\s+(.+)$/gm)].map(m => m[1].trim())
    expect(imports).toEqual(['<UIKit/UIKit.h>', '<objc/message.h>', '<objc/runtime.h>'])

    for (const guard of [
      'defined(__IPHONE_27_1)',
      '__IPHONE_OS_VERSION_MAX_ALLOWED >= __IPHONE_27_1',
      'if (@available(iOS 27.1, *))',
      'if (cls == Nil || ![cls isSubclassOfClass:UIBarButtonItem.class]) return;',
      'class_addMethod(cls, selector, (IMP)LilBotBarButtonSetIdentifier, types)',
      'objc_msgSendSuper',
      '[identifier hasPrefix:kLilBotDuoVerticalPrefix]',
      'self.axisBehavior = UIBarButtonItemAxisBehaviorVerticalPreferred;'
    ]) {
      expect(src).toContain(guard)
    }
    expect(src.match(/if \(@available\(iOS 27\.1, \*\)\)/g)?.length).toBeGreaterThanOrEqual(2)

    for (const forbidden of ['method_exchangeImplementations', 'class_replaceMethod', 'method_setImplementation', 'NSSelectorFromString', 'performSelector', 'valueForKey:']) {
      expect(src).not.toContain(forbidden)
    }
    expect(src).not.toMatch(/@selector\(_/)
  })

  test.skipIf(hasIosNodeModules)('[CI only — without ios/node_modules] default loader throws clearly naming expo/config-plugins', () => {
    expect(() => withDuoVerticalBar({ name: 'LilBot Dev', slug: 'lilbot' })).toThrow(/expo\/config-plugins/)
  })

  test.skipIf(!hasIosNodeModules)('[local only — requires ios/node_modules] runs Expo xcodeproj mod end-to-end (on, idempotent, off)', async () => {
    const iosRequire = createRequire(join(iosRoot, 'package.json'))
    const { BaseMods, evalModsAsync } = iosRequire('expo/config-plugins') as {
      BaseMods: { withIosBaseMods: (config: unknown, opts: { providers: Record<string, unknown> }) => unknown; getIosModFileProviders: () => { xcodeproj: unknown } }
      evalModsAsync: (config: unknown, opts: { projectRoot: string; platforms: string[] }) => Promise<unknown>
    }
    const appConfigMod = (await import(pathToFileURL(join(iosRoot, 'app.config.ts')).href)) as {
      ENABLE_DUO_VERTICAL_BAR_ITEMS: boolean
      buildAppConfig: (
        ctx: { config: Record<string, unknown>; projectRoot: string; staticConfigPath: null; packageJsonPath: string },
        opts?: { enableDuoVerticalBar?: boolean }
      ) => DuoVerticalBarConfig & { mods?: { ios?: { xcodeproj?: unknown } } }
    }
    expect(appConfigMod.ENABLE_DUO_VERTICAL_BAR_ITEMS).toBe(true)

    const runPipeline = async (projectRoot: string, enableDuoVerticalBar: boolean) => {
      const cfg = appConfigMod.buildAppConfig({ config: {}, projectRoot, staticConfigPath: null, packageJsonPath: join(projectRoot, 'package.json') }, { enableDuoVerticalBar })
      const applied = cfg.plugins?.includes('./plugins/with-duo-vertical-bar') ? withDuoVerticalBar(cfg) : cfg
      const withBase = BaseMods.withIosBaseMods(applied, { providers: { xcodeproj: BaseMods.getIosModFileProviders().xcodeproj } })
      await evalModsAsync(withBase, { projectRoot, platforms: ['ios'] })
      return cfg
    }

    const enabledProj = createSyntheticIosProject()
    const enabledCfg = await runPipeline(enabledProj.projectRoot, true)
    expect(enabledCfg.plugins).toContain('./plugins/with-duo-vertical-bar')
    expect(readFileSync(join(enabledProj.sourceDir, DUO_VERTICAL_BAR_FILE), 'utf8')).toBe(DUO_VERTICAL_BAR_SOURCE)
    const afterFirst = readFileSync(enabledProj.pbxprojPath, 'utf8')
    expect(afterFirst).toContain(`LilBotDev/${DUO_VERTICAL_BAR_FILE}`)
    expect(afterFirst).toContain(`${DUO_VERTICAL_BAR_FILE} in Sources`)

    await runPipeline(enabledProj.projectRoot, true)
    expect(readFileSync(enabledProj.pbxprojPath, 'utf8')).toBe(afterFirst)

    const disabledProj = createSyntheticIosProject()
    const originalPbxproj = readFileSync(disabledProj.pbxprojPath, 'utf8')
    const disabledCfg = await runPipeline(disabledProj.projectRoot, false)
    expect(disabledCfg.plugins).not.toContain('./plugins/with-duo-vertical-bar')
    expect(disabledCfg.mods?.ios?.xcodeproj).toBeUndefined()
    expect(existsSync(join(disabledProj.sourceDir, DUO_VERTICAL_BAR_FILE))).toBe(false)
    expect(readFileSync(disabledProj.pbxprojPath, 'utf8')).toBe(originalPbxproj)
  })
})
