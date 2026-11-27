/** Pure Settings section registry types and ordering helpers (zero React Native imports so Linux tests
 *  can verify section ordering, filtering, and sub-route lookup without a UI runtime).
 *  Feature threads (e.g. LILA-53 Notifications, LILA-54 Memory) add a section file under `sections/`
 *  and register it in `sections/index.ts` without editing `settings/screen.tsx` or any router file. */
import type { ComponentType } from 'react'

export type SettingsSectionGroup = 'navigation' | 'inline'

export interface SettingsSectionProps {
  /** Pushes `/(settings)/<routeName>` inside the Settings native Stack. */
  navigate: (routeName: string) => void
  /** True when the app currently has a live server connection. */
  connected: boolean
}

export interface SettingsSectionDefinition {
  /** Stable unique section id (e.g. 'computers', 'notifications', 'memory', 'general'). */
  id: string
  /** Display order within its group (10 = Computers, 20 = Notifications, 30 = Memory, 40 = General). */
  order: number
  /** 'navigation' sections share a grouped nav card; 'inline' sections render their own grouped card. */
  group: SettingsSectionGroup
  /** Whether to show before a server URL is configured (first-run AppGate). Defaults to false. */
  showBeforeSetup?: boolean
  /** Optional detail route name served automatically by `app/(tabs)/(settings)/[section].tsx`. */
  routeName?: string
  /** Title shown in the native Stack header when `routeName` is pushed. */
  routeTitle?: string
  /** Row or inline section rendered on the main Settings screen. */
  Component: ComponentType<SettingsSectionProps>
  /** Optional pushed screen component rendered by `app/(tabs)/(settings)/[section].tsx`. */
  DetailScreen?: ComponentType
}

export function visibleSettingsSections(
  sections: readonly SettingsSectionDefinition[],
  options: { hasServer: boolean; group?: SettingsSectionGroup }
): SettingsSectionDefinition[] {
  return sections
    .filter(section => (options.hasServer || Boolean(section.showBeforeSetup)) && (!options.group || section.group === options.group))
    .slice()
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
}

export function findSettingsSectionRoute(sections: readonly SettingsSectionDefinition[], routeName: string | undefined): SettingsSectionDefinition | null {
  if (!routeName) return null
  return sections.find(section => section.routeName === routeName && section.DetailScreen) ?? null
}
