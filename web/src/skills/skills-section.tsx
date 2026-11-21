import { SearchIcon } from 'lucide-react'
import { Fragment, useState } from 'react'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/ui/input-group'
import { matchesSkill, skillCount } from './skill-lines'
import { SkillRow } from './skill-row'
import { useSkillStore, useSkills } from './skill-store'

const hint = 'px-2 text-xs/4 text-muted-foreground'

/** The Setup tab's "Skills" section (Paper "17 Skills and webhooks" frames 1 and 3): the shared library with this bot's
 *  switch on each skill, and a search over names and descriptions. Bots write skills, so there is no form for one. */
export function SkillsSection({ botId, botName }: { botId: string; botName: string }) {
  const skills = useSkills(botId)
  const error = useSkillStore(state => state.errors[botId])
  const [query, setQuery] = useState('')
  const [failure, setFailure] = useState('')
  const shown = skills?.filter(skill => matchesSkill(skill, query)) ?? []
  return (
    <section aria-label="Skills" className="-mx-2 flex flex-col gap-2">
      <h3 className="flex justify-between px-2 text-xs/4 text-muted-foreground">
        <span>Skills</span>
        {skills && <span>{skillCount(skills, shown.length, query.trim() !== '')}</span>}
      </h3>
      {!skills ? (
        <p className={hint}>{error || 'Loading...'}</p>
      ) : (
        <>
          <InputGroup className="rounded-[10px] border-hairline bg-card dark:bg-card">
            <InputGroupAddon>
              <SearchIcon className="size-3.5" />
            </InputGroupAddon>
            <InputGroupInput
              type="search"
              aria-label="Find a skill"
              placeholder="Find a skill"
              value={query}
              onChange={event => setQuery(event.target.value)}
              className="md:text-[13px]"
            />
          </InputGroup>
          {shown.length > 0 ? (
            <div className="flex flex-col rounded-lg bg-card ring-1 ring-hairline">
              {shown.map((skill, index) => (
                <Fragment key={skill.name}>
                  {index > 0 && <div className="h-px bg-foreground/6" />}
                  <SkillRow botId={botId} botName={botName} skill={skill} onFailure={setFailure} />
                </Fragment>
              ))}
            </div>
          ) : (
            query.trim() && <p className="px-2 pt-2 pb-1 text-[13px]/5 break-words text-muted-foreground">No skill matches “{query.trim()}”. Ask a bot to write one.</p>
          )}
          {failure && <p className={`${hint} text-destructive`}>{failure}</p>}
          <p className={hint}>All bots share these skills. A switch here only affects {botName}, from its next session. Ask a bot in chat to write or improve one.</p>
        </>
      )}
    </section>
  )
}
