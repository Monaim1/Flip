from __future__ import annotations

import math
import re
from typing import Any, Dict, List, Optional, Tuple


SUPPORTED_BLOCK_TYPES = {
    "executive-summary",
    "kpi-card",
    "line-chart",
    "candlestick-chart",
    "event-timeline",
    "correlation-matrix",
}

PREFERRED_SERIES_KEYS = ("close", "high", "low", "open", "volume")


def _as_str(value: Any, default: str = "") -> str:
    if value is None:
        return default
    if isinstance(value, str):
        return value
    return str(value)


def _to_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        parsed = float(value)
        return parsed if math.isfinite(parsed) else None
    if isinstance(value, str):
        cleaned = value.replace(",", "")
        cleaned = re.sub(r"[^0-9eE\.\-\+]", "", cleaned)
        if not cleaned:
            return None
        try:
            parsed = float(cleaned)
            return parsed if math.isfinite(parsed) else None
        except ValueError:
            return None
    return None


def _as_records(value: Any) -> List[Dict[str, Any]]:
    if not isinstance(value, list):
        return []
    records: List[Dict[str, Any]] = []
    for item in value:
        if isinstance(item, dict):
            records.append(item)
    return records


def _infer_x_key(records: List[Dict[str, Any]]) -> str:
    if not records:
        return "date"
    sample = next((row for row in records if isinstance(row, dict) and row), {})
    for key in ("date", "timestamp", "time"):
        if key in sample:
            return key
    if sample:
        return next(iter(sample.keys()))
    return "date"


def _infer_numeric_keys(records: List[Dict[str, Any]], exclude: set[str]) -> List[str]:
    if not records:
        return []
    candidate_scores: Dict[str, int] = {}
    for row in records:
        for key, value in row.items():
            if key in exclude:
                continue
            if _to_float(value) is not None:
                candidate_scores[key] = candidate_scores.get(key, 0) + 1

    if not candidate_scores:
        return []

    keys = sorted(candidate_scores.keys(), key=lambda k: (-candidate_scores[k], k))
    prioritized = [key for key in PREFERRED_SERIES_KEYS if key in candidate_scores]
    remaining = [key for key in keys if key not in prioritized]
    return prioritized + remaining


def _infer_ticker(text: str) -> Optional[str]:
    if not text:
        return None
    upper = text.upper()
    if "S&P 500" in upper or "SP500" in upper or "SPX" in upper:
        return "SP500"
    if "BTC" in upper or "BITCOIN" in upper:
        return "BTC"
    for ticker in ("AAPL", "MSFT", "TSLA"):
        if ticker in upper:
            return ticker
    return None


def _normalize_line_chart(
    props: Dict[str, Any],
    idx: int,
    warnings: List[str],
) -> Dict[str, Any]:
    raw_data = _as_records(props.get("data"))
    x_key = _as_str(props.get("xKey"), "").strip() or _infer_x_key(raw_data)

    raw_y_keys = props.get("yKeys")
    y_keys = (
        [_as_str(key).strip() for key in raw_y_keys if _as_str(key).strip()]
        if isinstance(raw_y_keys, list)
        else []
    )

    inferred = _infer_numeric_keys(raw_data, exclude={x_key})

    if raw_data:
        columns = set()
        for row in raw_data:
            columns.update(row.keys())
        y_keys = [key for key in y_keys if key in columns]

    if not y_keys:
        y_keys = inferred

    if not y_keys:
        y_keys = ["close"]
        warnings.append(f"block[{idx}] line-chart had no usable yKeys; defaulted to ['close']")

    ticker = _as_str(props.get("ticker"), "").strip().upper() or None
    if not ticker:
        ticker = _infer_ticker(_as_str(props.get("title"), ""))

    title = _as_str(props.get("title"), "").strip()
    if not title:
        title = f"{ticker} price series" if ticker else "Price series"

    cleaned_data: List[Dict[str, Any]] = []
    for row in raw_data:
        out: Dict[str, Any] = {}
        for key, value in row.items():
            if key == x_key:
                out[key] = _as_str(value, "")
            elif key in y_keys:
                numeric = _to_float(value)
                out[key] = numeric
            else:
                out[key] = value
        cleaned_data.append(out)

    normalized: Dict[str, Any] = {
        "title": title,
        "data": cleaned_data,
        "xKey": x_key,
        "yKeys": y_keys,
    }
    if ticker:
        normalized["ticker"] = ticker
    return normalized


def _normalize_candlestick_chart(
    props: Dict[str, Any],
    idx: int,
    warnings: List[str],
) -> Dict[str, Any]:
    raw_data = _as_records(props.get("data"))
    ticker = _as_str(props.get("ticker"), "").strip().upper()
    if not ticker:
        ticker = _infer_ticker(_as_str(props.get("title"), "")) or "UNKNOWN"
        warnings.append(f"block[{idx}] candlestick-chart missing ticker; inferred {ticker}")

    cleaned: List[Dict[str, Any]] = []
    for row in raw_data:
        cleaned.append(
            {
                "date": _as_str(row.get("date"), ""),
                "open": _to_float(row.get("open")),
                "high": _to_float(row.get("high")),
                "low": _to_float(row.get("low")),
                "close": _to_float(row.get("close")),
            }
        )

    return {"ticker": ticker, "data": cleaned}


def _normalize_kpi_card(
    props: Dict[str, Any],
    idx: int,
    warnings: List[str],
) -> Dict[str, Any]:
    direction = _as_str(props.get("changeDirection"), "").strip().lower()
    if direction not in {"up", "down"}:
        change_value = _as_str(props.get("change"), "")
        direction = "down" if change_value.strip().startswith("-") else "up"
        warnings.append(f"block[{idx}] kpi-card invalid changeDirection; inferred {direction}")

    return {
        "ticker": _as_str(props.get("ticker"), "UNKNOWN"),
        "metric": _as_str(props.get("metric"), "Metric"),
        "value": _as_str(props.get("value"), "N/A"),
        "change": _as_str(props.get("change"), "0"),
        "changeDirection": direction,
        "comparisonBenchmark": _as_str(props.get("comparisonBenchmark"), "")
        or None,
    }


def _normalize_event_timeline(props: Dict[str, Any]) -> Dict[str, Any]:
    raw_events = _as_records(props.get("events"))
    normalized_events: List[Dict[str, Any]] = []
    for event in raw_events:
        sentiment = _to_float(
            event.get("sentiment_score", event.get("sentiment", 0.0))
        )
        price_impact = _to_float(event.get("price_impact_pct", 0.0))
        normalized_events.append(
            {
                "date": _as_str(event.get("date"), ""),
                "ticker": _as_str(event.get("ticker"), "MARKET"),
                "entry_type": _as_str(event.get("entry_type"), "news"),
                "title": _as_str(event.get("title"), "Event"),
                "summary": _as_str(
                    event.get("summary"),
                    _as_str(event.get("title"), _as_str(event.get("source"), "")),
                ),
                "sentiment_score": sentiment if sentiment is not None else 0.0,
                "price_impact_pct": price_impact if price_impact is not None else 0.0,
            }
        )
    return {"events": normalized_events}


def _normalize_correlation_matrix(
    props: Dict[str, Any],
    idx: int,
    warnings: List[str],
) -> Dict[str, Any]:
    tickers = props.get("tickers")
    if isinstance(tickers, list):
        normalized_tickers = [
            _as_str(ticker).strip().upper()
            for ticker in tickers
            if _as_str(ticker).strip()
        ]
    else:
        normalized_tickers = []

    matrix = props.get("data")
    normalized_matrix: List[List[float]] = []
    if isinstance(matrix, list):
        for row in matrix:
            if not isinstance(row, list):
                continue
            normalized_row: List[float] = []
            for value in row:
                numeric = _to_float(value)
                normalized_row.append(numeric if numeric is not None else 0.0)
            normalized_matrix.append(normalized_row)

    if normalized_tickers and len(normalized_matrix) != len(normalized_tickers):
        warnings.append(
            f"block[{idx}] correlation-matrix dimension mismatch; matrix rows={len(normalized_matrix)} "
            f"tickers={len(normalized_tickers)}"
        )

    return {
        "tickers": normalized_tickers,
        "data": normalized_matrix,
        "period": _as_str(props.get("period"), "selected range"),
    }


def sanitize_dashboard_spec(
    spec: Any,
    assistant_message: str = "",
    chaos_fallback: Optional[Dict[str, Any]] = None,
) -> Tuple[Dict[str, Any], List[str]]:
    warnings: List[str] = []

    if not isinstance(spec, dict):
        normalized = {"blocks": []}
        if isinstance(chaos_fallback, dict):
            normalized["chaos"] = chaos_fallback
        return normalized, ["spec was not an object; replaced with empty blocks"]

    raw_blocks = spec.get("blocks")
    if not isinstance(raw_blocks, list):
        raw_blocks = []
        warnings.append("spec.blocks was not a list; replaced with empty list")

    normalized_blocks: List[Dict[str, Any]] = []
    for idx, block in enumerate(raw_blocks):
        if not isinstance(block, dict):
            warnings.append(f"block[{idx}] was not an object; dropped")
            continue

        block_type = _as_str(block.get("type"), "").strip()
        if block_type not in SUPPORTED_BLOCK_TYPES:
            warnings.append(f"block[{idx}] unsupported type '{block_type}'; dropped")
            continue

        props = block.get("props")
        if not isinstance(props, dict):
            props = {
                key: value
                for key, value in block.items()
                if key not in {"type", "props"}
            }

        if block_type == "executive-summary":
            content = _as_str(props.get("content"), "").strip() or assistant_message.strip()
            normalized_props = {"content": content or "No summary available."}
        elif block_type == "kpi-card":
            normalized_props = _normalize_kpi_card(props, idx, warnings)
        elif block_type == "line-chart":
            normalized_props = _normalize_line_chart(props, idx, warnings)
        elif block_type == "candlestick-chart":
            normalized_props = _normalize_candlestick_chart(props, idx, warnings)
        elif block_type == "event-timeline":
            normalized_props = _normalize_event_timeline(props)
        elif block_type == "correlation-matrix":
            normalized_props = _normalize_correlation_matrix(props, idx, warnings)
        else:
            continue

        normalized_blocks.append({"type": block_type, "props": normalized_props})

    chaos = spec.get("chaos")
    if not isinstance(chaos, dict):
        chaos = chaos_fallback if isinstance(chaos_fallback, dict) else None

    normalized_spec: Dict[str, Any] = {"blocks": normalized_blocks}
    if chaos is not None:
        normalized_spec["chaos"] = chaos

    return normalized_spec, warnings
