from app.utils.json_tools import normalize_dashboard_spec, replace_query_placeholders


def test_normalize_blocks_with_inline_props():
    spec = {
        "blocks": [
            {"type": "kpi-card", "ticker": "AAPL", "metric": "YTD", "value": "+10%", "change": "+1%", "changeDirection": "up"}
        ]
    }
    normalized = normalize_dashboard_spec(spec)
    assert normalized["blocks"][0]["type"] == "kpi-card"
    assert normalized["blocks"][0]["props"]["ticker"] == "AAPL"


def test_normalize_blocks_with_props_passthrough():
    spec = {
        "blocks": [
            {"type": "executive-summary", "props": {"content": "Hello"}}
        ]
    }
    normalized = normalize_dashboard_spec(spec)
    assert normalized["blocks"][0]["props"]["content"] == "Hello"


def test_replace_query_placeholders():
    spec = {
        "blocks": [
            {"type": "line-chart", "props": {"data": "QUERY_RESULT_0", "xKey": "date", "yKeys": ["AAPL"]}}
        ]
    }
    hydrated = replace_query_placeholders(spec, [[{"date": "2024-01-01", "AAPL": 100}]])
    assert hydrated["blocks"][0]["props"]["data"][0]["AAPL"] == 100
