import { Link } from '@tanstack/react-router'
import type { ComponentProps } from 'react'

import { openBotMenu, pointAnchor } from './bot-menu-target'
import type { DetailsTab } from './details-tabs'

type Props = Omit<ComponentProps<'a'>, 'href'> & { botId: string; active: boolean; tab?: DetailsTab }

/** A link to a bot's screen from the roster, tiles or rail. Opening another bot keeps the details
 *  tab that is open. */
export function BotLink({ botId, active, tab, ...props }: Props) {
  const current = active ? ('page' as const) : undefined
  return tab ? (
    <Link to="/bots/$botId/$tab" params={{ botId, tab }} aria-current={current} {...props} />
  ) : (
    <Link to="/bots/$botId" params={{ botId }} aria-current={current} {...props} />
  )
}

/** Right-click opens the bot menu at the cursor. */
export const menuOnContext = (botId: string) => (event: React.MouseEvent) => {
  event.preventDefault()
  openBotMenu(botId, pointAnchor(event.clientX, event.clientY))
}
