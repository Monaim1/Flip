from fastapi.testclient import TestClient

from app.main import app
from app.services import agent as agent_module
from app.services import db as db_module


def test_query_endpoint_hydrates_results_and_carries_chaos(monkeypatch):
    async def fake_process_query(message, current_chaos=None):
        return {
            "intent": "performance",
            "assistantMessage": "ok",
            "sqlQueries": ["SELECT * FROM stock_prices LIMIT 1"],
            "dashboardSpec": {
                "blocks": [
                    {
                        "type": "line-chart",
                        "props": {
                            "title": "Test",
                            "data": "QUERY_RESULT_0",
                            "xKey": "date",
                            "yKeys": ["AAPL"],
                        },
                    }
                ]
            },
        }

    def fake_query(sql, params=None):
        return [{"date": "2024-01-01", "AAPL": 100}]

    monkeypatch.setattr(agent_module.agent_service, "process_query", fake_process_query)
    monkeypatch.setattr(db_module.db_service, "query", fake_query)

    client = TestClient(app)
    response = client.post(
        "/api/query",
        json={
            "message": "Show me AAPL",
            "currentChaos": {"rotation": 180, "theme": "matrix"},
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["intent"] == "performance"
    assert payload["dashboardSpec"]["blocks"][0]["props"]["data"][0]["AAPL"] == 100
    assert payload["dashboardSpec"]["chaos"]["rotation"] == 180


def test_query_endpoint_applies_chaos_commands_deterministically(monkeypatch):
    async def fake_process_query(message, current_chaos=None):
        return {
            "intent": "conversation",
            "assistantMessage": "Applied settings.",
            "sqlQueries": [],
            "dashboardSpec": {"blocks": []},
        }

    monkeypatch.setattr(agent_module.agent_service, "process_query", fake_process_query)

    client = TestClient(app)
    response = client.post(
        "/api/query",
        json={
            "message": "flip this and make it comic sense please",
            "currentChaos": {"rotation": 0, "fontFamily": "Inter", "theme": "professional"},
        },
    )

    assert response.status_code == 200
    payload = response.json()
    chaos = payload["dashboardSpec"]["chaos"]
    assert chaos["rotation"] == 180
    assert "Comic Sans" in chaos["fontFamily"]
