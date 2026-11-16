import { expect, test } from 'bun:test'
import { join } from 'node:path'

test('the memory adapter uses the stable app id and supports old settings', async () => {
  const script = `
import importlib.util, json, pathlib, sys, tempfile, types
agent = types.ModuleType('agent')
provider = types.ModuleType('agent.memory_provider')
provider.MemoryProvider = object
sys.modules['agent'] = agent
sys.modules['agent.memory_provider'] = provider
spec = importlib.util.spec_from_file_location('adapter', sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
with tempfile.TemporaryDirectory() as directory:
    home = pathlib.Path(directory) / 'profiles' / 'native-id'
    home.mkdir(parents=True)
    token = home / 'token'
    token.write_text('test-only')
    settings = {'bot_id': 'app-id', 'token_file': str(token)}
    (home / 'lilbot-memory.json').write_text(json.dumps(settings))
    instance = module.LilBotMemoryProvider()
    instance.initialize('chat', hermes_home=home)
    assert instance._bot == 'app-id'
    del settings['bot_id']
    (home / 'lilbot-memory.json').write_text(json.dumps(settings))
    instance.initialize('chat', hermes_home=home)
    assert instance._bot == 'native-id'
`
  const child = Bun.spawn(['python3', '-B', '-c', script, join(import.meta.dir, '../../../server/engines/hermes/memory-adapter/__init__.py')], { stdout: 'pipe', stderr: 'pipe' })
  const error = await new Response(child.stderr).text()
  expect(await child.exited, error).toBe(0)
})
