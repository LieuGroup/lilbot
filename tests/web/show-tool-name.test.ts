import { expect, test } from 'bun:test'
import { isShowTool } from '../../shared/shown-rules'

test("only LilBot's own lilbot_show is hidden; another server's tool of the same name stays drawn", () => {
  expect(isShowTool('lilbot_show')).toBe(true)
  expect(isShowTool('mcp__lilbot_system__lilbot_show')).toBe(true)
  for (const other of ['mcp__someone_else__lilbot_show', 'evil__lilbot_show', 'lilbot_show_more', 'mcp__lilbot_system__lilbot_give_file', 'tool_call'])
    expect(isShowTool(other)).toBe(false)
})
