/** Build variants, picked with APP_VARIANT (like T3 Code), so a development, preview and
 *  production build install side by side on the same iPhone Duo. */
import type { ConfigContext, ExpoConfig } from 'expo/config'
import { withXcodeProject } from 'expo/config-plugins'

const VARIANTS = {
  development: { name: 'LilBot Dev', bundleIdentifier: 'com.lilbot.app.dev', scheme: 'lilbot-dev' },
  preview: { name: 'LilBot Preview', bundleIdentifier: 'com.lilbot.app.preview', scheme: 'lilbot-preview' },
  production: { name: 'LilBot', bundleIdentifier: 'com.lilbot.app', scheme: 'lilbot' }
} as const

type Variant = keyof typeof VARIANTS

export function variantName(): Variant {
  const value = process.env.APP_VARIANT
  return value === 'preview' || value === 'production' ? value : 'development'
}

/** Applies release signing settings to the app target only (never Pods resource bundles),
 *  driven purely by environment variables so no Apple account identifiers live in git. */
function withReleaseSigning(config: ExpoConfig, bundleId: string): ExpoConfig {
  const teamId = process.env.APPLE_TEAM_ID?.trim()
  const profileName = process.env.IOS_PROVISIONING_PROFILE_NAME?.trim()
  const identity = process.env.IOS_CODE_SIGN_IDENTITY?.trim()
  if (!teamId && !profileName) return config
  return withXcodeProject(config, mod => {
    const configs = mod.modResults.pbxXCBuildConfigurationSection()
    for (const entry of Object.values(configs)) {
      if (!entry || typeof entry !== 'object' || !('buildSettings' in entry)) continue
      const record = entry as { name?: string; buildSettings: Record<string, string | undefined> }
      const settings = record.buildSettings
      const targetId = settings.PRODUCT_BUNDLE_IDENTIFIER?.replace(/^"|"$/g, '')
      if (targetId !== bundleId) continue
      if (teamId) settings.DEVELOPMENT_TEAM = teamId
      const configName = record.name?.replace(/^"|"$/g, '')
      if (profileName && configName === 'Release') {
        settings.CODE_SIGN_STYLE = 'Manual'
        settings.PROVISIONING_PROFILE_SPECIFIER = `"${profileName}"`
        if (identity) settings.CODE_SIGN_IDENTITY = `"${identity}"`
      }
    }
    return mod
  })
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const variant = variantName()
  const chosen = VARIANTS[variant]
  const base: ExpoConfig = {
    ...config,
    name: chosen.name,
    slug: 'lilbot',
    version: '0.1.0',
    orientation: 'default',
    icon: './assets/images/icon.png',
    scheme: chosen.scheme,
    userInterfaceStyle: 'automatic',
    ios: {
      bundleIdentifier: chosen.bundleIdentifier,
      buildNumber: process.env.APP_BUILD_NUMBER ?? '1',
      supportsTablet: true,
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
        NSAppTransportSecurity: { NSAllowsArbitraryLoads: variant === 'development' }
      }
    },
    plugins: [
      'expo-router',
      'expo-secure-store',
      ['expo-splash-screen', { image: './assets/images/splash-icon.png', resizeMode: 'contain', backgroundColor: '#f6f6f4' }]
    ],
    experiments: { typedRoutes: true }
  }
  return withReleaseSigning(base, chosen.bundleIdentifier)
}
