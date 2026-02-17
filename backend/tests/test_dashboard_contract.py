from app.utils.dashboard_contract import sanitize_dashboard_spec


def test_line_chart_contract_coerces_unusable_ykeys():
    spec, warnings = sanitize_dashboard_spec(
        {
            "blocks": [
                {
                    "type": "line-chart",
                    "props": {
                        "title": "AAPL stock performance",
                        "data": [
                            {
                                "date": "2025-01-01",
                                "open": 100,
                                "high": 105,
                                "low": 99,
                                "close": 103,
                            }
                        ],
                        "xKey": "date",
                        "yKeys": ["AAPL"],
                    },
                }
            ]
        }
    )

    props = spec["blocks"][0]["props"]
    assert "close" in props["yKeys"]
    assert props["xKey"] == "date"
    assert isinstance(warnings, list)


def test_event_timeline_contract_maps_news_like_rows():
    spec, _ = sanitize_dashboard_spec(
        {
            "blocks": [
                {
                    "type": "event-timeline",
                    "props": {
                        "events": [
                            {
                                "ticker": "AAPL",
                                "date": "2025-01-02",
                                "title": "Apple event",
                                "source": "Reuters",
                                "sentiment": 0.7,
                            }
                        ]
                    },
                }
            ]
        }
    )

    event = spec["blocks"][0]["props"]["events"][0]
    assert event["entry_type"] == "news"
    assert event["summary"] == "Apple event"
    assert event["sentiment_score"] == 0.7
    assert event["price_impact_pct"] == 0.0


def test_contract_drops_unsupported_blocks():
    spec, warnings = sanitize_dashboard_spec(
        {
            "blocks": [
                {"type": "radar-chart", "props": {"data": []}},
                {"type": "executive-summary", "props": {"content": "ok"}},
            ]
        }
    )
    assert len(spec["blocks"]) == 1
    assert spec["blocks"][0]["type"] == "executive-summary"
    assert any("unsupported type" in warning for warning in warnings)
