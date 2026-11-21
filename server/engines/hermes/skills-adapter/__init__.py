"""Independent of the memory adapter; all writes go through LilBot validation."""
import hashlib
import hmac
import json
import urllib.request
from pathlib import Path


def settings():
    from hermes_constants import get_hermes_home
    return json.loads((get_hermes_home() / 'lilbot-skills.json').read_text())


def call(action, args, session=''):
    config = settings()
    token = Path(config['tokenFile']).read_text().strip()
    capability = hmac.new(token.encode(), ('create-bot:' + config['botId']).encode(), hashlib.sha256).hexdigest()
    req = urllib.request.Request(config['url'] + '/engine/skills/' + action,
        data=json.dumps(args).encode(), headers={'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token, 'x-lilbot-bot-capability': capability, 'x-lilbot-session': str(session or '')})
    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            return json.loads(response.read())
    except Exception as error:
        return {'error': str(error)}


def register(ctx):
    from tools.skills_tool import SKILLS_LIST_SCHEMA, SKILL_VIEW_SCHEMA, skills_list, skill_view

    def listing(args, **kwargs):
        return json.dumps({'library': call('list', {}), 'engine': json.loads(skills_list())})

    def viewing(args, **kwargs):
        rows = call('list', {})
        name = args.get('name', '')
        if isinstance(rows, list) and any(row['name'] == name for row in rows):
            return json.dumps(call('read', {'name': name, 'file_path': args.get('file_path', 'SKILL.md')}))
        return skill_view(**args)

    def writing(args, **kwargs):
        # The session that asked (Hermes' background review shares it), so LilBot refuses a webhook run's writes.
        return json.dumps(call('write', args, kwargs.get('session_id')))

    schema = {'name': 'skill_manage', 'description': 'Create or improve a shared LilBot skill. All bots can use it. Use standard SKILL.md with name and description frontmatter.',
        'parameters': {'type': 'object', 'properties': {
            'name': {'type': 'string'}, 'action': {'type': 'string', 'enum': ['create', 'edit', 'patch', 'write_file']},
            **{key: {'type': 'string'} for key in ['content', 'file_path', 'old_string', 'new_string']}}, 'required': ['name', 'action']}}
    for name, spec, handler in [('skills_list', SKILLS_LIST_SCHEMA, listing), ('skill_view', SKILL_VIEW_SCHEMA, viewing), ('skill_manage', schema, writing)]:
        ctx.register_tool(name=name, toolset='skills', schema=spec, handler=handler, override=True)
    ctx.register_system_prompt_section('lilbot.skills', lambda info: ('Shared LilBot skills. Use skills_list for all descriptions, skill_view to read, skill_manage to create or improve. Available names:\n' + ', '.join(row['name'] for row in call('list', {}) if isinstance(row, dict)))[:3900], max_chars=4000)
