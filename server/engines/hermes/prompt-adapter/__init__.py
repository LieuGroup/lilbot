"""Dumb pass-through Hermes llm_request middleware (hermes.middleware.v1).

Contains zero LilBot logic or prompt assembly: reads the exact UTF-8 prompt file
written by LilBot for this bot and substitutes it into outbound provider requests
while preserving prompt-cache breakpoints. Fails open to Hermes's default prompt
if settings or the prompt file are missing, unreadable, empty or too large, and
records only a fixed label of what happened in the profile's private
lilbot-prompt-status.json so LilBot can show it (never prompt contents or paths).
"""
from __future__ import annotations

from collections import OrderedDict
import json
import logging
import os
from pathlib import Path
import time
from typing import Any

logger = logging.getLogger(__name__)
SETTINGS_FILE = "lilbot-prompt.json"
STATUS_FILE = "lilbot-prompt-status.json"
MAX_CACHED_SESSIONS = 64
MAX_SETTINGS_BYTES = 4_096
MAX_PROMPT_BYTES = 256_000
NO_HOOK = "engine has no llm_request hook"


class _Fallback(Exception):
    """A fixed reason the prompt is not used; never carries a path or prompt text."""


class _Status:
    """Writes the profile's status file only when the state or reason changes."""

    def __init__(self, profile_home: Path) -> None:
        self.path = profile_home / STATUS_FILE
        self.last: tuple[str, str] | None = None

    def recorded(self) -> str | None:
        """The recorded fallback reason ("" for any other state), or None without a status file."""
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
            return str(data.get("reason") or "") if isinstance(data, dict) and data.get("state") == "fallback" else ""
        except FileNotFoundError:
            return None
        except Exception:
            return ""

    def set(self, state: str, reason: str = "") -> None:
        if self.last == (state, reason):
            return
        self.last = (state, reason)
        if state == "fallback":
            logger.warning("lilbot-prompt: %s; falling back to engine prompt", reason)
        try:
            tmp = self.path.with_name(f"{STATUS_FILE}.{os.getpid()}.tmp")
            fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as out:
                json.dump({"state": state, "reason": reason, "at": time.time()}, out)
            os.replace(tmp, self.path)
        except Exception:
            logger.warning("lilbot-prompt: could not record status")


def _read_bounded(path: Path, limit: int, too_large: str) -> str:
    if path.stat().st_size > limit:
        raise _Fallback(too_large)
    return path.read_text(encoding="utf-8")


def _read_prompt(profile_home: Path) -> str:
    try:
        cfg = json.loads(_read_bounded(profile_home / SETTINGS_FILE, MAX_SETTINGS_BYTES, "prompt settings unreadable"))
    except Exception:
        raise _Fallback("prompt settings unreadable")
    path = cfg.get("promptFile") if isinstance(cfg, dict) else None
    if not isinstance(path, str) or not path:
        raise _Fallback("prompt settings unreadable")
    try:
        text = _read_bounded(Path(path), MAX_PROMPT_BYTES, "prompt file too large")
    except _Fallback:
        raise
    except FileNotFoundError:
        raise _Fallback("prompt file missing")
    except Exception:
        raise _Fallback("prompt file unreadable")
    if not text.strip():
        raise _Fallback("prompt file empty")
    return text


def _replace_system(request: dict[str, Any], prompt_text: str, api_mode: str) -> dict[str, Any]:
    out = dict(request)
    if api_mode == "bedrock_converse":
        existing = out.get("system")
        blocks: list[dict[str, Any]] = [{"text": prompt_text}]
        if isinstance(existing, list):
            for block in existing:
                if isinstance(block, dict) and "cachePoint" in block:
                    blocks.append(block)
                    break
        out["system"] = blocks
        return out
    if api_mode == "anthropic_messages" or "system" in out:
        existing = out.get("system")
        if isinstance(existing, list):
            cache_control = None
            for block in existing:
                if isinstance(block, dict) and "cache_control" in block:
                    cache_control = block["cache_control"]
            new_block: dict[str, Any] = {"type": "text", "text": prompt_text}
            if cache_control is not None:
                new_block["cache_control"] = cache_control
            out["system"] = [new_block]
        else:
            out["system"] = prompt_text
        return out
    if api_mode == "codex_responses" or "instructions" in out:
        out["instructions"] = prompt_text
        return out
    messages = out.get("messages")
    if isinstance(messages, list):
        new_msgs = list(messages)
        if new_msgs and isinstance(new_msgs[0], dict) and new_msgs[0].get("role") == "system":
            new_msgs[0] = {**new_msgs[0], "content": prompt_text}
        else:
            new_msgs.insert(0, {"role": "system", "content": prompt_text})
        out["messages"] = new_msgs
    return out


def _engine_has_hook() -> bool:
    try:
        from hermes_cli.middleware import LLM_REQUEST_MIDDLEWARE, VALID_MIDDLEWARE

        return LLM_REQUEST_MIDDLEWARE == "llm_request" and LLM_REQUEST_MIDDLEWARE in VALID_MIDDLEWARE
    except Exception:
        return False


def register(ctx, has_hook=_engine_has_hook) -> None:
    profile_home = Path(__file__).resolve().parent.parent.parent
    status = _Status(profile_home)
    session_cache: OrderedDict[str, str] = OrderedDict()
    handled: OrderedDict[str, bool] = OrderedDict()

    def remember(request_id: str, applied: bool) -> None:
        if request_id:
            handled[request_id] = applied
            while len(handled) > MAX_CACHED_SESSIONS:
                handled.popitem(last=False)

    def on_llm_request(request: dict[str, Any], api_mode: str = "", session_id: str = "", api_request_id: str = "", **kwargs: Any):
        prompt_text = session_cache.get(session_id) if session_id else None
        if prompt_text is None:
            try:
                prompt_text = _read_prompt(profile_home)
            except _Fallback as fallback:
                remember(str(api_request_id), False)
                status.set("fallback", str(fallback))
                return None
            if session_id:
                session_cache[session_id] = prompt_text
                while len(session_cache) > MAX_CACHED_SESSIONS:
                    session_cache.popitem(last=False)
        else:
            session_cache.move_to_end(session_id)
        remember(str(api_request_id), True)
        status.set("active")
        return {
            "request": _replace_system(request, prompt_text, api_mode),
            "source": "lilbot-prompt-v1",
            "reason": "LilBot owns the system prompt",
        }

    def on_pre_api_request(api_request_id: str = "", middleware_trace: Any = None, **kwargs: Any) -> None:
        """Observes every main-loop request: one the middleware never saw, or whose swap Hermes dropped, is recorded."""
        if not api_request_id:
            return
        applied = handled.pop(str(api_request_id), None)
        if applied is None:
            status.set("fallback", "engine skipped the prompt hook")
        elif applied and not any(isinstance(e, dict) and e.get("source") == "lilbot-prompt-v1" for e in middleware_trace or []):
            status.set("fallback", "engine dropped the prompt")

    if not has_hook() or not callable(getattr(ctx, "register_middleware", None)):
        status.set("fallback", NO_HOOK)
        return
    ctx.register_middleware("llm_request", on_llm_request)
    if callable(getattr(ctx, "register_hook", None)):
        ctx.register_hook("pre_api_request", on_pre_api_request)
    # LilBot deletes the status file when it switches the plug-in on; any other load keeps what requests recorded.
    if status.recorded() in (None, NO_HOOK):
        status.set("ready")
