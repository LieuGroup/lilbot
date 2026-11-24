import { expect, test } from 'bun:test'
import { join } from 'node:path'

test('the v0.16.0 memory adapter is a minimal per-bot checkpoint bridge with no tools or turn hooks', async () => {
  const script = `
import importlib.util, json, pathlib, shutil, sys, tempfile, types
agent = types.ModuleType('agent')
provider = types.ModuleType('agent.memory_provider')
provider.MemoryProvider = object
sys.modules['agent'] = agent
sys.modules['agent.memory_provider'] = provider
spec = importlib.util.spec_from_file_location('adapter', sys.argv[1])
module = importlib.util.module_from_spec(spec)
sys.modules['adapter'] = module
spec.loader.exec_module(module)
assert module.VERSION == "0.16.0"
assert "version: 0.16.0" in pathlib.Path(sys.argv[1]).with_name("plugin.yaml").read_text()
assert not pathlib.Path(sys.argv[1]).with_name("tools.json").exists()
assert not pathlib.Path(sys.argv[1]).with_name("rules.md").exists()
adapter = module.LilBotMemoryProvider()
assert adapter.get_tool_schemas() == []
assert not hasattr(adapter, "prefetch")
assert not hasattr(adapter, "sync_turn")
assert not hasattr(adapter, "system_prompt_block")
calls = []
answer = {"saved": True}
adapter._call = lambda endpoint, body: calls.append((endpoint, body)) or answer
adapter._checkpoint_key = "per-bot-key"
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
saves = pathlib.Path(tempfile.mkdtemp())
adapter._home = saves
answers = [{"error": "x", "gone": True}, {"error": "x", "gone": True}, {"saved": True}]
adapter._call = lambda endpoint, body: calls.append((endpoint, body)) or answers.pop(0)
module.time.sleep = lambda seconds: None
assert adapter.on_pre_compress([{"role": "user", "content": "likes orchids"}])
assert len(calls) == 3 and answers == []
calls.clear()
adapter._call = lambda endpoint, body: calls.append((endpoint, body)) or {"error": "timed out", "gone": False}
try:
    adapter.on_pre_compress([{"role": "user", "content": "likes orchids"}])
    raise AssertionError("a save that did not finish must raise")
except RuntimeError:
    pass
assert len(calls) == 1
calls.clear()
records = [json.loads(line) for line in (saves / "lilbot-memory-saves.jsonl").read_text().splitlines()]
assert [(r["session"], r["saved"]) for r in records] == [("", True), ("", False)] and all(isinstance(r["at"], float) for r in records)
shutil.rmtree(saves)
adapter._url = "http://127.0.0.1:9"
assert module.LilBotMemoryProvider._call(adapter, "history/save", {})["gone"] is True
adapter._primary = False
assert adapter.on_pre_compress([{"role": "user", "content": "a sub-agent's task"}]) == ""
assert calls == []
assert "lilbot_history_search" in json.loads(adapter.handle_tool_call("search_conversations", {"query": "orchids"}))["error"]
assert "lilbot_memory_recall" in json.loads(adapter.handle_tool_call("recall_memory", {"query": "orchids"}))["error"]
assert "lilbot_memory_save" in json.loads(adapter.handle_tool_call("update_memory", {"action": "write", "fact": "x"}))["error"]
assert json.loads(adapter.handle_tool_call("give_file", {}))["error"].startswith("Unknown tool")
with tempfile.TemporaryDirectory() as directory:
    home = pathlib.Path(directory) / 'profiles' / 'native-id'
    home.mkdir(parents=True)
    settings = {'url': 'http://127.0.0.1:3370', 'bot_id': 'app-id', 'checkpoint_key': 'hmac-key-123'}
    (home / 'lilbot-memory.json').write_text(json.dumps(settings))
    instance = module.LilBotMemoryProvider()
    instance.initialize('chat-1', hermes_home=home)
    assert instance._checkpoint_key == 'hmac-key-123'
    assert instance._chat == 'chat-1'
`
  const child = Bun.spawn(['python3', '-B', '-c', script, join(import.meta.dir, '../../../server/engines/hermes/memory-adapter/__init__.py')], {
    stdout: 'pipe',
    stderr: 'pipe'
  })
  const error = await new Response(child.stderr).text()
  expect(await child.exited, error).toBe(0)
})
