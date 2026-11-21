import { useNavigate } from '@tanstack/react-router'
import { ChevronLeftIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/ui/button'
import { Fact } from '@/ui/fact'
import { lilbot, messageOf } from '../app/lilbot-socket'
import { useBotStore } from '../bots/bot-store'
import { sessionTime } from '../history/history-labels'
import type { BotSearch } from '../threads/open-thread'
import { SkillFileText } from './skill-file-text'
import { fileOrder, writtenBy } from './skill-lines'
import { SkillSwitch } from './skill-row'
import { useSkills } from './skill-store'

const note = 'px-2 text-xs/4 text-muted-foreground'

/** One skill, in place of the Setup tab's content (Paper "17 Skills and webhooks" frame 2): a "Skills" back row, the name,
 *  the full description and the bot's switch, who wrote it and when, then its files as tabs and the chosen one, read-only. */
export default function SkillDetail({ botId, name }: { botId: string; name: string }) {
  const navigate = useNavigate()
  const skills = useSkills(botId)
  const bots = useBotStore(state => state.bots)
  const skill = skills?.find(candidate => candidate.name === name)
  const files = useSkillFiles(botId, name, skill?.updatedAt)
  const [file, setFile] = useState('SKILL.md')
  const [failure, setFailure] = useState('')
  const botName = bots.find(bot => bot.id === botId)?.name ?? 'this bot'
  const paths = files.data ? fileOrder(Object.keys(files.data)) : []
  const shown = files.data && file in files.data ? file : paths[0]
  return (
    <div className="flex flex-col gap-3 px-3 pt-1 pb-6">
      <Button
        variant="ghost"
        className="h-7 gap-1 self-start rounded-md px-1 text-[13px]/[18px] font-medium hover:bg-foreground/4"
        onClick={() => void navigate({ to: '.', search: ({ skill: _closed, ...rest }: BotSearch) => rest })}
      >
        <ChevronLeftIcon className="size-4" strokeWidth={1.75} />
        Skills
      </Button>
      {!skill ? (
        <p className={note}>{skills ? 'This skill is no longer in the library.' : 'Loading...'}</p>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-start gap-3 px-2">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <h3 className="text-base/[22px] font-semibold tracking-[-0.01em] break-words">{skill.name}</h3>
                <p className="text-[13px]/5 break-words text-muted-foreground">{skill.description}</p>
              </div>
              <span className="flex h-[22px] items-center">
                <SkillSwitch botId={botId} skill={skill} onFailure={setFailure} />
              </span>
            </div>
            {failure && <p className={`${note} text-destructive`}>{failure}</p>}
          </div>
          <dl className="flex flex-col rounded-lg bg-card ring-1 ring-hairline">
            <Fact label="Written by" value={writtenBy(skill.origin, id => bots.find(bot => bot.id === id)?.name)} />
            <Fact label="Last changed" value={sessionTime(skill.updatedAt)} />
            <Fact label={`For ${botName}`} value={skill.enabled ? 'On' : 'Off'} />
          </dl>
          {files.error && <p className={`${note} text-destructive`}>{files.error}</p>}
          {files.data && shown !== undefined && (
            <>
              <div role="tablist" aria-label="Files" className="flex flex-wrap gap-0.5 px-1">
                {paths.map(path => (
                  <button
                    key={path}
                    type="button"
                    role="tab"
                    aria-selected={path === shown}
                    onClick={() => setFile(path)}
                    className={`max-w-full truncate rounded-full px-2.5 py-1 font-mono text-xs/4 outline-none focus-visible:ring-2 focus-visible:ring-ring ${path === shown ? 'bg-foreground/6' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    {path}
                  </button>
                ))}
              </div>
              <div role="tabpanel" className="rounded-lg bg-card p-3 ring-1 ring-hairline">
                <SkillFileText path={shown} text={files.data[shown]} />
              </div>
            </>
          )}
          <p className={note}>Read-only here. Ask a bot to change it.</p>
        </>
      )}
    </div>
  )
}

/** The skill's files (`skills.read`), read again when the skill changes. */
function useSkillFiles(botId: string, name: string, version: number | undefined) {
  const [files, setFiles] = useState<{ data?: Record<string, string>; error?: string }>({})
  useEffect(() => {
    if (version === undefined) return
    let cancelled = false
    lilbot
      .call('skills.read', { botId, name })
      .then(data => !cancelled && setFiles({ data }))
      .catch(error => !cancelled && setFiles({ error: messageOf(error) }))
    return () => {
      cancelled = true
    }
  }, [botId, name, version])
  return files
}
