/** One tool of LilBot's own MCP server. `run` receives the bot that made the call, taken from its key and
 *  never from the arguments, and the arguments as `input` checked them: keys the schema does not name are
 *  dropped, so no argument can claim another identity. */
import { z } from 'zod'

export interface McpTool {
  name: string
  description: string
  input: z.ZodType
  /** Reads change nothing; every other tool is logged as a change made by the calling bot. */
  readOnly: boolean
  run: (caller: string, args: any) => Promise<unknown>
}

const define =
  (readOnly: boolean) =>
  <S extends z.ZodType>(name: string, description: string, input: S, run: (caller: string, args: z.output<S>) => Promise<unknown>): McpTool => ({
    name,
    description,
    input,
    readOnly,
    run
  })

export const readTool = define(true)
export const actionTool = define(false)

/** The tool's argument schema as MCP wants it, without the parts that only cost tokens. */
export function inputSchema(input: z.ZodType): Record<string, unknown> {
  const { $schema, additionalProperties, ...schema } = z.toJSONSchema(input, { io: 'input', target: 'draft-7' }) as Record<string, unknown>
  return schema
}
