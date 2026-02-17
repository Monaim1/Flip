import asyncio

from app.services.ui_agent import UIAgentService


def test_ui_agent_registers_then_resolves_focus_intent():
    service = UIAgentService()

    initial_events = asyncio.run(
        service.on_user_message(
            user_id="test-user",
            message="Show it on the dashboard",
        )
    )
    assert any(event["event"] == "ui_intent" for event in initial_events)

    follow_up_events = asyncio.run(
        service.on_voice_result(
            user_id="test-user",
            voice_result={
                "assistantMessage": "AAPL had the strongest move today.",
                "dashboardSpec": {
                    "blocks": [
                        {
                            "type": "line-chart",
                            "props": {
                                "title": "AAPL last 30 days",
                                "ticker": "AAPL",
                                "xKey": "date",
                                "yKeys": ["AAPL"],
                                "data": [],
                            },
                        }
                    ]
                },
            },
        )
    )

    ui_commands = [event for event in follow_up_events if event["event"] == "ui_command"]
    assert ui_commands
    assert ui_commands[0]["data"]["type"] == "focus_ticker"
    assert ui_commands[0]["data"]["payload"]["ticker"] == "AAPL"
