import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { buildAppConfig, ENABLE_NESTED_TAB_SCROLL_MINIMIZE } from '../../ios/app.config'
import withTabScrollMinimizeDefault, { TAB_SCROLL_MINIMIZE_FILE, TAB_SCROLL_MINIMIZE_SOURCE, withTabScrollMinimize } from '../../ios/plugins/with-tab-scroll-minimize'

const iosRequire = createRequire(resolve(process.cwd(), 'ios/package.json'))
const { BaseMods, evalModsAsync } = iosRequire('expo/config-plugins') as {
  BaseMods: {
    withIosBaseMods: (config: unknown, opts: { providers: Record<string, unknown> }) => unknown
    getIosModFileProviders: () => { xcodeproj: unknown }
  }
  evalModsAsync: (config: unknown, opts: { projectRoot: string; platforms: string[] }) => Promise<unknown>
}

const tempDirs: string[] = []

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
  const iosDir = join(projectRoot, 'ios')
  const sourceDir = join(iosDir, projectName)
  const xcodeprojDir = join(iosDir, `${projectName}.xcodeproj`)
  mkdirSync(sourceDir, { recursive: true })
  mkdirSync(xcodeprojDir, { recursive: true })
  writeFileSync(join(sourceDir, 'AppDelegate.swift'), '// synthetic app delegate\n', 'utf8')
  const pbxprojPath = join(xcodeprojDir, 'project.pbxproj')
  const pbxproj = `// !$*UTF8*$!
{
\tarchiveVersion = 1;
\tclasses = {
\t};
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
\t\t13B07FAE1A68108700A75B9A /* ${projectName} */ = {
\t\t\tisa = PBXGroup;
\t\t\tchildren = (
\t\t\t\t13B07FB01A68108700A75B9A /* AppDelegate.swift */,
\t\t\t);
\t\t\tname = ${projectName};
\t\t\tsourceTree = "<group>";
\t\t};
\t\t83CBB9F61A601CBA00E9B192 = {
\t\t\tisa = PBXGroup;
\t\t\tchildren = (
\t\t\t\t13B07FAE1A68108700A75B9A /* ${projectName} */,
\t\t\t);
\t\t\tsourceTree = "<group>";
\t\t};
/* End PBXGroup section */
/* Begin PBXNativeTarget section */
\t\t13B07F861A680F5B00A75B9A /* ${projectName} */ = {
\t\t\tisa = PBXNativeTarget;
\t\t\tbuildPhases = (
\t\t\t\t13B07F871A680F5B00A75B9A /* Sources */,
\t\t\t);
\t\t\tname = ${projectName};
\t\t\tproductName = ${projectName};
\t\t\tproductReference = 13B07F961A680F5B00A75B9A /* ${projectName}.app */;
\t\t\tproductType = "com.apple.product-type.application";
\t\t};
/* End PBXNativeTarget section */
/* Begin PBXProject section */
\t\t83CBB9F71A601CBA00E9B192 /* Project object */ = {
\t\t\tisa = PBXProject;
\t\t\tmainGroup = 83CBB9F61A601CBA00E9B192;
\t\t\ttargets = (
\t\t\t\t13B07F861A680F5B00A75B9A /* ${projectName} */,
\t\t\t);
\t\t};
/* End PBXProject section */
/* Begin PBXSourcesBuildPhase section */
\t\t13B07F871A680F5B00A75B9A /* Sources */ = {
\t\t\tisa = PBXSourcesBuildPhase;
\t\t\tbuildActionMask = 2147483647;
\t\t\tfiles = (
\t\t\t\t13B07FBC1A68108700A75B9A /* AppDelegate.swift in Sources */,
\t\t\t);
\t\t\trunOnlyForDeploymentPostprocessing = 0;
\t\t};
/* End PBXSourcesBuildPhase section */
\t};
\trootObject = 83CBB9F71A601CBA00E9B192 /* Project object */;
}
`
  writeFileSync(pbxprojPath, pbxproj, 'utf8')
  return { projectRoot, pbxprojPath, sourceDir }
}

function makeConfigContext(projectRoot: string) {
  return { config: {}, projectRoot, staticConfigPath: null, packageJsonPath: join(projectRoot, 'package.json') }
}

function applyConfiguredPlugin(config: ReturnType<typeof buildAppConfig>) {
  return config.plugins?.includes('./plugins/with-tab-scroll-minimize') ? withTabScrollMinimizeDefault(config) : config
}

async function runXcodeprojMod(config: ReturnType<typeof buildAppConfig>, projectRoot: string) {
  const withBase = BaseMods.withIosBaseMods(applyConfiguredPlugin(config), {
    providers: { xcodeproj: BaseMods.getIosModFileProviders().xcodeproj }
  })
  return evalModsAsync(withBase, { projectRoot, platforms: ['ios'] })
}

describe('withTabScrollMinimize config plugin', () => {
  test('registers the plugin in app.config.ts when on and injects LilBotTabScrollMinimize.m into disk and pbxproj', async () => {
    const { projectRoot, pbxprojPath, sourceDir } = createSyntheticIosProject()
    const config = buildAppConfig(makeConfigContext(projectRoot), { enableTabScrollMinimize: true })
    expect(config.plugins).toContain('./plugins/with-tab-scroll-minimize')

    await runXcodeprojMod(config, projectRoot)

    const nativePath = join(sourceDir, TAB_SCROLL_MINIMIZE_FILE)
    expect(existsSync(nativePath)).toBe(true)
    expect(readFileSync(nativePath, 'utf8')).toBe(TAB_SCROLL_MINIMIZE_SOURCE)

    const pbxproj = readFileSync(pbxprojPath, 'utf8')
    expect(pbxproj).toContain(`LilBotDev/${TAB_SCROLL_MINIMIZE_FILE}`)
    expect(pbxproj).toContain(`${TAB_SCROLL_MINIMIZE_FILE} in Sources`)
  })

  test('is idempotent when prebuild runs twice', async () => {
    const { projectRoot, pbxprojPath } = createSyntheticIosProject()
    await runXcodeprojMod(buildAppConfig(makeConfigContext(projectRoot), { enableTabScrollMinimize: true }), projectRoot)
    const afterFirst = readFileSync(pbxprojPath, 'utf8')
    await runXcodeprojMod(buildAppConfig(makeConfigContext(projectRoot), { enableTabScrollMinimize: true }), projectRoot)
    const afterSecond = readFileSync(pbxprojPath, 'utf8')

    expect(afterSecond).toBe(afterFirst)
    // One PBXBuildFile entry plus one PBXSourcesBuildPhase entry = 2 mentions for one compiled file.
    const sourceEntries = afterSecond.match(new RegExp(`${TAB_SCROLL_MINIMIZE_FILE} in Sources`, 'g')) ?? []
    expect(sourceEntries.length).toBe(2)
  })

  test('omits the plugin, native file, and xcodeproj mod completely when switched off', async () => {
    const { projectRoot, pbxprojPath, sourceDir } = createSyntheticIosProject()
    const originalPbxproj = readFileSync(pbxprojPath, 'utf8')
    const prevTeam = process.env.APPLE_TEAM_ID
    const prevProfile = process.env.IOS_PROVISIONING_PROFILE_NAME
    delete process.env.APPLE_TEAM_ID
    delete process.env.IOS_PROVISIONING_PROFILE_NAME
    try {
      const config = buildAppConfig(makeConfigContext(projectRoot), { enableTabScrollMinimize: false })
      expect(config.plugins).not.toContain('./plugins/with-tab-scroll-minimize')
      expect((config as { mods?: { ios?: { xcodeproj?: unknown } } }).mods?.ios?.xcodeproj).toBeUndefined()

      await runXcodeprojMod(config, projectRoot)

      expect(existsSync(join(sourceDir, TAB_SCROLL_MINIMIZE_FILE))).toBe(false)
      expect(readFileSync(pbxprojPath, 'utf8')).toBe(originalPbxproj)
    } finally {
      if (prevTeam !== undefined) process.env.APPLE_TEAM_ID = prevTeam
      if (prevProfile !== undefined) process.env.IOS_PROVISIONING_PROFILE_NAME = prevProfile
    }
  })

  test('withTabScrollMinimize({ enabled: false }) returns config untouched by reference', () => {
    const base = { name: 'LilBot Dev', slug: 'lilbot' }
    expect(withTabScrollMinimize(base, { enabled: false })).toBe(base)
  })

  test('app.config.ts enables the single switch by default', () => {
    expect(ENABLE_NESTED_TAB_SCROLL_MINIMIZE).toBe(true)
  })

  test('Objective-C source enforces fail-safe, public-API-only, and issue-tracking invariants', () => {
    expect(TAB_SCROLL_MINIMIZE_SOURCE).toContain('software-mansion/react-native-screens#4145')
    expect(TAB_SCROLL_MINIMIZE_SOURCE).toContain('class_addMethod(')
    expect(TAB_SCROLL_MINIMIZE_SOURCE).toContain('objc_msgSendSuper')
    expect(TAB_SCROLL_MINIMIZE_SOURCE).toContain('NSDirectionalRectEdgeBottom')
    expect(TAB_SCROLL_MINIMIZE_SOURCE).toContain('UITabBarMinimizeBehaviorNever')
    expect(TAB_SCROLL_MINIMIZE_SOURCE).toContain('UITextView.class')
    expect(TAB_SCROLL_MINIMIZE_SOURCE).toContain('layer.transform.m22 < 0.0')
    expect(TAB_SCROLL_MINIMIZE_SOURCE).toContain('kLilBotMaxVisitedViews')
    expect(TAB_SCROLL_MINIMIZE_SOURCE).not.toContain('method_exchangeImplementations')
    expect(TAB_SCROLL_MINIMIZE_SOURCE).not.toContain('class_replaceMethod')
    expect(TAB_SCROLL_MINIMIZE_SOURCE).not.toMatch(/#import\s+["<]RNS/)
    expect(TAB_SCROLL_MINIMIZE_SOURCE).not.toMatch(/@selector\(_/)
  })
})
