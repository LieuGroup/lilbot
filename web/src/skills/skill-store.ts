/** The skills library as each bot on screen sees it (`skills.list`), kept fresh by `skills.changed` and reconnects while
 *  the Setup tab or a skill shows it. Skills an engine's switch excludes are not part of the library, so they are left out. */
import { useEffect } from 'react'
import { create } from 'zustand'
import type { Skill } from '../../../shared/skills-schema'
import { lilbot, messageOf } from '../app/lilbot-socket'
import { watchedReads } from '../app/watched-reads'

interface SkillStore {
  byBot: Record<string, Skill[]>
  /** Why the last read failed; the list read before it stays. */
  errors: Record<string, string>
}

export const useSkillStore = create<SkillStore>(() => ({ byBot: {}, errors: {} }))

async function load(botId: string) {
  try {
    const skills = (await lilbot.call('skills.list', { botId })).filter(skill => !skill.excluded)
    useSkillStore.setState(state => ({ byBot: { ...state.byBot, [botId]: skills }, errors: { ...state.errors, [botId]: '' } }))
  } catch (error) {
    useSkillStore.setState(state => ({ errors: { ...state.errors, [botId]: messageOf(error) } }))
  }
}

const watch = watchedReads(load, [listener => lilbot.onSkillsChanged(listener)])

/** The library for this bot, by name; undefined until the first read. */
export function useSkills(botId: string) {
  useEffect(() => watch(botId), [botId])
  return useSkillStore(state => state.byBot[botId])
}

/** Switches a skill for this bot; the list shows it at once, and a refusal puts it back. */
export async function setSkillEnabled(botId: string, name: string, enabled: boolean) {
  const swap = (value: boolean) =>
    useSkillStore.setState(state => ({
      byBot: { ...state.byBot, [botId]: (state.byBot[botId] ?? []).map(skill => (skill.name === name ? { ...skill, enabled: value } : skill)) }
    }))
  swap(enabled)
  try {
    await lilbot.call('skills.setEnabled', { botId, name, enabled })
  } catch (error) {
    swap(!enabled)
    throw error
  }
}
