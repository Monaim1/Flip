from __future__ import annotations

import json
import logging
import time
from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from app.schemas.api import QueryRequest, QueryResponse, DashboardSpec
from app.services.agent import agent_service
from app.utils.json_tools import normalize_dashboard_spec, replace_query_placeholders
from app.utils.sql_guard import filter_safe_queries

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/health")
def health_check() -> Dict[str, str]:
    return {"status": "ok"}


def _finalize_spec(agent_result: Dict[str, Any], current_chaos: Any) -> Dict[str, Any]:
    """Normalize dashboard spec from agent result and carry forward chaos."""
    raw_spec = agent_result.get("dashboardSpec", {}) if isinstance(agent_result, dict) else {}
    normalized_spec_dict = normalize_dashboard_spec(raw_spec)

    # Use toolResults from the agent if available (preferred for LangGraph)
    tool_results = agent_result.get("toolResults", []) if isinstance(agent_result, dict) else []
    
    # Fallback/Belt-and-suspenders: Handle residual sqlQueries (old pattern)
    sql_queries: List[str] = agent_result.get("sqlQueries", []) if isinstance(agent_result, dict) else []
    safe_queries = filter_safe_queries(sql_queries)
    
    if tool_results:
        query_results = tool_results
    else:
        query_results = []
        if safe_queries:
            from app.services.db import db_service
            for sql in safe_queries:
                try:
                    query_results.append(db_service.query(sql))
                except Exception:
                    logger.exception("Residual SQL execution failed", extra={"sql": sql})
                    query_results.append([])

    hydrated_spec = replace_query_placeholders(normalized_spec_dict, query_results)

    if current_chaos and not hydrated_spec.get("chaos"):
        hydrated_spec["chaos"] = current_chaos

    return hydrated_spec, sql_queries, safe_queries


# ── Non-streaming endpoint (kept for backward compatibility) ──

@router.post("/api/query", response_model=QueryResponse)
async def handle_query(request: QueryRequest) -> QueryResponse:
    start_time = time.time()

    try:
        agent_result = await agent_service.process_query(
            request.message, request.currentChaos
        )
    except Exception as exc:
        logger.exception("Agent processing failed")
        raise HTTPException(status_code=502, detail="Agent processing failed") from exc

    hydrated_spec, sql_queries, safe_queries = _finalize_spec(agent_result, request.currentChaos)

    intent = agent_result.get("intent", "unknown") if isinstance(agent_result, dict) else "unknown"
    assistant_message = agent_result.get("assistantMessage", "") if isinstance(agent_result, dict) else ""

    elapsed_ms = int((time.time() - start_time) * 1000)
    return QueryResponse(
        dashboardSpec=DashboardSpec.model_validate(hydrated_spec),
        assistantMessage=assistant_message,
        intent=intent,
        queryMetadata={
            "executionTimeMs": elapsed_ms,
            "sqlQueriesRequested": len(sql_queries),
            "sqlQueriesExecuted": len(safe_queries),
        },
    )


# ── SSE streaming endpoint ──

@router.post("/api/query/stream")
async def handle_query_stream(request: QueryRequest) -> StreamingResponse:
    """Stream agent progress via Server-Sent Events.

    Events:
      event: step    — agent thinking steps (tool calls, results)
      event: result  — final JSON response (same shape as POST /api/query)
      event: error   — error detail
      event: done    — stream finished
    """
    start_time = time.time()

    async def event_generator():
        try:
            async for sse_event in agent_service.process_query_stream(
                request.message, request.currentChaos
            ):
                event_type = sse_event["event"]
                data = sse_event["data"]

                if event_type == "result":
                    # Finalize the spec the same way as the non-streaming path
                    hydrated_spec, sql_queries, safe_queries = _finalize_spec(
                        data, request.currentChaos
                    )
                    elapsed_ms = int((time.time() - start_time) * 1000)
                    final = {
                        "dashboardSpec": DashboardSpec.model_validate(hydrated_spec).model_dump(),
                        "assistantMessage": data.get("assistantMessage", ""),
                        "intent": data.get("intent", "unknown"),
                        "queryMetadata": {
                            "executionTimeMs": elapsed_ms,
                            "sqlQueriesRequested": len(sql_queries),
                            "sqlQueriesExecuted": len(safe_queries),
                        },
                    }
                    yield f"event: result\ndata: {json.dumps(final, default=str)}\n\n"
                elif event_type == "content":
                    yield f"event: content\ndata: {json.dumps(data, default=str)}\n\n"
                else:
                    yield f"event: {event_type}\ndata: {json.dumps(data, default=str)}\n\n"

        except Exception as exc:
            logger.exception("SSE stream failed")
            yield f"event: error\ndata: {json.dumps({'detail': str(exc)})}\n\n"

        yield "event: done\ndata: {}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
