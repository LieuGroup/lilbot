/** Registered Settings sections.
 *  Feature threads add their own section file in `ios/src/settings/sections/` and append it here
 *  (order slots: 10 = Computers, 20 = Notifications, 30 = Memory, 40 = General) without touching
 *  `settings/screen.tsx` or any Expo Router file. Any section with `routeName` + `DetailScreen`
 *  automatically gets a pushed native Stack screen at `/(settings)/<routeName>`. */
import type { SettingsSectionDefinition } from '../sections'
import { computersSettingsSection } from './computers-section'
import { generalSettingsSection } from './general-section'
import { memorySettingsSection } from './memory-section'

export const SETTINGS_SECTIONS: readonly SettingsSectionDefinition[] = [computersSettingsSection, memorySettingsSection, generalSettingsSection]
