"""Minimal pre-compress memory checkpoint bridge for Hermes. Holds no data and exposes no tools.
Before-turn memory injection and after-chat review queueing live in LilBot itself; this plug-in exists only
because Hermes' OpenRPC API has no pre-compress callback. Authenticates with a per-bot HMAC key scoped
strictly to /engine/history/save (never the server's master engine-token)."""

from __future__ import annotations

import json
import logging
import time
import urllib.error
import urllib.parse
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
AUTH_RETRY_SECONDS = 30
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


def _loopback(url: str) -> bool:
    return urllib.parse.urlparse(url).hostname in ("127.0.0.1", "localhost", "::1")


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

    def _read_settings(self) -> dict[str, Any]:
        if self._home is None:
            return {}
        try:
            data = json.loads((self._home / SETTINGS_FILE).read_text())
            return data if isinstance(data, dict) else {}
        except (OSError, ValueError):
            return {}

    def initialize(self, session_id: str, **kwargs) -> None:
        home = Path(str(kwargs.get("hermes_home") or "")).expanduser()
        self._home = home
        settings = self._read_settings()
        if not settings:
            logger.info("lilbot-memory: no settings file in %s, using defaults", home)
        self._url = str(settings.get("url") or DEFAULT_URL).rstrip("/")
        self._checkpoint_key = str(settings.get("checkpoint_key") or "").strip()
        self._chat = str(session_id or "")
        self._primary = kwargs.get("agent_context", "primary") == "primary"

    def _post(self, url: str, headers: dict[str, str], body: dict[str, Any]) -> dict[str, Any]:
        request = urllib.request.Request(url, data=json.dumps(body).encode(), headers=headers, method="POST")
        try:
            with urllib.request.urlopen(request, timeout=SAVE_TIMEOUT_SECONDS) as response:
                return json.loads(response.read())
        except urllib.error.HTTPError as error:
            try:
                data = json.loads(error.read())
                if isinstance(data, dict):
                    return {**data, "status": error.code}
            except ValueError:
                pass
            return {"error": f"LilBot answered {error.code}.", "status": error.code}
        except (OSError, ValueError) as error:
            logger.warning("lilbot-memory: LilBot is not reachable: %s", error)
            gone = isinstance(getattr(error, "reason", error), (ConnectionRefusedError, ConnectionResetError))
            return {"error": "Memory is not reachable right now.", "gone": gone}

    def _call(self, endpoint: str, body: dict[str, Any]) -> dict[str, Any]:
        if not self._checkpoint_key:
            return {"error": "Memory checkpoint key is not configured.", "status": 403}
        headers = {"Content-Type": "application/json", "Authorization": f"Bearer {self._checkpoint_key}", "X-LilBot-Adapter-Version": VERSION}
        return self._post(f"{self._url}/engine/{endpoint}", headers, {**({"chatId": self._chat} if self._chat else {}), **body})

    def _retry_auth(self, endpoint: str, body: dict[str, Any]) -> dict[str, Any] | None:
        settings = self._read_settings()
        url = str(settings.get("url") or self._url).rstrip("/")
        new_key = str(settings.get("checkpoint_key") or "").strip()
        if new_key and (new_key != self._checkpoint_key or url != self._url):
            self._url, self._checkpoint_key = url, new_key
            return self._call(endpoint, body)
        token_file, capability = str(settings.get("token_file") or "").strip(), str(settings.get("creation_capability") or "").strip()
        if new_key or not token_file or not capability or not _loopback(url):
            return None
        try:
            token = Path(token_file).expanduser().read_text().strip()
        except OSError:
            return None
        if not token:
            return None
        bot_id = str(settings.get("bot_id") or "").strip()
        headers = {"Content-Type": "application/json", "Authorization": f"Bearer {token}", "X-LilBot-Adapter-Version": VERSION, "X-LilBot-Bot-Capability": capability}
        return self._post(f"{url}/engine/{endpoint}", headers, {**({"botId": bot_id} if bot_id else {}), **({"chatId": self._chat} if self._chat else {}), **body})

    def on_pre_compress(self, messages: list[dict[str, Any]]) -> str:
        if not self._primary:
            return ""
        evidence = [{"role": m["role"], "text": _text(m.get("content", m.get("text", "")))} for m in messages if m.get("role") in ("user", "assistant")]
        body = {"messages": evidence, "chatId": self._chat}
        deadline, auth_deadline = time.monotonic() + RETRY_SECONDS, None
        result = self._call("history/save", body)
        while time.monotonic() < deadline:
            if result.get("gone"):
                time.sleep(3)
                result = self._call("history/save", body)
                continue
            if result.get("status") == 403 and self._home is not None:
                retried = self._retry_auth("history/save", body)
                if retried is not None:
                    result = retried
                    if result.get("gone"):
                        continue
                    if result.get("status") != 403:
                        break
                auth_deadline = min(deadline, time.monotonic() + AUTH_RETRY_SECONDS) if auth_deadline is None else auth_deadline
                if time.monotonic() < auth_deadline:
                    time.sleep(2)
                    continue
            break
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
