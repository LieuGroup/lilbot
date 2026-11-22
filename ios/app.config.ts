/** Build variants, picked with APP_VARIANT (like T3 Code), so a development, preview and
 *  production build install side by side on the same iPhone Duo. */
import type { ExpoConfig, ConfigContext } from 'expo/config'

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

export default ({ config }: ConfigContext): ExpoConfig => {
  const variant = variantName()
  const chosen = VARIANTS[variant]
  return {
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
      supportsTablet: true,
      infoPlist: {
        NSAppTransportSecurity: { NSAllowsArbitraryLoads: variant === 'development' }
      }
    },
    plugins: [
      'expo-router',
      ['expo-splash-screen', { image: './assets/images/splash-icon.png', resizeMode: 'contain', backgroundColor: '#f6f6f4' }]
    ],
    experiments: { typedRoutes: true }
  }
}
