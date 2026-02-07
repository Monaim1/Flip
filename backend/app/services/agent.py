"""LangGraph agent service for FinanceFlip.

Uses Gemini (via langchain-google-genai) as the LLM inside a LangGraph
ReAct agent with DuckDB tools.  Replaces the old single-shot LLMService.
"""

from __future__ import annotations

import json
import logging
from typing import Any, AsyncGenerator, Dict, Optional

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_google_genai import ChatGoogleGenerativeAI
from langgraph.prebuilt import create_react_agent

from app.core.config import settings
from app.services.prompts import build_agent_prompt
from app.services.tools import get_all_tools
from app.utils.json_tools import parse_json_from_text

logger = logging.getLogger(__name__)


def _build_llm() -> ChatGoogleGenerativeAI:
    """Construct the Gemini chat model."""
    return ChatGoogleGenerativeAI(
        model=settings.gemini_model,
        google_api_key=settings.gemini_api_key,
        temperature=0.2,
        convert_system_message_to_human=True,
    )


def _build_graph():
    """Build a LangGraph ReAct agent wired to Gemini + FinanceFlip tools."""
    llm = _build_llm()
    tools = get_all_tools()
    return create_react_agent(llm, tools).with_config({"recursion_limit": 50})


# Module-level singleton (lazy)
_graph = None


def _get_graph():
    global _graph
    if _graph is None:
        _graph = _build_graph()
    return _graph


def _extract_text(content: Any) -> str:
    """Extract text from a message content that may be str or list-of-parts."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for part in content:
            if isinstance(part, dict):
                parts.append(part.get("text", str(part)))
            elif isinstance(part, str):
                parts.append(part)
            else:
                parts.append(str(part))
        return "\n".join(parts)
    return str(content) if content else ""


def _parse_agent_result(ai_messages: list, current_chaos: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Extract and parse the final JSON from agent messages, including tool results."""
    final_text = ""
    tool_results = []

    for msg in ai_messages:
        # Detect tool results from run_query
        if getattr(msg, "type", "") == "tool" or (hasattr(msg, "tool_calls") and not getattr(msg, "tool_calls", None)):
            # In LangGraph/LangChain, ToolMessages have the result in .content
            if getattr(msg, "name", "") == "run_query":
                try:
                    res = json.loads(getattr(msg, "content", "[]"))
                    if isinstance(res, list):
                        tool_results.append(res)
                except Exception:
                    pass
        
        # Capture the last assistant message as potential JSON carrier
        if getattr(msg, "type", "") == "ai":
            raw = getattr(msg, "content", None)
            text = _extract_text(raw)
            if text.strip():
                final_text = text

    logger.debug("Parsing agent result from %d messages", len(ai_messages))
    for i, msg in enumerate(ai_messages):
        logger.debug("Message %d: type=%s, content_len=%d", i, getattr(msg, "type", "unknown"), len(str(getattr(msg, "content", ""))))

    if not final_text:
        logger.error("No text response found in messages: %r", ai_messages)
        return {
            "intent": "conversation",
            "sqlQueries": [],
            "toolResults": tool_results,
            "assistantMessage": "I can help with that. Could you clarify which stocks or time range you want?",
            "dashboardSpec": {"blocks": [], "chaos": current_chaos or {}},
        }

    logger.debug("Final text for parsing (len=%d): %r", len(final_text), final_text[:500] + "..." if len(final_text) > 500 else final_text)

    try:
        parsed = parse_json_from_text(final_text)
        logger.debug("Successfully parsed JSON")
        # Attach collected tool results for hydration
        parsed["toolResults"] = tool_results
        return parsed
    except Exception as e:
        logger.warning("JSON parsing failed in _parse_agent_result: %s", str(e))
        logger.info("Agent returned non-JSON text; wrapping as conversational response")
        return {
            "intent": "conversation",
            "sqlQueries": [],
            "toolResults": tool_results,
            "assistantMessage": final_text,
            "dashboardSpec": {"blocks": [], "chaos": current_chaos or {}},
        }


class AgentService:
    """Thin wrapper that invokes the LangGraph agent and parses its output."""

    async def process_query(
        self,
        message: str,
        current_chaos: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Run the agent and return the parsed JSON spec (non-streaming)."""
        graph = _get_graph()
        system_prompt = build_agent_prompt(current_chaos)

        result = await graph.ainvoke({
            "messages": [
                SystemMessage(content=system_prompt),
                HumanMessage(content=message),
            ]
        })

        ai_messages = result.get("messages", [])
        if not ai_messages:
            raise ValueError("Agent returned no messages")

        return _parse_agent_result(ai_messages, current_chaos)

    async def process_query_stream(
        self,
        message: str,
        current_chaos: Optional[Dict[str, Any]] = None,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """Run the agent and yield SSE events as it progresses.

        Yields dicts with {"event": ..., "data": ...} suitable for SSE.
        Events:
          - "step"  : agent thinking / tool call info
          - "result" : final parsed JSON response
          - "error"  : error message
        """
        graph = _get_graph()
        system_prompt = build_agent_prompt(current_chaos)

        inputs = {
            "messages": [
                SystemMessage(content=system_prompt),
                HumanMessage(content=message),
            ]
        }

        all_messages: list = []
        tool_results: list = []
        step_count = 0
        in_json_block = False

        try:
            async for event in graph.astream_events(inputs, version="v2"):
                kind = event.get("event", "")

                # Tool call started
                if kind == "on_tool_start":
                    tool_name = event.get("name", "unknown")
                    tool_input = event.get("data", {}).get("input", "")
                    step_count += 1
                    yield {
                        "event": "step",
                        "data": {
                            "step": step_count,
                            "type": "tool_call",
                            "tool": tool_name,
                            "input": str(tool_input)[:200],
                        },
                    }

                # Tool call finished
                elif kind == "on_tool_end":
                    tool_name = event.get("name", "unknown")
                    output = event.get("data", {}).get("output", "")
                    output_str = _extract_text(output) if not isinstance(output, str) else output
                    if tool_name == "run_query":
                        try:
                            parsed = json.loads(output_str)
                            if isinstance(parsed, list):
                                tool_results.append(parsed)
                        except Exception:
                            pass
                    yield {
                        "event": "step",
                        "data": {
                            "step": step_count,
                            "type": "tool_result",
                            "tool": tool_name,
                            "preview": output_str[:150],
                        },
                    }

                # Chat model streaming — capture deltas
                elif kind == "on_chat_model_stream":
                    delta = event.get("data", {}).get("chunk", None)
                    if delta and hasattr(delta, "content"):
                        content_delta = _extract_text(delta.content)
                        if content_delta and not in_json_block:
                            # Stop if we see { or ```
                            if "{" not in content_delta and "```" not in content_delta:
                                yield {
                                    "event": "content",
                                    "data": {"delta": content_delta},
                                }
                            else:
                                in_json_block = True
                                # Find whichever comes first
                                idx_json = content_delta.find("{")
                                idx_md = content_delta.find("```")
                                
                                # Use the smaller non-negative index
                                split_idx = -1
                                if idx_json != -1 and idx_md != -1:
                                    split_idx = min(idx_json, idx_md)
                                elif idx_json != -1:
                                    split_idx = idx_json
                                elif idx_md != -1:
                                    split_idx = idx_md
                                
                                if split_idx != -1:
                                    prefix = content_delta[:split_idx]
                                    if prefix:
                                        yield {
                                            "event": "content",
                                            "data": {"delta": prefix},
                                        }

                # Chat model finished — capture the full message for final result
                elif kind == "on_chat_model_end":
                    output = event.get("data", {}).get("output", None)
                    if output and hasattr(output, "content"):
                        all_messages.append(output)

            # Parse the final result
            if not all_messages:
                raise ValueError("Agent returned no messages")

            parsed = _parse_agent_result(all_messages, current_chaos)
            if isinstance(parsed, dict) and tool_results and not parsed.get("toolResults"):
                parsed["toolResults"] = tool_results
            yield {"event": "result", "data": parsed}

        except Exception as exc:
            logger.exception("Agent stream failed")
            yield {
                "event": "error",
                "data": {"detail": str(exc)},
            }


agent_service = AgentService()
