"""LangChain tools for the Flip agent.

These tools let the LangGraph agent query the DuckDB warehouse
while respecting the existing SQL safety guardrails.
"""

from __future__ import annotations

import json
import logging
from typing import List

from langchain_core.tools import tool

from app.services.db import db_service
from app.utils.sql_guard import is_safe_sql

logger = logging.getLogger(__name__)

DB_SCHEMA = {
    "stock_prices": [
        "ticker VARCHAR", "date TIMESTAMP", "open DOUBLE", "high DOUBLE",
        "low DOUBLE", "close DOUBLE", "volume BIGINT",
    ],
    "financial_metrics": [
        "ticker VARCHAR", "report_period DATE", "market_cap DOUBLE",
        "pe_ratio DOUBLE", "pb_ratio DOUBLE", "current_ratio DOUBLE",
        "debt_to_equity DOUBLE", "revenue_growth DOUBLE",
        "net_income_growth DOUBLE", "free_cash_flow_yield DOUBLE",
    ],
    "news": [
        "ticker VARCHAR", "date TIMESTAMP", "title VARCHAR",
        "author VARCHAR", "source VARCHAR", "url VARCHAR",
        "sentiment DOUBLE",
    ],
}


@tool
def run_query(sql: str) -> str:
    """Execute a read-only SQL query against the Flip DuckDB database.

    Only SELECT queries are allowed.  Tables: stock_prices, financial_metrics, news.
    Returns results as a JSON array of objects (max 200 rows).

    Args:
        sql: A valid SELECT SQL query.
    """
    if not is_safe_sql(sql):
        return json.dumps({"error": "Query rejected — only SELECT on allowed tables."})

    try:
        rows = db_service.query(sql)
        # Cap at 200 rows to keep context manageable
        if len(rows) > 200:
            rows = rows[:200]
        return json.dumps(rows, default=str)
    except Exception as exc:
        logger.exception("Tool run_query failed", extra={"sql": sql})
        return json.dumps({"error": str(exc)})


@tool
def get_schema() -> str:
    """Return the database schema — tables and their columns.

    No arguments needed. Use this to understand which tables and columns are available.
    """
    lines = []
    for table, cols in DB_SCHEMA.items():
        lines.append(f"{table}: {', '.join(cols)}")
    return "\n".join(lines)


def get_all_tools() -> List:
    """Return the list of tools the agent can use."""
    return [run_query, get_schema]
