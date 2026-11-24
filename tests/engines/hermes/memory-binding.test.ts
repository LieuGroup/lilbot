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
    assert not hasattr(instance, '_token')
    assert not hasattr(module, 'DEFAULT_TOKEN_FILE')
`
  const child = Bun.spawn(['python3', '-B', '-c', script, join(import.meta.dir, '../../../server/engines/hermes/memory-adapter/__init__.py')], {
    stdout: 'pipe',
    stderr: 'pipe'
  })
  const error = await new Response(child.stderr).text()
  expect(await child.exited, error).toBe(0)
})

test('on HTTP 403 the v0.16.0 adapter adopts a rotated checkpoint_key or falls back one-shot to rollback legacy auth on loopback only', async () => {
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

with tempfile.TemporaryDirectory() as directory:
    home = pathlib.Path(directory) / 'profiles' / 'native-id'
    home.mkdir(parents=True)
    token_path = pathlib.Path(directory) / 'engine-token'
    token_path.write_text('master-rollback-token\\n')
    settings_path = home / 'lilbot-memory.json'
    settings_path.write_text(json.dumps({'url': 'http://127.0.0.1:3370', 'bot_id': 'bot-1', 'checkpoint_key': 'old-key'}))

    adapter = module.LilBotMemoryProvider()
    adapter.initialize('chat-1', hermes_home=home)
    posts = []
    sleeps = []
    clock = [0.0]
    module.time.monotonic = lambda: clock[0]

    def fake_sleep(seconds):
        sleeps.append(seconds)
        clock[0] += seconds
        if len(sleeps) == 1:
            settings_path.write_text(json.dumps({'url': 'http://127.0.0.1:3370', 'bot_id': 'bot-1', 'checkpoint_key': 'rotated-key'}))

    module.time.sleep = fake_sleep

    def fake_post(url, headers, body):
        posts.append((url, headers, body))
        if headers.get('Authorization') == 'Bearer rotated-key':
            return {'saved': True}
        if headers.get('Authorization') == 'Bearer master-rollback-token' and headers.get('X-LilBot-Bot-Capability') == 'cap-1' and body.get('botId') == 'bot-1':
            return {'saved': True}
        return {'error': 'Not allowed.', 'status': 403}

    adapter._post = fake_post
    assert adapter.on_pre_compress([{'role': 'user', 'content': 'hello'}])
    assert adapter._checkpoint_key == 'rotated-key'
    assert [h['Authorization'] for _, h, _ in posts] == ['Bearer old-key', 'Bearer rotated-key']

    # Rollback: server rewrites lilbot-memory.json to legacy token_file + creation_capability (no checkpoint_key) after a short delay.
    posts.clear()
    sleeps.clear()
    def rollback_sleep(seconds):
        sleeps.append(seconds)
        clock[0] += seconds
        if len(sleeps) == 1:
            settings_path.write_text(json.dumps({'url': 'http://127.0.0.1:3370', 'bot_id': 'bot-1', 'token_file': str(token_path), 'creation_capability': 'cap-1'}))
    module.time.sleep = rollback_sleep
    adapter._post = lambda url, headers, body: posts.append((url, headers, body)) or (
        {'saved': True} if headers.get('Authorization') == 'Bearer master-rollback-token' and headers.get('X-LilBot-Bot-Capability') == 'cap-1' and body.get('botId') == 'bot-1'
        else {'error': 'Not allowed.', 'status': 403}
    )
    assert adapter.on_pre_compress([{'role': 'user', 'content': 'during rollback'}])
    assert [h['Authorization'] for _, h, _ in posts] == ['Bearer rotated-key', 'Bearer master-rollback-token']
    assert posts[-1][2]['botId'] == 'bot-1'
    assert adapter._checkpoint_key == 'rotated-key'
    assert not hasattr(adapter, '_token')

    # Defense-in-depth: never send token_file to non-loopback URL, and never fall back if checkpoint_key is still present.
    posts.clear()
    module.time.sleep = lambda s: clock.__setitem__(0, clock[0] + s)
    for bad in [
        {'url': 'https://evil.example', 'bot_id': 'bot-1', 'token_file': str(token_path), 'creation_capability': 'cap-1'},
        {'url': 'http://127.0.0.1:3370', 'bot_id': 'bot-1', 'checkpoint_key': 'rotated-key', 'token_file': str(token_path), 'creation_capability': 'cap-1'},
    ]:
        settings_path.write_text(json.dumps(bad))
        try:
            adapter.on_pre_compress([{'role': 'user', 'content': 'blocked'}])
            raise AssertionError('must fail on blocked fallback')
        except RuntimeError:
            pass
    assert all(h['Authorization'] != 'Bearer master-rollback-token' for _, h, _ in posts)
`
  const child = Bun.spawn(['python3', '-B', '-c', script, join(import.meta.dir, '../../../server/engines/hermes/memory-adapter/__init__.py')], {
    stdout: 'pipe',
    stderr: 'pipe'
  })
  const error = await new Response(child.stderr).text()
  expect(await child.exited, error).toBe(0)
})
