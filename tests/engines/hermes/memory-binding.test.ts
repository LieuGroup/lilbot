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
sys.modules['adapter'] = module
spec.loader.exec_module(module)
assert module.VERSION == "0.8.0"
assert "version: 0.8.0" in pathlib.Path(sys.argv[1]).with_name("plugin.yaml").read_text()
tools = {tool["name"] for tool in module.LilBotMemoryProvider().get_tool_schemas()}
assert {"create_routine", "list_routines", "pause_routine", "resume_routine", "delete_routine", "give_file", "send_report", "answer_report", "create_bot", "recall_memory", "update_memory"} <= tools
assert "# Reports" in module.LilBotMemoryProvider().system_prompt_block()
calls = []
adapter = module.LilBotMemoryProvider()
adapter._call = lambda endpoint, body: calls.append((endpoint, body)) or {}
adapter.handle_tool_call("give_file", {"path": "result.txt", "title": "Result"})
adapter.handle_tool_call("list_routines", {})
assert calls == [("library/give", {"path": "result.txt", "title": "Result"}), ("routines/list", {})]
adapter.on_turn_start(1, "LilBot reports — not from Oscar.")
adapter.handle_tool_call("send_report", {"requestId": "loop", "kind": "question", "text": "Why?"})
assert calls[-1][1]["reportTurn"] is True
adapter.on_turn_start(2, "A normal message")
assert adapter._report_turn is False
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
