from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_google_genai import ChatGoogleGenerativeAI

from app.core.config import settings
from app.services.prompts import build_ui_agent_prompt
from app.utils.json_tools import parse_json_from_text

logger = logging.getLogger(__name__)

SUPPORTED_TICKERS = {"AAPL", "MSFT", "TSLA", "BTC", "SP500"}
SUPPORTED_BLOCK_TYPES = {
    "executive-summary",
    "kpi-card",
    "line-chart",
    "candlestick-chart",
    "event-timeline",
    "correlation-matrix",
}
SUPPORTED_TIME_RANGES = {"7d", "30d", "3m", "6m", "1y", "all"}


@dataclass
class PendingUIIntent:
    goal: str
    requested_action: str
    missing: List[str] = field(default_factory=list)
    created_at: float = field(default_factory=time.time)


@dataclass
class UIAgentState:
    context_notes: str = ""
    pending_intents: List[PendingUIIntent] = field(default_factory=list)


def _normalize_ticker(value: Any) -> Optional[str]:
    if not isinstance(value, str):
        return None
    upper = value.strip().upper()
    return upper if upper in SUPPORTED_TICKERS else None


def _infer_ticker_from_text(text: str) -> Optional[str]:
    if not text:
        return None
    upper = text.upper()
    if "S&P 500" in upper or "SP500" in upper or "SPX" in upper:
        return "SP500"
    if "BITCOIN" in upper or " BTC " in f" {upper} ":
        return "BTC"
    for ticker in ("AAPL", "MSFT", "TSLA"):
        if ticker in upper:
            return ticker
    return None


def _infer_time_range_from_text(text: str) -> Optional[str]:
    if not text:
        return None
    lower = text.lower()
    if "all time" in lower or "entire history" in lower:
        return "all"
    if "last week" in lower or "past week" in lower or "this week" in lower:
        return "7d"
    if "last month" in lower or "past month" in lower or "this month" in lower:
        return "30d"
    if "last quarter" in lower or "this quarter" in lower:
        return "3m"
    if "last year" in lower or "this year" in lower:
        return "1y"

    days_match = re.search(r"last\s+(\d+)\s+day", lower)
    if days_match:
        try:
            days = int(days_match.group(1))
            if days <= 7:
                return "7d"
            if days <= 30:
                return "30d"
            if days <= 90:
                return "3m"
            if days <= 180:
                return "6m"
            if days <= 365:
                return "1y"
            return "all"
        except ValueError:
            return None

    return None


def _infer_ticker_from_voice_result(voice_result: Dict[str, Any]) -> Optional[str]:
    if not isinstance(voice_result, dict):
        return None

    dashboard = voice_result.get("dashboardSpec")
    if isinstance(dashboard, dict):
        blocks = dashboard.get("blocks")
        if isinstance(blocks, list):
            for block in blocks:
                if not isinstance(block, dict):
                    continue
                props = block.get("props")
                if not isinstance(props, dict):
                    continue

                ticker = _normalize_ticker(props.get("ticker"))
                if ticker:
                    return ticker

                y_keys = props.get("yKeys")
                if isinstance(y_keys, list):
                    for key in y_keys:
                        ticker = _normalize_ticker(key)
                        if ticker:
                            return ticker

                title = props.get("title")
                if isinstance(title, str):
                    ticker = _infer_ticker_from_text(title)
                    if ticker:
                        return ticker

    assistant = voice_result.get("assistantMessage")
    if isinstance(assistant, str):
        return _infer_ticker_from_text(assistant)
    return None


def _summarize_voice_result(voice_result: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not isinstance(voice_result, dict):
        return {}

    assistant = voice_result.get("assistantMessage")
    assistant_text = assistant[:500] if isinstance(assistant, str) else ""
    intent = voice_result.get("intent")
    dashboard = voice_result.get("dashboardSpec")

    return {
        "intent": intent if isinstance(intent, str) else "",
        "assistantMessage": assistant_text,
        "dashboardSpec": dashboard if isinstance(dashboard, dict) else {},
    }


def _sanitize_command(command: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(command, dict):
        return None
    command_type = command.get("type")
    payload = command.get("payload")

    if not isinstance(command_type, str) or not command_type:
        return None
    if payload is None:
        payload = {}
    if not isinstance(payload, dict):
        return None

    if command_type == "set_time_range":
        value = payload.get("range")
        if isinstance(value, str) and value in SUPPORTED_TIME_RANGES:
            return {"type": command_type, "payload": {"range": value}}
        return None

    if command_type == "focus_ticker":
        ticker = _normalize_ticker(payload.get("ticker"))
        if ticker:
            return {"type": command_type, "payload": {"ticker": ticker}}
        return None

    if command_type == "set_visible_blocks":
        types = payload.get("types")
        if isinstance(types, list):
            filtered = [
                t for t in types if isinstance(t, str) and t in SUPPORTED_BLOCK_TYPES
            ]
            if filtered:
                return {"type": command_type, "payload": {"types": filtered}}
        return None

    if command_type == "set_chaos":
        allowed = {"rotation", "fontFamily", "animation", "theme"}
        filtered_payload = {k: v for k, v in payload.items() if k in allowed}
        if filtered_payload:
            return {"type": command_type, "payload": filtered_payload}
        return None

    if command_type in {"clear_focus", "reset_ui"}:
        return {"type": command_type, "payload": {}}

    return None


class UIAgentService:
    def __init__(self) -> None:
        self._state_by_user: Dict[str, UIAgentState] = {}
        self._state_lock = asyncio.Lock()

    async def _get_state(self, user_id: str) -> UIAgentState:
        key = user_id or "local"
        async with self._state_lock:
            if key not in self._state_by_user:
                self._state_by_user[key] = UIAgentState()
            return self._state_by_user[key]

    def _state_payload(self, state: UIAgentState) -> Dict[str, Any]:
        return {
            "contextNotes": state.context_notes,
            "pendingIntentCount": len(state.pending_intents),
            "pendingIntents": [asdict(intent) for intent in state.pending_intents],
        }

    async def on_user_message(
        self,
        user_id: str,
        message: str,
    ) -> List[Dict[str, Any]]:
        state = await self._get_state(user_id)
        decision = await self._decide(
            trigger="user_message",
            user_message=message,
            state=state,
            voice_result=None,
        )
        events = self._apply_decision(state, decision)
        events.append({"event": "ui_state", "data": self._state_payload(state)})
        return events

    async def on_voice_result(
        self,
        user_id: str,
        voice_result: Dict[str, Any],
    ) -> List[Dict[str, Any]]:
        state = await self._get_state(user_id)

        if not state.pending_intents:
            return []

        decision = await self._decide(
            trigger="voice_result",
            user_message="",
            state=state,
            voice_result=voice_result,
        )
        events = self._apply_decision(state, decision)

        # If the model still returns no-op, try deterministic resolution.
        if not any(e.get("event") == "ui_command" for e in events):
            fallback = self._resolve_pending_intent_fallback(state, voice_result)
            if fallback:
                state.pending_intents = state.pending_intents[1:]
                events.append({"event": "ui_command", "data": fallback})

        events.append({"event": "ui_state", "data": self._state_payload(state)})
        return events

    def _apply_decision(
        self,
        state: UIAgentState,
        decision: Dict[str, Any],
    ) -> List[Dict[str, Any]]:
        events: List[Dict[str, Any]] = []

        context_notes = decision.get("contextNotes")
        if isinstance(context_notes, str):
            state.context_notes = context_notes.strip()[:1200]

        decision_type = decision.get("decision")
        if decision_type == "register_intent":
            intent = decision.get("intent")
            if isinstance(intent, dict):
                goal = str(intent.get("goal") or "Pending UI action").strip()
                requested_action = str(intent.get("requestedAction") or "unknown").strip()
                missing_raw = intent.get("missing")
                missing = (
                    [m for m in missing_raw if isinstance(m, str)]
                    if isinstance(missing_raw, list)
                    else []
                )
                state.pending_intents.append(
                    PendingUIIntent(
                        goal=goal,
                        requested_action=requested_action,
                        missing=missing,
                    )
                )
                if len(state.pending_intents) > 5:
                    state.pending_intents = state.pending_intents[-5:]
                events.append(
                    {
                        "event": "ui_intent",
                        "data": {
                            "status": "registered",
                            "intent": asdict(state.pending_intents[-1]),
                        },
                    }
                )
            return events

        if decision_type == "command":
            command = _sanitize_command(decision.get("command"))
            if command:
                if state.pending_intents:
                    state.pending_intents = state.pending_intents[1:]
                events.append({"event": "ui_command", "data": command})
            return events

        return events

    def _resolve_pending_intent_fallback(
        self,
        state: UIAgentState,
        voice_result: Dict[str, Any],
    ) -> Optional[Dict[str, Any]]:
        if not state.pending_intents:
            return None
        first_intent = state.pending_intents[0]
        missing = set(first_intent.missing)

        ticker = _infer_ticker_from_voice_result(voice_result)
        if "ticker" in missing and ticker:
            return {"type": "focus_ticker", "payload": {"ticker": ticker}}

        if "timeRange" in missing:
            range_value = _infer_time_range_from_text(
                str(voice_result.get("assistantMessage") or "")
            )
            if range_value:
                return {"type": "set_time_range", "payload": {"range": range_value}}

        return None

    async def _decide(
        self,
        trigger: str,
        user_message: str,
        state: UIAgentState,
        voice_result: Optional[Dict[str, Any]],
    ) -> Dict[str, Any]:
        if not settings.gemini_api_key:
            return self._heuristic_decision(
                trigger=trigger,
                user_message=user_message,
                state=state,
                voice_result=voice_result,
            )

        try:
            llm = ChatGoogleGenerativeAI(
                model=settings.gemini_model,
                google_api_key=settings.gemini_api_key,
                temperature=0.0,
                convert_system_message_to_human=True,
            )
            payload = {
                "trigger": trigger,
                "userMessage": user_message,
                "contextNotes": state.context_notes,
                "pendingIntents": [asdict(intent) for intent in state.pending_intents],
                "latestVoiceResult": _summarize_voice_result(voice_result),
            }
            result = await llm.ainvoke(
                [
                    SystemMessage(content=build_ui_agent_prompt()),
                    HumanMessage(content=json.dumps(payload, default=str)),
                ]
            )
            content = result.content if hasattr(result, "content") else str(result)
            if not isinstance(content, str):
                content = str(content)
            parsed = parse_json_from_text(content)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            logger.exception("UI agent inference failed, using fallback heuristics")

        return self._heuristic_decision(
            trigger=trigger,
            user_message=user_message,
            state=state,
            voice_result=voice_result,
        )

    def _heuristic_decision(
        self,
        trigger: str,
        user_message: str,
        state: UIAgentState,
        voice_result: Optional[Dict[str, Any]],
    ) -> Dict[str, Any]:
        if trigger == "voice_result":
            fallback_command = self._resolve_pending_intent_fallback(
                state,
                voice_result or {},
            )
            if fallback_command:
                return {
                    "decision": "command",
                    "command": fallback_command,
                    "intent": None,
                    "contextNotes": state.context_notes,
                }
            return {
                "decision": "none",
                "command": None,
                "intent": None,
                "contextNotes": state.context_notes,
            }

        text = user_message or ""
        lower = text.lower()
        ticker = _infer_ticker_from_text(text)
        time_range = _infer_time_range_from_text(text)
        wants_ui_action = bool(
            re.search(
                r"\b(show|focus|highlight|filter|display|hide|only|zoom|switch|set|change)\b",
                lower,
            )
        )

        if "professional mode" in lower:
            return {
                "decision": "command",
                "command": {
                    "type": "set_chaos",
                    "payload": {
                        "rotation": 0,
                        "fontFamily": "Inter",
                        "animation": None,
                        "theme": "professional",
                    },
                },
                "intent": None,
                "contextNotes": "User asked to reset UI chaos settings.",
            }

        if "matrix mode" in lower:
            return {
                "decision": "command",
                "command": {
                    "type": "set_chaos",
                    "payload": {"theme": "matrix"},
                },
                "intent": None,
                "contextNotes": "User asked for matrix theme.",
            }

        if wants_ui_action and time_range:
            return {
                "decision": "command",
                "command": {
                    "type": "set_time_range",
                    "payload": {"range": time_range},
                },
                "intent": None,
                "contextNotes": f"Active chart window set to {time_range}.",
            }

        if wants_ui_action and ticker:
            return {
                "decision": "command",
                "command": {
                    "type": "focus_ticker",
                    "payload": {"ticker": ticker},
                },
                "intent": None,
                "contextNotes": f"Focused ticker context on {ticker}.",
            }

        if wants_ui_action and not ticker:
            return {
                "decision": "register_intent",
                "command": None,
                "intent": {
                    "goal": "Apply UI focus once ticker is known",
                    "requestedAction": "focus_ticker",
                    "missing": ["ticker"],
                },
                "contextNotes": "Deferred UI focus; waiting for ticker from voice-agent result.",
            }

        return {
            "decision": "none",
            "command": None,
            "intent": None,
            "contextNotes": state.context_notes,
        }


ui_agent_service = UIAgentService()
