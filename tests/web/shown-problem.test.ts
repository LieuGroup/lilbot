import { expect, test } from 'bun:test'
import { shownProblem, shownProblemText } from '../../shared/shown-rules'

const line = (status: number) => shownProblemText(shownProblem(status), '50 MB', 'Engineer')

test('a shown file that did not draw is named by the route: gone (404), too large (413), or there but not drawable (200)', () => {
  expect(line(404)).toBe("No longer in Engineer's folder")
  expect(line(413)).toBe('Too large to show here (limit 50 MB)')
  expect(line(200)).toBe("Can't be shown here")
  // A failed HEAD (the network) is treated as gone, as before.
  expect(shownProblemText(shownProblem(0), '50 MB')).toBe("No longer in the bot's folder")
})
