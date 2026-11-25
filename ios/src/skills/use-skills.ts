/** Live skills hook (`skills.list` + `skills.changed`) with monotonic sequence guard and per-bot switch. */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Skill } from '../../../shared/skills-schema'
import { messageOf } from '../../../shared/client/socket'
import { ensureSocket } from '../connection/lilbot'
import { useConnectionStore } from '../connection/store'

export function useSkills(botId: string) {
  const connected = useConnectionStore(state => state.connected)
  const [skills, setSkills] = useState<Skill[] | null>(null)
  const [error, setError] = useState('')
  const loadSeqRef = useRef(0)

  const load = useCallback(async () => {
    const socket = ensureSocket()
    if (!socket || !connected) return
    const seq = ++loadSeqRef.current
    try {
      const next = await socket.call('skills.list', { botId })
      if (seq !== loadSeqRef.current) return
      setSkills(next)
      setError('')
    } catch (failure) {
      if (seq !== loadSeqRef.current) return
      setError(messageOf(failure))
    }
  }, [botId, connected])

  useEffect(() => {
    loadSeqRef.current += 1
    setSkills(null)
    void load()
    const socket = ensureSocket()
    if (!socket) return
    return socket.onSkillsChanged(() => void load())
  }, [load])

  const setEnabled = useCallback(
    async (name: string, enabled: boolean) => {
      const socket = ensureSocket()
      if (!socket) return
      setSkills(prev => prev?.map(s => (s.name === name ? { ...s, enabled } : s)) ?? null)
      try {
        await socket.call('skills.setEnabled', { botId, name, enabled })
      } catch (failure) {
        setSkills(prev => prev?.map(s => (s.name === name ? { ...s, enabled: !enabled } : s)) ?? null)
        throw failure
      }
    },
    [botId]
  )

  return { skills, error, setEnabled }
}
