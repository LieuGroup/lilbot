import { useNavigate } from '@tanstack/react-router'
import { Switch } from '@/ui/switch'
import type { Skill } from '../../../shared/skills-schema'
import type { BotSearch } from '../threads/open-thread'
import { setSkillEnabled } from './skill-store'

/** One skill in the Setup tab's card: its name, its description on one line (or "Off for <bot>") and the bot's switch. The
 *  row opens the skill. */
export function SkillRow({ botId, botName, skill, onFailure }: { botId: string; botName: string; skill: Skill; onFailure: (text: string) => void }) {
  const navigate = useNavigate()
  return (
    <div className="flex items-center gap-3 pr-3 first:rounded-t-lg last:rounded-b-lg hover:bg-foreground/4">
      <button
        type="button"
        onClick={() => void navigate({ to: '.', search: (previous: BotSearch) => ({ ...previous, skill: skill.name }) })}
        className="flex min-w-0 flex-1 flex-col py-2.5 pl-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className={`truncate text-[13px]/[18px] font-medium ${skill.enabled ? '' : 'text-muted-foreground'}`}>{skill.name}</span>
        <span className="truncate text-xs/4 text-muted-foreground">{skill.enabled ? skill.description : `Off for ${botName}`}</span>
      </button>
      <SkillSwitch botId={botId} skill={skill} onFailure={onFailure} />
    </div>
  )
}

/** On while the bot is offered the skill. It saves at once; a refusal puts it back and says so. */
export function SkillSwitch({ botId, skill, onFailure }: { botId: string; skill: Skill; onFailure: (text: string) => void }) {
  const change = (on: boolean) => {
    onFailure('')
    setSkillEnabled(botId, skill.name, on).catch(() => onFailure(`Could not switch ${skill.name} ${on ? 'on' : 'off'}. Try again.`))
  }
  return <Switch checked={skill.enabled} onCheckedChange={change} aria-label={`${skill.name} for this bot`} />
}
