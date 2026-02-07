from __future__ import annotations

import json
import logging
from typing import Any, Dict, Optional

from openai import OpenAI

from app.core.config import settings
from app.utils.json_tools import parse_json_from_text

logger = logging.getLogger(__name__)

BASE_SYSTEM_PROMPT = """
You are a financial dashboard assistant. Your job is to:
1. Parse user queries to extract financial intent.
2. Generate appropriate dashboard specifications in structured JSON.
3. Create executive summaries of financial data.
4. Detect and execute chaos mode commands.

DATABASE SCHEMA (DuckDB):
- stock_prices (ticker: VARCHAR, date: TIMESTAMP, open: DOUBLE, high: DOUBLE, low: DOUBLE, close: DOUBLE, volume: BIGINT)
- financial_metrics (ticker: VARCHAR, report_period: DATE, market_cap: DOUBLE, pe_ratio: DOUBLE, pb_ratio: DOUBLE, current_ratio: DOUBLE, debt_to_equity: DOUBLE, revenue_growth: DOUBLE, net_income_growth: DOUBLE, free_cash_flow_yield: DOUBLE)
- news (ticker: VARCHAR, date: TIMESTAMP, title: VARCHAR, author: VARCHAR, source: VARCHAR, url: VARCHAR, sentiment: DOUBLE)

AVAILABLE TICKERS: AAPL, MSFT, TSLA (fixtures).

COMPONENT CONTRACTS (each block MUST be { type, props }):
- executive-summary: { content: string }
- kpi-card: { ticker: string, metric: string, value: string, change: string, changeDirection: 'up' | 'down', comparisonBenchmark?: string }
- line-chart: { title: string, data: any[], xKey: string, yKeys: string[] }
- candlestick-chart: { ticker: string, data: any[] }
- event-timeline: { events: Array<{ date: string, ticker: string, entry_type: string, title: string, summary: string, sentiment_score: number, price_impact_pct: number }> }
- correlation-matrix: { tickers: string[], data: number[][], period: string }

EVENT MAPPING:
- Use the news table for event-timeline data.
- Shape SQL results to match event fields via aliases (entry_type='news', summary=source, sentiment_score=sentiment, price_impact_pct=0.0).

CHAOS COMMANDS:
- "flip", "upside down" -> rotation: 180
- "comic sans" -> fontFamily: "Comic Sans MS"
- "wobble" -> animation: "wobble"
- "rainbow" -> animation: "rainbow"
- "matrix mode" -> theme: "matrix"
- "professional mode" -> reset all effects

OUTPUT FORMAT:
Return ONLY a JSON object with:
{
  "intent": string,
  "sqlQueries": string[],
  "assistantMessage": string,
  "dashboardSpec": {
    "blocks": Array<{ "type": string, "props": any }>,
    "chaos": {
      "rotation": number,
      "fontFamily": string,
      "animation": string | null,
      "theme": string
    }
  }
}

Use "QUERY_RESULT_0", "QUERY_RESULT_1", etc. as placeholders in the spec for data that will be replaced by the results of the corresponding SQL queries.
"""


def build_system_prompt(current_chaos: Optional[Dict[str, Any]]) -> str:
    if not current_chaos:
        return BASE_SYSTEM_PROMPT
    return (
        BASE_SYSTEM_PROMPT
        + "\nCURRENT_CHAOS_STATE (carry forward unless a chaos command overrides it):\n"
        + json.dumps(current_chaos)
    )


class LLMService:
    def __init__(self) -> None:
        if not settings.openai_api_key:
            logger.warning("OPENAI_API_KEY is not set; LLM calls will fail.")
        self.client = OpenAI(api_key=settings.openai_api_key)

    async def process_query(self, message: str, current_chaos: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        response = self.client.responses.create(
            model=settings.openai_model,
            instructions=build_system_prompt(current_chaos),
            input=message,
        )

        content = response.output_text if hasattr(response, "output_text") else ""
        try:
            return parse_json_from_text(content)
        except Exception:
            logger.exception("Failed to parse LLM response")
            raise


llm_service = LLMService()
