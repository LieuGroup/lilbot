"""LilBot memory provider for Hermes. Holds no data: every call goes to the LilBot server on this machine, which owns the
memory (`server/memory/`, `server/http/engine-api.ts`). The stable bot id is supplied in the connection settings.
Installed per profile by LilBot (`server/engines/hermes/hermes-memory-setup.ts`): this folder is copied to
`$HERMES_HOME/plugins/lilbot-memory-v<version>/` and `$HERMES_HOME/lilbot-memory.json` says where LilBot is."""

from __future__ import annotations

import json
import logging
import time
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
VERSION = "0.14.0"
DEFAULT_URL = "http://127.0.0.1:3370"
DEFAULT_TOKEN_FILE = "~/.local/share/lilbot/engine-token"
TIMEOUT_SECONDS = 5
SAVE_TIMEOUT_SECONDS = 600  # the save before compressing reviews the whole conversation in passes; Hermes waits for it
# A save that finds LilBot gone (a deploy restarting it) is sent again for this long, well within the 300 s or more
# Hermes waits for a compaction, so a restart pauses the turn instead of failing it.
RETRY_SECONDS = 90
# One line per save before compressing (session, time, whether it finished), so LilBot can tell a turn Hermes failed
# for want of the save from any other failed turn, also one that failed while LilBot was down. No conversation text.
SAVES_FILE = "lilbot-memory-saves.jsonl"
SAVES_KEPT = 500

HERE = Path(__file__).resolve().parent
# The memory rules every session gets, and the two memory tools.
RULES = (HERE / "rules.md").read_text().rstrip("\n")
TOOLS = json.loads((HERE / "tools.json").read_text())


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
        self._home: Path | None = None

    @property
    def name(self) -> str:
        return NAME

    def is_available(self) -> bool:
        return True

    def initialize(self, session_id: str, **kwargs) -> None:
        home = Path(str(kwargs.get("hermes_home") or "")).expanduser()
        self._home = home
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
            # Refused or cut off before an answer: LilBot is not running. A read that timed out may still be saving.
            gone = isinstance(getattr(error, "reason", error), (ConnectionRefusedError, ConnectionResetError))
            return {"error": "Memory is not reachable right now.", "gone": gone}

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
        deadline = time.monotonic() + RETRY_SECONDS
        result = self._call("history/save", {"messages": evidence, "chatId": self._chat})
        while result.get("gone") and time.monotonic() < deadline:
            time.sleep(3)
            result = self._call("history/save", {"messages": evidence, "chatId": self._chat})
        done = bool(result.get("saved") or result.get("skipped"))
        self._record_save(done)
        if done:
            return "Lasting facts were reviewed for saving to LilBot memory before this summary." if result.get("saved") else ""
        logger.warning("lilbot-memory: pre-compression saving did not complete: %s", result.get("error"))
        raise RuntimeError(f"LilBot did not save this conversation to memory before compressing: {result.get('error') or 'no answer'}")

    def _record_save(self, done: bool) -> None:
        if self._home is None:
            return
        path = self._home / SAVES_FILE
        try:
            lines = path.read_text().splitlines()[-SAVES_KEPT:] if path.exists() and path.stat().st_size > SAVES_KEPT * 400 else None
            if lines is not None:  # rare: keep the newest lines
                path.write_text("".join(f"{line}\n" for line in lines))
            with path.open("a") as saves:
                saves.write(json.dumps({"session": self._chat, "at": time.time(), "saved": done}) + "\n")
        except OSError as error:
            logger.warning("lilbot-memory: could not record the save: %s", error)

    def on_session_switch(self, new_session_id: str, **kwargs) -> None:
        self._chat = str(new_session_id or self._chat)

    def get_tool_schemas(self) -> list[dict[str, Any]]:
        return [{
            "name": "search_conversations",
            "description": "Search your past conversations with Oscar (excludes other bots, threads, routine runs). Returns snippets with ids and times.",
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
