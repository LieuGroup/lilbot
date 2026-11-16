"""LeBot memory provider for Hermes.

Holds no data. Every call goes to the LeBot server on this machine, which owns the memory
(`server/memory/` and `server/engine-api.ts` in the LeBot repo). The bot id is the Hermes profile id.

Installed per profile by LeBot (`scripts/hermes-memory.ts`): this folder is copied to
`$HERMES_HOME/plugins/lebot-memory/` and `$HERMES_HOME/lebot-memory.json` says where LeBot is.
"""

from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from agent.memory_provider import MemoryProvider

logger = logging.getLogger(__name__)

NAME = "lebot-memory"
DEFAULT_URL = "http://127.0.0.1:3370"
DEFAULT_TOKEN_FILE = "~/.local/share/lebot/engine-token"
TIMEOUT_SECONDS = 5

RULES = """# Memory
You have a long-term memory that outlasts this conversation. The facts you need most are shown to you
before each turn under "What you remember"; older ones are found with recall_memory.

Save with update_memory, without asking first, when you learn something that will still matter in a
later conversation:
- kind "profile": lasting facts about the user or about how to do your work well for them.
- kind "journal": what you did or decided, as one dated line, so a later session can pick it up.
Facts about the user are shared with the user's other bots by default; your journal stays yours. Set
scope yourself when a fact should be shared or kept private against that default.

Keep each fact to one or two sentences that make sense on their own. Save a pointer, not a copy, when
the data lives somewhere you can look it up again. Do not save secrets, passwords or keys.
To correct a fact, forget the old one by its id and write the new one. When the user's newer statement
conflicts with an older fact, the newer one wins."""

TOOLS = [
    {
        "name": "recall_memory",
        "description": "Search your long-term memory for facts that are not shown to you already. Returns matching facts with their id, kind, date and text.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Words to look for. Leave empty to list the newest facts."},
                "kind": {"type": "string", "enum": ["profile", "journal"], "description": "Only this kind of fact."},
                "limit": {"type": "integer", "description": "How many facts at most (default 20, max 50)."},
            },
            "required": [],
        },
    },
    {
        "name": "update_memory",
        "description": "Save one fact to your long-term memory, or forget one. To correct a fact: forget it, then write the new one.",
        "parameters": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["write", "forget"]},
                "kind": {"type": "string", "enum": ["profile", "journal"], "description": "For write: profile = lasting fact, journal = dated history."},
                "fact": {"type": "string", "description": "For write: the fact, one or two sentences."},
                "scope": {"type": "string", "enum": ["bot", "shared"], "description": "For write, optional: bot = only you, shared = all the user's bots."},
                "id": {"type": "string", "description": "For forget: the id shown in brackets before the fact."},
            },
            "required": ["action"],
        },
    },
]


def _bot_id(hermes_home: Path) -> str:
    """The profile id LeBot knows this bot by: the default profile lives in the Hermes home itself."""
    return hermes_home.name if hermes_home.parent.name == "profiles" else "default"


class LeBotMemoryProvider(MemoryProvider):
    def __init__(self) -> None:
        self._url = DEFAULT_URL
        self._token = ""
        self._bot = ""
        self._block: str | None = None

    @property
    def name(self) -> str:
        return NAME

    def is_available(self) -> bool:
        return True

    def initialize(self, session_id: str, **kwargs) -> None:
        home = Path(str(kwargs.get("hermes_home") or "")).expanduser()
        settings: dict[str, Any] = {}
        try:
            settings = json.loads((home / f"{NAME}.json").read_text())
        except (OSError, ValueError):
            logger.info("lebot-memory: no settings file in %s, using defaults", home)
        self._url = str(settings.get("url") or DEFAULT_URL).rstrip("/")
        self._bot = _bot_id(home)
        try:
            self._token = Path(str(settings.get("token_file") or DEFAULT_TOKEN_FILE)).expanduser().read_text().strip()
        except OSError as error:
            self._token = ""
            logger.warning("lebot-memory: cannot read the LeBot token (%s); memory is off for this session", error)

    def _call(self, endpoint: str, body: dict[str, Any]) -> dict[str, Any]:
        """One request to LeBot. Returns its JSON; a refusal comes back as {"error": "..."}."""
        if not self._token:
            return {"error": "Memory is not connected to LeBot."}
        request = urllib.request.Request(
            f"{self._url}/engine/memory/{endpoint}",
            data=json.dumps({"botId": self._bot, **body}).encode(),
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {self._token}"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
                return json.loads(response.read())
        except urllib.error.HTTPError as error:
            try:
                return json.loads(error.read())
            except ValueError:
                return {"error": f"LeBot answered {error.code}."}
        except (OSError, ValueError) as error:
            logger.warning("lebot-memory: LeBot is not reachable: %s", error)
            return {"error": "Memory is not reachable right now."}

    def system_prompt_block(self) -> str:
        return RULES

    def on_turn_start(self, turn_number: int, message: str, **kwargs) -> None:
        # One snapshot per turn, so every model call in the turn sees the same text.
        self._block = None

    def prefetch(self, query: str, *, session_id: str = "") -> str:
        if self._block is None:
            text = self._call("context", {}).get("text") or ""
            self._block = f"What you remember:\n{text}" if text else ""
        return self._block

    def get_tool_schemas(self) -> list[dict[str, Any]]:
        return list(TOOLS)

    def handle_tool_call(self, tool_name: str, args: dict[str, Any], **kwargs) -> str:
        if tool_name == "recall_memory":
            body = {"query": str(args.get("query") or "")}
            if args.get("kind"):
                body["kind"] = args["kind"]
            if isinstance(args.get("limit"), int):
                body["limit"] = args["limit"]
            return json.dumps(self._call("recall", body))
        if tool_name == "update_memory":
            action = args.get("action")
            if action == "write":
                body = {"kind": args.get("kind") or "profile", "text": str(args.get("fact") or "")}
                if args.get("scope"):
                    body["scope"] = args["scope"]
                return json.dumps(self._call("write", body))
            if action == "forget":
                return json.dumps(self._call("forget", {"id": str(args.get("id") or "")}))
            return json.dumps({"error": 'action must be "write" or "forget".'})
        return json.dumps({"error": f"Unknown tool: {tool_name}"})

    def get_config_schema(self) -> list[dict[str, Any]]:
        return []

    def save_config(self, values: dict[str, Any], hermes_home: str) -> None:
        return None


def register(ctx) -> None:
    ctx.register_memory_provider(LeBotMemoryProvider())
