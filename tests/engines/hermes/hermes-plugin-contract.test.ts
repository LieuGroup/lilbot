/** The plug-in side of Hermes that LilBot's prompt plug-in relies on, read from the installed Hermes source:
 *  `llm_request` middleware, the enabled list that decides what loads, `plugins disable`, and the
 *  `pre_api_request` fields its observer reads. Skipped when Hermes is not installed. */
import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const CONTRACT = process.env.HERMES_CONTRACT ?? join(homedir(), '.hermes/hermes-agent/apps/shared/src/gateway-contract.openrpc.json')

describe.skipIf(!existsSync(CONTRACT))('Hermes plug-in contract', () => {
  test('Hermes plugin middleware contract (hermes.middleware.v1 / llm_request / register_middleware) remains declared', () => {
    const root = join(CONTRACT, '../../../..')
    const middlewarePy = readFileSync(join(root, 'hermes_cli/middleware.py'), 'utf8')
    const contextPy = readFileSync(join(root, 'hermes_cli/plugins_context.py'), 'utf8')
    expect(middlewarePy).toContain('MIDDLEWARE_SCHEMA_VERSION = "hermes.middleware.v1"')
    expect(middlewarePy).toContain('LLM_REQUEST_MIDDLEWARE = "llm_request"')
    expect(contextPy).toContain('def register_middleware(')
  })

  test('Hermes loads a plug-in only from plugins.enabled, disables it by name, and passes the request id and middleware trace to pre_api_request', () => {
    const root = join(CONTRACT, '../../../..')
    const read = (file: string) => readFileSync(join(root, file), 'utf8')
    expect(read('hermes_cli/plugins_discovery.py')).toContain('cfg_get(load_config(), "plugins", "enabled")')
    expect(read('hermes_cli/plugins_discovery.py')).toContain('"Skipping \'%s\' (not in plugins.enabled)"')
    expect(read('hermes_cli/plugins_cmd.py')).toContain('"disable": lambda args: cmd_disable(args.name)')
    expect(read('hermes_cli/plugins.py')).toContain('"pre_verify", "pre_api_request"')
    const request = read('agent/turn_api_request.py')
    for (const field of ['api_request_id=api_request_id', 'session_id=agent.session_id or ""', 'api_mode=agent.api_mode', 'middleware_trace=list(_llm_middleware_trace)'])
      expect(request).toContain(field)
    expect(read('hermes_cli/middleware.py')).toContain('for key in ("source", "reason", "name")')
  })
})
