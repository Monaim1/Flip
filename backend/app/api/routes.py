from __future__ import annotations

import asyncio
import base64
import json
import logging
import time
from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException, Response, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
import httpx
import websockets

from app.core.config import settings
from app.schemas.api import QueryRequest, QueryResponse, DashboardSpec, TTSRequest
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


def _maybe_strip_blocks(
    hydrated_spec: Dict[str, Any],
    intent: str,
    sql_queries: List[str],
    safe_queries: List[str],
) -> Dict[str, Any]:
    """Avoid rendering generic blocks for small talk / no-data responses."""
    blocks = hydrated_spec.get("blocks") if isinstance(hydrated_spec, dict) else None
    if not isinstance(blocks, list):
        return hydrated_spec

    # If no SQL queries were executed, prefer no dashboard blocks
    if not safe_queries:
        only_exec_summary = (
            len(blocks) == 1
            and isinstance(blocks[0], dict)
            and blocks[0].get("type") == "executive-summary"
        )
        if only_exec_summary or intent == "conversation":
            hydrated_spec["blocks"] = []
    return hydrated_spec


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
    hydrated_spec = _maybe_strip_blocks(hydrated_spec, intent, sql_queries, safe_queries)

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
        streamed_content = False
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
                    intent = data.get("intent", "unknown") if isinstance(data, dict) else "unknown"
                    hydrated_spec = _maybe_strip_blocks(hydrated_spec, intent, sql_queries, safe_queries)
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
                    # If the model never streamed content, simulate a short stream from assistantMessage
                    assistant_msg = final.get("assistantMessage") or ""
                    if assistant_msg and not streamed_content:
                        chunk_size = 80
                        for i in range(0, len(assistant_msg), chunk_size):
                            chunk = assistant_msg[i : i + chunk_size]
                            yield f"event: content\ndata: {json.dumps({'delta': chunk}, default=str)}\n\n"
                        streamed_content = True
                    yield f"event: result\ndata: {json.dumps(final, default=str)}\n\n"
                elif event_type == "content":
                    streamed_content = True
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


# ── Voice (Gradium proxy) ──


def _gradium_ws_url(kind: str) -> str:
    region = settings.gradium_region or "eu"
    if kind == "stt":
        return f"wss://{region}.api.gradium.ai/api/speech/asr"
    return f"wss://{region}.api.gradium.ai/api/speech/tts"


def _gradium_http_tts_url() -> str:
    region = settings.gradium_region or "eu"
    return f"https://{region}.api.gradium.ai/api/post/speech/tts"


@router.websocket("/api/voice/stt")
async def voice_stt_websocket(client_ws: WebSocket) -> None:
    if not settings.gradium_api_key:
        await client_ws.accept()
        await client_ws.send_text(json.dumps({"type": "error", "detail": "GRADIUM_API_KEY not configured"}))
        await client_ws.close(code=1011)
        return

    await client_ws.accept()
    gradium_url = _gradium_ws_url("stt")

    try:
        async with websockets.connect(
            gradium_url,
            extra_headers={"x-api-key": settings.gradium_api_key},
            max_size=None,
        ) as gradium_ws:
            setup_msg = {
                "type": "setup",
                "model_name": settings.gradium_stt_model,
                "input_format": "pcm",
            }
            await gradium_ws.send(json.dumps(setup_msg))

            async def forward_client_to_gradium() -> None:
                while True:
                    message = await client_ws.receive()
                    if message.get("type") == "websocket.disconnect":
                        break
                    if "bytes" in message and message["bytes"] is not None:
                        audio_b64 = base64.b64encode(message["bytes"]).decode("ascii")
                        await gradium_ws.send(json.dumps({"type": "audio", "audio": audio_b64}))
                    elif "text" in message and message["text"] is not None:
                        await gradium_ws.send(message["text"])

            async def forward_gradium_to_client() -> None:
                async for message in gradium_ws:
                    await client_ws.send_text(message)

            client_task = asyncio.create_task(forward_client_to_gradium())
            gradium_task = asyncio.create_task(forward_gradium_to_client())
            done, pending = await asyncio.wait(
                {client_task, gradium_task},
                return_when=asyncio.FIRST_COMPLETED,
            )
            for task in pending:
                task.cancel()
            for task in done:
                if task.exception():
                    raise task.exception()
    except WebSocketDisconnect:
        return
    except Exception as exc:
        logger.exception("Voice STT proxy failed")
        try:
            await client_ws.send_text(json.dumps({"type": "error", "detail": str(exc)}))
        finally:
            await client_ws.close(code=1011)


@router.post("/api/voice/tts")
async def voice_tts(request: TTSRequest) -> Response:
    if not settings.gradium_api_key:
        raise HTTPException(status_code=500, detail="GRADIUM_API_KEY not configured")

    text = (request.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Text is required")

    payload = {
        "text": text,
        "voice_id": settings.gradium_tts_voice_id,
        "model_name": settings.gradium_tts_model,
        "output_format": settings.gradium_tts_output_format,
        "only_audio": True,
    }
    headers = {"x-api-key": settings.gradium_api_key}
    tts_url = _gradium_http_tts_url()

    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(tts_url, json=payload, headers=headers)

    if resp.status_code >= 400:
        logger.error("Gradium TTS failed", extra={"status": resp.status_code, "detail": resp.text})
        raise HTTPException(status_code=502, detail="Gradium TTS failed")

    media_type = "audio/wav" if settings.gradium_tts_output_format == "wav" else "application/octet-stream"
    return Response(content=resp.content, media_type=media_type)
