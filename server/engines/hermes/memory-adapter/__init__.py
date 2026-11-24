"""Minimal pre-compress memory checkpoint bridge for Hermes. Holds no data and exposes no tools.
Before-turn memory injection and after-chat review queueing live in LilBot itself; this plug-in exists only
because Hermes' OpenRPC API has no pre-compress callback. Authenticates with a per-bot HMAC key scoped
strictly to /engine/history/save (never the server's master engine-token)."""

from __future__ import annotations

import json
import logging
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from agent.memory_provider import MemoryProvider

logger = logging.getLogger(__name__)

NAME = Path(__file__).resolve().parent.name
SETTINGS_FILE = "lilbot-memory.json"
VERSION = "0.16.0"
DEFAULT_URL = "http://127.0.0.1:3370"
SAVE_TIMEOUT_SECONDS = 600
RETRY_SECONDS = 90
SAVES_FILE = "lilbot-memory-saves.jsonl"
SAVES_KEPT = 500

RETIRED_TOOLS = {
    "search_conversations": "Legacy conversation search plug-in tool is retired. Use the LilBot System MCP tool lilbot_history_search instead.",
    "recall_memory": "Legacy memory plug-in tools are retired. Use the LilBot System MCP tool lilbot_memory_recall instead.",
    "update_memory": "Legacy memory plug-in tools are retired. Use the LilBot System MCP tools lilbot_memory_save or lilbot_memory_forget instead.",
}


def _text(content: Any) -> str:
    parts = content if isinstance(content, list) else [{"type": "text", "text": content if isinstance(content, str) else ""}]
    return "\n".join(str(p.get("text") or "") for p in parts if isinstance(p, dict) and p.get("type") in ("text", "input_text"))


class LilBotMemoryProvider(MemoryProvider):
    pre_compress_checkpoint_api_version = 2

    def __init__(self) -> None:
        self._url = DEFAULT_URL
        self._checkpoint_key = ""
        self._chat = ""
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
        self._checkpoint_key = str(settings.get("checkpoint_key") or "").strip()
        self._chat = str(session_id or "")
        self._primary = kwargs.get("agent_context", "primary") == "primary"

    def _call(self, endpoint: str, body: dict[str, Any]) -> dict[str, Any]:
        if not self._checkpoint_key:
            return {"error": "Memory checkpoint key is not configured."}
        request = urllib.request.Request(
            f"{self._url}/engine/{endpoint}",
            data=json.dumps({**({"chatId": self._chat} if self._chat else {}), **body}).encode(),
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self._checkpoint_key}",
                "X-LilBot-Adapter-Version": VERSION,
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=SAVE_TIMEOUT_SECONDS) as response:
                return json.loads(response.read())
        except urllib.error.HTTPError as error:
            try:
                return json.loads(error.read())
            except ValueError:
                return {"error": f"LilBot answered {error.code}."}
        except (OSError, ValueError) as error:
            logger.warning("lilbot-memory: LilBot is not reachable: %s", error)
            gone = isinstance(getattr(error, "reason", error), (ConnectionRefusedError, ConnectionResetError))
            return {"error": "Memory is not reachable right now.", "gone": gone}

    def on_pre_compress(self, messages: list[dict[str, Any]]) -> str:
        if not self._primary:
            return ""
        evidence = [{"role": m["role"], "text": _text(m.get("content", m.get("text", "")))} for m in messages if m.get("role") in ("user", "assistant")]
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
            if lines is not None:
                path.write_text("".join(f"{line}\n" for line in lines))
            with path.open("a") as saves:
                saves.write(json.dumps({"session": self._chat, "at": time.time(), "saved": done}) + "\n")
        except OSError as error:
            logger.warning("lilbot-memory: could not record the save: %s", error)

    def on_session_switch(self, new_session_id: str, **kwargs) -> None:
        self._chat = str(new_session_id or self._chat)

    def get_tool_schemas(self) -> list[dict[str, Any]]:
        return []

    def handle_tool_call(self, tool_name: str, args: dict[str, Any], **kwargs) -> str:
        if tool_name in RETIRED_TOOLS:
            return json.dumps({"error": RETIRED_TOOLS[tool_name]})
        return json.dumps({"error": f"Unknown tool: {tool_name}"})

    def get_config_schema(self) -> list[dict[str, Any]]:
        return []

    def save_config(self, values: dict[str, Any], hermes_home: str) -> None:
        return None


def register(ctx) -> None:
    ctx.register_memory_provider(LilBotMemoryProvider())
