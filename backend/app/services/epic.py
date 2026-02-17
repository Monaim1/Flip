from __future__ import annotations

import asyncio
import logging
from typing import Any, AsyncGenerator, Dict, Optional

from app.services.agent import agent_service
from app.services.ui_agent import ui_agent_service

logger = logging.getLogger(__name__)


class EPICCoordinatorService:
    """Run voice and UI inference loops in parallel and merge stream events."""

    async def stream_turn(
        self,
        message: str,
        current_chaos: Optional[Dict[str, Any]],
        user_id: str,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        queue: asyncio.Queue[Dict[str, Any]] = asyncio.Queue()
        voice_result: Dict[str, Any] = {}
        voice_result_ready = asyncio.Event()

        async def run_voice_agent() -> None:
            try:
                async for event in agent_service.process_query_stream(
                    message,
                    current_chaos,
                ):
                    await queue.put(event)
                    if event.get("event") == "result":
                        data = event.get("data")
                        if isinstance(data, dict):
                            voice_result.update(data)
                        voice_result_ready.set()
            except Exception as exc:
                logger.exception("Voice agent stream failed in EPIC coordinator")
                await queue.put(
                    {"event": "error", "data": {"detail": str(exc)}}
                )
            finally:
                voice_result_ready.set()
                await queue.put({"event": "__voice_done__", "data": {}})

        async def run_ui_agent() -> None:
            try:
                initial_ui_events = await ui_agent_service.on_user_message(
                    user_id=user_id,
                    message=message,
                )
                for ui_event in initial_ui_events:
                    await queue.put(ui_event)

                await voice_result_ready.wait()
                if voice_result:
                    follow_up_events = await ui_agent_service.on_voice_result(
                        user_id=user_id,
                        voice_result=voice_result,
                    )
                    for ui_event in follow_up_events:
                        await queue.put(ui_event)
            except Exception as exc:
                logger.exception("UI agent stream failed in EPIC coordinator")
                await queue.put(
                    {"event": "ui_error", "data": {"detail": str(exc)}}
                )
            finally:
                await queue.put({"event": "__ui_done__", "data": {}})

        voice_task = asyncio.create_task(run_voice_agent())
        ui_task = asyncio.create_task(run_ui_agent())

        done_count = 0
        try:
            while done_count < 2:
                next_event = await queue.get()
                event_type = next_event.get("event")
                if event_type in {"__voice_done__", "__ui_done__"}:
                    done_count += 1
                    continue
                yield next_event
        finally:
            for task in (voice_task, ui_task):
                if not task.done():
                    task.cancel()
            await asyncio.gather(voice_task, ui_task, return_exceptions=True)


epic_coordinator_service = EPICCoordinatorService()
