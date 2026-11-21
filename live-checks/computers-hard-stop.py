"""Exercise the real installed Hermes detector and adapter; refused input never reaches HTTP."""
import importlib.util
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path.home() / '.hermes/hermes-agent'))
spec = importlib.util.spec_from_file_location('computers_adapter', Path(__file__).resolve().parents[1] / 'server/engines/hermes/computers-adapter/__init__.py')
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)
handlers = {}
class Context:
    def register_tool(self, **tool):
        handlers[tool['name']] = tool['handler']
    def register_system_prompt_section(self, *args, **kwargs):
        pass
adapter.register(Context())
calls = []
adapter.call = lambda action, args, session='': calls.append((args, session)) or {'ok': True}
# Harmless shell no-op even if executed; the real detector still identifies command position.
refused = json.loads(handlers['computer_exec']({'computer': 'leader', 'command': 'if false; then mkfs; fi'}))
assert 'hard stop' in refused['error'], refused
assert not calls
assert json.loads(handlers['computer_exec']({'computer': 'leader', 'command': 'printf OK'}, session_id='webhook-session'))['ok']
assert len(calls) == 1
# The session Hermes names goes with the call, so LilBot can refuse a webhook run's session.
assert calls[0][1] == 'webhook-session', calls
print('PASS: Hermes hard-stop command refused before submission; harmless control accepted with its session')
