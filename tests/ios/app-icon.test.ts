/** The iPhone app icon: one layered Icon Composer document per build variant, with development and preview marked. */
import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const iosRoot = resolve(process.cwd(), 'ios')
const appConfig = readFileSync(join(iosRoot, 'app.config.ts'), 'utf8')

type IconDocument = { groups: { name?: string; layers: { 'image-name': string }[] }[]; 'fill-specializations': { appearance?: string }[] }

const VARIANTS = [
  { variant: 'development', file: 'LilBotDev.icon', marked: true },
  { variant: 'preview', file: 'LilBotPreview.icon', marked: true },
  { variant: 'production', file: 'LilBot.icon', marked: false }
]

describe('iPhone app icon', () => {
  for (const { variant, file, marked } of VARIANTS) {
    test(`${variant} uses ${file}, with every layer image present`, () => {
      expect(appConfig).toMatch(new RegExp(`${variant}: \\{[^}]*icon: './assets/icons/${file}'`))
      const dir = join(iosRoot, 'assets', 'icons', file)
      const doc = JSON.parse(readFileSync(join(dir, 'icon.json'), 'utf8')) as IconDocument
      for (const group of doc.groups) for (const layer of group.layers) expect(existsSync(join(dir, 'Assets', layer['image-name']))).toBe(true)
      expect(doc['fill-specializations'].map(fill => fill.appearance ?? 'light')).toEqual(['light', 'dark'])
      expect(doc.groups.some(group => group.name === 'Variant')).toBe(marked)
    })
  }

  test('the layered icon is set on the iOS config, where Expo reads .icon documents', () => {
    expect(appConfig).toContain('icon: chosen.icon')
  })
})
