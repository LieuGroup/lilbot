"""LilBot memory provider for Hermes. Holds no data: every call goes to the LilBot server on this machine, which owns the
memory (`server/memory/`, `server/http/engine-api.ts`). The stable bot id is supplied in the connection settings.
Installed per profile by LilBot (`server/engines/hermes/hermes-memory-setup.ts`): this folder is copied to
`$HERMES_HOME/plugins/lilbot-memory-v<version>/` and `$HERMES_HOME/lilbot-memory.json` says where LilBot is."""

from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from agent.memory_provider import MemoryProvider, spawn_context_thread

logger = logging.getLogger(__name__)

# LilBot installs each version under its own folder name (lilbot-memory-v0-4-0) and selects the provider
# by that name: the Hermes gateway keeps a plug-in's code loaded per folder, so a new version must be a
# new folder to take effect without restarting the gateway.
NAME = Path(__file__).resolve().parent.name
SETTINGS_FILE = "lilbot-memory.json"
# Keep equal to plugin.yaml. LilBot warns when a bot still calls with an older one.
VERSION = "0.13.0"
DEFAULT_URL = "http://127.0.0.1:3370"
DEFAULT_TOKEN_FILE = "~/.local/share/lilbot/engine-token"
TIMEOUT_SECONDS = 5
SAVE_TIMEOUT_SECONDS = 600  # the save before compressing reviews the whole conversation in passes; Hermes waits for it

RULES = """# Memory
You have a long-term memory that outlasts this conversation. The facts you need most are shown to you
before each turn; older ones are found with recall_memory. Save with update_memory, without asking.

What to save:
- kind "profile": a lasting fact that will matter in every later session. Who the user is, how they
  want work done, stable facts about their setup.
- kind "journal": one dated line about an outcome or an open item a later session must pick up
  ("Shipped 1.1.2 to TestFlight; privacy label still to update"). Not a log of what you did.
Facts about the user are shared with the user's other bots by default; your journal stays yours. Set
scope yourself when a fact should be shared or kept private against that default.

Only save what is grounded in this conversation: something the user said or a result you can point to.
- Never infer the user's traits, skill, role, mood or preferences from tone, topic or tools used.
- A one-off request is not a standing preference. Save it as one only when the user made it general
  ("always", "from now on", "remember") or stated a standing like or dislike.
- If unsure, leave it out. A wrong fact misleads every later session.

Do not save: secrets, passwords or keys; anything you can look up again (save a pointer, not a copy);
task progress and finished-work logs; temporary failures and "tool X does not work" (save the fix if
there is one, never the failure); how to do a kind of task (that belongs in a skill).

Keep each fact to one or two sentences that stand on their own. One fact goes in once: check what you
are shown before adding. To correct a fact, forget the old one by its id, then write the new one. When
the user's newer statement conflicts with an older fact, the newer one wins, and what the user asks
for right now always beats what memory says. Give a fact an expiry date when it stops being true on a
known day. If a save comes back with
a notice that memory is over its budget, tidy before adding more."""

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
                "expires": {"type": "string", "description": "For write, optional: a date like 2026-12-31 after which the fact no longer applies."},
                "id": {"type": "string", "description": "For forget: the id shown in brackets before the fact."},
            },
            "required": ["action"],
        },
    },
]


def _text(content: Any) -> str:
    """A message's words: its text, or the text parts of a multimodal message."""
    parts = content if isinstance(content, list) else [{"type": "text", "text": content if isinstance(content, str) else ""}]
    return "\n".join(str(p.get("text") or "") for p in parts if isinstance(p, dict) and p.get("type") in ("text", "input_text"))


def _bot_id(hermes_home: Path) -> str:
    """The profile id LilBot knows this bot by: the default profile lives in the Hermes home itself."""
    return hermes_home.name if hermes_home.parent.name == "profiles" else "default"


class LilBotMemoryProvider(MemoryProvider):
    # Hermes' fail-closed pre-compress checkpoint (`compression.checkpoint_required`): a save that does not finish raises.
    pre_compress_checkpoint_api_version = 2

    def __init__(self) -> None:
        self._url = DEFAULT_URL
        self._token = ""
        self._bot = ""
        self._block: str | None = None
        self._chat = ""
        self._creation_capability = ""
        self._primary = True

    @property
    def name(self) -> str:
        return NAME

    def is_available(self) -> bool:
        return True

    def initialize(self, session_id: str, **kwargs) -> None:
        home = Path(str(kwargs.get("hermes_home") or "")).expanduser()
        settings: dict[str, Any] = {}
        try:
            settings = json.loads((home / SETTINGS_FILE).read_text())
        except (OSError, ValueError):
            logger.info("lilbot-memory: no settings file in %s, using defaults", home)
        self._url = str(settings.get("url") or DEFAULT_URL).rstrip("/")
        self._bot = str(settings.get("bot_id") or _bot_id(home))
        self._chat = str(session_id or "")
        self._creation_capability = str(settings.get("creation_capability") or "")
        # Scheduled runs and sub-agents are not conversations with the user: nothing to review.
        self._primary = kwargs.get("agent_context", "primary") == "primary"
        try:
            self._token = Path(str(settings.get("token_file") or DEFAULT_TOKEN_FILE)).expanduser().read_text().strip()
        except OSError as error:
            self._token = ""
            logger.warning("lilbot-memory: cannot read the LilBot token (%s); memory is off for this session", error)

    def _call(self, endpoint: str, body: dict[str, Any]) -> dict[str, Any]:
        """One request to LilBot. Returns its JSON; a refusal comes back as {"error": "..."}."""
        if not self._token:
            return {"error": "Memory is not connected to LilBot."}
        request = urllib.request.Request(
            f"{self._url}/engine/{endpoint}" if endpoint.startswith("history/") else f"{self._url}/engine/memory/{endpoint}",
            data=json.dumps({"botId": self._bot, **({"chatId": self._chat} if self._chat else {}), **body}).encode(),
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {self._token}", "X-LilBot-Adapter-Version": VERSION, "X-LilBot-Bot-Capability": self._creation_capability},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=SAVE_TIMEOUT_SECONDS if endpoint.startswith("history/save") else TIMEOUT_SECONDS) as response:
                return json.loads(response.read())
        except urllib.error.HTTPError as error:
            try:
                return json.loads(error.read())
            except ValueError:
                return {"error": f"LilBot answered {error.code}."}
        except (OSError, ValueError) as error:
            logger.warning("lilbot-memory: LilBot is not reachable: %s", error)
            return {"error": "Memory is not reachable right now."}

    def system_prompt_block(self) -> str:
        return RULES + "\nUse your lilbot_routine tool for scheduled work, never Hermes cron. Runs have full access and need no approvals.\n"

    def on_turn_start(self, turn_number: int, message: str, **kwargs) -> None:
        # One snapshot per turn, so every model call in the turn sees the same text.
        self._block = None

    def prefetch(self, query: str, *, session_id: str = "") -> str:
        if self._block is None:
            text = self._call("context", {}).get("text") or ""
            self._block = f"What you remember (your saved memory, not a new message from the user):\n{text}" if text else ""
        return self._block

    def sync_turn(self, user_content: str, assistant_content: str, *, session_id: str = "", messages=None) -> None:
        """Hand the finished turn to LilBot for its after-chat memory review. Never blocks the turn."""
        if not self._primary or not self._token or not isinstance(user_content, str) or not user_content.strip():
            return
        chat = str(session_id or self._chat)
        body = {"chatId": chat, "user": user_content[:20000], "assistant": str(assistant_content or "")[:20000]}

        def send() -> None:
            self._call("turn", body)

        try:
            spawn_context_thread(send, name="lilbot-memory-turn").start()
        except Exception as error:  # the review is a safety net; a failed hand-off must not surface
            logger.debug("lilbot-memory: could not hand the turn to LilBot: %s", error)

    def on_pre_compress(self, messages: list[dict[str, Any]]) -> str:
        """Before Hermes compresses, LilBot reviews every user and assistant word of the conversation for memory. Until
        that finished this raises (whether or not Hermes requires the checkpoint), so the conversation stays as it is."""
        if not self._primary:
            return ""  # LilBot reviews only conversations with the user, never scheduled runs or sub-agents.
        # Only conversational text, never system prompts, tool output or credentials.
        evidence = [{"role": m["role"], "text": _text(m.get("content", m.get("text", "")))}
                    for m in messages if m.get("role") in ("user", "assistant")]
        result = self._call("history/save", {"messages": evidence, "chatId": self._chat})
        if result.get("saved"):
            return "Lasting facts were reviewed for saving to LilBot memory before this summary."
        if result.get("skipped"):
            return ""
        logger.warning("lilbot-memory: pre-compression saving did not complete: %s", result.get("error"))
        raise RuntimeError(f"LilBot did not save this conversation to memory before compressing: {result.get('error') or 'no answer'}")

    def on_session_switch(self, new_session_id: str, **kwargs) -> None:
        self._chat = str(new_session_id or self._chat)

    def get_tool_schemas(self) -> list[dict[str, Any]]:
        return [{
            "name": "search_conversations",
            "description": "Search your own past conversations with Oscar, including earlier sessions. Returns snippets with stable ids and times. Excludes other bots, threads and routine runs. Use this to recover details no longer in context.",
            "parameters": {"type": "object", "properties": {"query": {"type": "string"}, "limit": {"type": "integer"}}, "required": ["query"]}
        }] + list(TOOLS)

    def handle_tool_call(self, tool_name: str, args: dict[str, Any], **kwargs) -> str:
        if tool_name == "search_conversations":
            return json.dumps(self._call("history/search", {"query": str(args.get("query") or ""), "limit": args.get("limit", 20)}))
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
                if args.get("expires"):
                    body["expires"] = str(args["expires"])
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
    ctx.register_memory_provider(LilBotMemoryProvider())
