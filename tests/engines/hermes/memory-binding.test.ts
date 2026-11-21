import { expect, test } from 'bun:test'
import { join } from 'node:path'

test('the memory adapter uses the stable app id and supports old settings', async () => {
  const script = `
import importlib.util, json, pathlib, sys, tempfile, types
agent = types.ModuleType('agent')
provider = types.ModuleType('agent.memory_provider')
provider.MemoryProvider = object
provider.spawn_context_thread = lambda target, *, name: None
sys.modules['agent'] = agent
sys.modules['agent.memory_provider'] = provider
spec = importlib.util.spec_from_file_location('adapter', sys.argv[1])
module = importlib.util.module_from_spec(spec)
sys.modules['adapter'] = module
spec.loader.exec_module(module)
assert module.VERSION == "0.13.0"
assert "version: 0.13.0" in pathlib.Path(sys.argv[1]).with_name("plugin.yaml").read_text()
tools = {tool["name"] for tool in module.LilBotMemoryProvider().get_tool_schemas()}
assert {"search_conversations", "recall_memory", "update_memory"} == tools
assert 'lilbot_routine' in module.LilBotMemoryProvider().system_prompt_block()
calls = []
answer = {"saved": True}
adapter = module.LilBotMemoryProvider()
adapter._call = lambda endpoint, body: calls.append((endpoint, body)) or answer
adapter._token = "test-only"
assert adapter.pre_compress_checkpoint_api_version == 2
early = "likes orchids " * 20000
picture = [{"type": "text", "text": "this is my cat"}, {"type": "image_url", "image_url": {"url": "data:image/png;base64,AAAA"}}]
assert adapter.on_pre_compress([{"role": "user", "content": early}, {"role": "system", "content": "not evidence"}, {"role": "user", "content": picture}])
assert calls.pop() == ("history/save", {"messages": [{"role": "user", "text": early}, {"role": "user", "text": "this is my cat"}], "chatId": ""})
answer = {"saved": False, "skipped": True}
assert adapter.on_pre_compress([{"role": "user", "content": "a routine's words"}]) == ""
calls.pop()
answer = {"error": "Memory is not reachable right now."}
try:
    adapter.on_pre_compress([{"role": "user", "content": "likes orchids"}])
    raise AssertionError("a save that did not finish must raise")
except RuntimeError as error:
    assert "not reachable" in str(error)
calls.pop()
adapter._primary = False
assert adapter.on_pre_compress([{"role": "user", "content": "a sub-agent's task"}]) == ""
assert calls == []
answer = {}
adapter.handle_tool_call("search_conversations", {"query": "orchids"})
assert calls.pop() == ("history/search", {"query": "orchids", "limit": 20})
assert calls == []
assert json.loads(adapter.handle_tool_call("give_file", {}))["error"].startswith("Unknown tool")
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
