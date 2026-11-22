/** Runs `connectionPreparer.prepare` through `applied()` and returns whether MCP servers actually changed or
 *  reconnected (never just whether `applied()` ran because another setting touched `config.yaml`). */
import type { McpConnection } from '../mcp-connection'
import { applied, hashOf } from './hermes-applied'
import { type connectionPreparer, connectionTokenSteps, staleTokenNames } from './hermes-connections'

export async function prepareAppliedConnections(preparer: ReturnType<typeof connectionPreparer>, id: string, connections: McpConnection[], apply = applied): Promise<boolean> {
  let changed = false
  const run = async (steps: Record<string, string> | null) => {
    changed = await preparer.prepare(id, connections, { staleTokens: staleTokenNames(connections, steps) })
  }
  const ran = await apply(id, 'connections', hashOf('v2', connections), run, connectionTokenSteps(connections))
  if (!ran) {
    await apply(id, null, '', async () => {
      changed = await preparer.prepare(id, connections, true)
    })
  }
  return changed
}
