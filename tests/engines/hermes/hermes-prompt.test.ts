import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { hasHermesIdentityText } from '../../../server/engines/hermes/hermes-prompt'
import { HERMES_PROMPT_TUNING } from '../../../server/engines/hermes/hermes-prompt-tuning'
import { rollbackHook } from '../../../server/engines/hermes/hermes-rollback'

const dirs: string[] = []
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'lilbot-hermes-prompt-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const ADAPTER_PY = resolve(import.meta.dir, '../../../server/engines/hermes/prompt-adapter/__init__.py')

function runAdapterProbe(profileHome: string, calls: { request: Record<string, unknown>; api_mode: string; session_id: string }[]) {
  const script = `
import importlib.util, json, logging, sys
from pathlib import Path
records = []
class Capture(logging.Handler):
    def emit(self, r): records.append(r.getMessage())
plugin_file = Path(sys.argv[1])
calls = json.loads(sys.argv[2])
spec = importlib.util.spec_from_file_location("lilbot_prompt_v1", plugin_file)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
mod.logger.addHandler(Capture())
cb = None
class Ctx:
    def register_middleware(self, kind, fn):
        global cb
        assert kind == "llm_request"
        cb = fn
mod.register(Ctx())
out = [cb(c["request"], api_mode=c["api_mode"], session_id=c["session_id"]) for c in calls]
print(json.dumps({"results": out, "logs": records}))
`
  const pluginDir = join(profileHome, 'plugins', 'lilbot-prompt-v1')
  mkdirSync(pluginDir, { recursive: true })
  const copied = join(pluginDir, '__init__.py')
  writeFileSync(copied, readFileSync(ADAPTER_PY, 'utf8'))
  const proc = Bun.spawnSync(['python3', '-c', script, copied, JSON.stringify(calls)], { stdout: 'pipe', stderr: 'pipe' })
  if (proc.exitCode !== 0) throw new Error(proc.stderr.toString('utf8'))
  return JSON.parse(proc.stdout.toString('utf8')) as { results: Array<Record<string, any> | null>; logs: string[] }
}

describe('Hermes prompt tuning and pass-through middleware', () => {
  test('HERMES_PROMPT_TUNING carries runtime guidance with zero engine branding', () => {
    expect(HERMES_PROMPT_TUNING).toContain('tool_search')
    expect(HERMES_PROMPT_TUNING).toContain('$TMPDIR')
    expect(HERMES_PROMPT_TUNING).toContain('compaction')
    expect(HERMES_PROMPT_TUNING).not.toMatch(/\bhermes\b|\bnous\b/i)
  })

  test('hasHermesIdentityText detects leftover engine identity wording without false positives', () => {
    expect(hasHermesIdentityText('You are Hermes Agent, built by Nous Research.')).toBe(true)
    expect(hasHermesIdentityText('Built by Nous Research for research tasks.')).toBe(true)
    expect(hasHermesIdentityText('You are a helpful coding assistant in LilBot.')).toBe(false)
  })

  test('middleware swaps system prompt across wire formats and preserves cache_control / cachePoint', () => {
    const profile = tempDir()
    const promptFile = join(profile, 'owned.txt')
    writeFileSync(promptFile, 'LILBOT OWNED PROMPT', { mode: 0o600 })
    writeFileSync(join(profile, 'lilbot-prompt.json'), JSON.stringify({ botId: 'b1', promptFile }))

    const { results, logs } = runAdapterProbe(profile, [
      { api_mode: 'anthropic_messages', session_id: 's1', request: { system: 'OLD HERMES', messages: [{ role: 'user', content: 'hi' }] } },
      {
        api_mode: 'anthropic_messages',
        session_id: 's2',
        request: { system: [{ type: 'text', text: 'OLD', cache_control: { type: 'ephemeral' } }], messages: [] }
      },
      {
        api_mode: 'bedrock_converse',
        session_id: 's3',
        request: { system: [{ text: 'OLD' }, { cachePoint: { type: 'default' } }], messages: [] }
      },
      { api_mode: 'codex_responses', session_id: 's4', request: { instructions: 'OLD', input: [] } },
      {
        api_mode: 'openai_chat',
        session_id: 's5',
        request: {
          messages: [
            { role: 'system', content: 'OLD' },
            { role: 'user', content: 'hi' }
          ]
        }
      }
    ])

    expect(logs).toEqual([])
    expect(results[0]?.request.system).toBe('LILBOT OWNED PROMPT')
    expect(results[1]?.request.system).toEqual([{ type: 'text', text: 'LILBOT OWNED PROMPT', cache_control: { type: 'ephemeral' } }])
    expect(results[2]?.request.system).toEqual([{ text: 'LILBOT OWNED PROMPT' }, { cachePoint: { type: 'default' } }])
    expect(results[3]?.request.instructions).toBe('LILBOT OWNED PROMPT')
    expect(results[4]?.request.messages[0]).toEqual({ role: 'system', content: 'LILBOT OWNED PROMPT' })
  })

  test('middleware fails open with fixed-label warning when prompt file is missing or empty', () => {
    const profile = tempDir()
    const secretPath = join(profile, 'secret-bot-id-path.txt')
    writeFileSync(join(profile, 'lilbot-prompt.json'), JSON.stringify({ botId: 'b1', promptFile: secretPath }))

    const missing = runAdapterProbe(profile, [{ api_mode: 'anthropic_messages', session_id: 's-missing', request: { system: 'FALLBACK' } }])
    expect(missing.results[0]).toBeNull()
    expect(missing.logs[0]).toContain('lilbot-prompt:')
    expect(missing.logs[0]).not.toContain(secretPath)

    writeFileSync(secretPath, '   \n  ')
    const empty = runAdapterProbe(profile, [{ api_mode: 'anthropic_messages', session_id: 's-empty', request: { system: 'FALLBACK' } }])
    expect(empty.results[0]).toBeNull()
    expect(empty.logs[0]).toContain('prompt file empty')
    expect(empty.logs[0]).not.toContain(secretPath)
  })

  test('rollback disables plugins.entries.lilbot-prompt-v1.enabled on bound profiles', async () => {
    const calls: string[][] = []
    const values: Record<string, string> = {
      'compression.checkpoint_required': 'true',
      'plugins.entries.lilbot-prompt-v1.enabled': 'true'
    }
    const result = await rollbackHook.rollback({
      profiles: ['dev-bot-a'],
      printedEnvironment: 'LILBOT_ENV=development HERMES_HOME=/tmp/lilbot-dev/hermes LILBOT_HERMES_BIN=hermes',
      runCommand: async argv => {
        calls.push(argv)
        const key = argv.at(-1) === 'false' ? (argv.at(-2) ?? '') : (argv.at(-1) ?? '')
        if (argv.includes('get')) return values[key] ?? 'false'
        values[key] = 'false'
        return 'ok'
      }
    })
    expect(result).toEqual({ cleared: 1, failed: 0 })
    expect(values['compression.checkpoint_required']).toBe('false')
    expect(values['plugins.entries.lilbot-prompt-v1.enabled']).toBe('false')
    expect(calls.some(args => args.includes('plugins.entries.lilbot-prompt-v1.enabled') && args.includes('set') && args.includes('false'))).toBe(true)
  })
})
