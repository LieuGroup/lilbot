"""Dumb pass-through Hermes llm_request middleware (hermes.middleware.v1).

Contains zero LilBot logic or prompt assembly: reads the exact UTF-8 prompt file
written by LilBot for this bot and substitutes it into outbound provider requests
while preserving prompt-cache breakpoints. Fails open to Hermes's default prompt
if settings or the prompt file are missing, unreadable, or empty, logging only a
fixed label (never prompt contents or paths).
"""
from __future__ import annotations

from collections import OrderedDict
import json
import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)
SETTINGS_FILE = "lilbot-prompt.json"
MAX_CACHED_SESSIONS = 64


def _read_prompt(profile_home: Path) -> str | None:
    try:
        cfg = json.loads((profile_home / SETTINGS_FILE).read_text(encoding="utf-8"))
        path = cfg.get("promptFile") if isinstance(cfg, dict) else None
        if not isinstance(path, str) or not path:
            logger.warning("lilbot-prompt: prompt file unavailable; falling back to engine prompt")
            return None
        text = Path(path).read_text(encoding="utf-8")
        if not text.strip():
            logger.warning("lilbot-prompt: prompt file empty; falling back to engine prompt")
            return None
        return text
    except Exception:
        logger.warning("lilbot-prompt: prompt file unavailable; falling back to engine prompt")
        return None


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


def register(ctx) -> None:
    profile_home = Path(__file__).resolve().parent.parent.parent
    session_cache: OrderedDict[str, str] = OrderedDict()

    def on_llm_request(request: dict[str, Any], api_mode: str = "", session_id: str = "", **kwargs: Any):
        prompt_text = session_cache.get(session_id) if session_id else None
        if prompt_text is None:
            prompt_text = _read_prompt(profile_home)
            if prompt_text is None:
                return None
            if session_id:
                session_cache[session_id] = prompt_text
                session_cache.move_to_end(session_id)
                while len(session_cache) > MAX_CACHED_SESSIONS:
                    session_cache.popitem(last=False)
        else:
            session_cache.move_to_end(session_id)
        return {
            "request": _replace_system(request, prompt_text, api_mode),
            "source": "lilbot-prompt-v1",
            "reason": "LilBot owns the system prompt",
        }

    ctx.register_middleware("llm_request", on_llm_request)
