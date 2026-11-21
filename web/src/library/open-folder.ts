/** A workspace folder open in place of the details panel (`?folder=` on the Library tab). The parameter starts with "/"
 *  so the workspace itself is not empty ("/" is the workspace, "/raw" one folder in it). */
import { useNavigate } from '@tanstack/react-router'
import type { BotSearch } from '../threads/open-thread'

export const folderPath = (folder: string) => folder.replace(/^\/+/, '')

export function useFolderNavigation() {
  const navigate = useNavigate()
  return {
    open: (path: string) => navigate({ to: '.', search: (previous: BotSearch) => ({ ...previous, folder: `/${path}` }) }),
    close: () => navigate({ to: '.', search: ({ folder: _closed, ...rest }: BotSearch) => rest })
  }
}
