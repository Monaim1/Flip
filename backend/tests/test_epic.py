from fastapi.testclient import TestClient

from app.main import app
from app.services import epic as epic_module


def test_epic_stream_emits_voice_and_ui_events(monkeypatch):
    async def fake_stream_turn(message, current_chaos, user_id):
        yield {"event": "content", "data": {"delta": "Hi "}}
        yield {
            "event": "ui_intent",
            "data": {
                "status": "registered",
                "intent": {"goal": "Focus ticker", "requested_action": "focus_ticker"},
            },
        }
        yield {
            "event": "ui_command",
            "data": {"type": "focus_ticker", "payload": {"ticker": "AAPL"}},
        }
        yield {
            "event": "result",
            "data": {
                "intent": "performance",
                "assistantMessage": "Done",
                "dashboardSpec": {"blocks": []},
            },
        }

    monkeypatch.setattr(epic_module.epic_coordinator_service, "stream_turn", fake_stream_turn)

    client = TestClient(app)
    response = client.post("/api/query/epic-stream", json={"message": "show me apple"})

    assert response.status_code == 200
    body = response.text
    assert "event: ui_intent" in body
    assert "event: ui_command" in body
    assert "event: result" in body
    assert "event: done" in body
