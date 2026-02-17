from __future__ import annotations

import logging
from typing import Any, Dict, List

import duckdb

from app.core.config import settings

logger = logging.getLogger(__name__)


CREATE_STOCK_PRICES_SQL = """
CREATE TABLE IF NOT EXISTS stock_prices (
    ticker VARCHAR,
    date TIMESTAMP,
    open DOUBLE,
    high DOUBLE,
    low DOUBLE,
    close DOUBLE,
    volume BIGINT
)
""".strip()

CREATE_FINANCIAL_METRICS_SQL = """
CREATE TABLE IF NOT EXISTS financial_metrics (
    ticker VARCHAR,
    report_period DATE,
    market_cap DOUBLE,
    pe_ratio DOUBLE,
    pb_ratio DOUBLE,
    current_ratio DOUBLE,
    debt_to_equity DOUBLE,
    revenue_growth DOUBLE,
    net_income_growth DOUBLE,
    free_cash_flow_yield DOUBLE
)
""".strip()

CREATE_NEWS_SQL = """
CREATE TABLE IF NOT EXISTS news (
    ticker VARCHAR,
    date TIMESTAMP,
    title VARCHAR,
    author VARCHAR,
    source VARCHAR,
    url VARCHAR,
    sentiment DOUBLE
)
""".strip()


class DuckDBService:
    def __init__(self, db_path: str = settings.db_path) -> None:
        self.db_path = db_path

    def query(self, sql: str, params: Any = None) -> List[Dict[str, Any]]:
        conn = duckdb.connect(self.db_path)
        try:
            if params is not None:
                result = conn.execute(sql, params)
            else:
                result = conn.execute(sql)
            df = result.fetchdf()
            # use to_json to handle NaN/NaT -> null conversion reliably
            import json as json_mod
            return json_mod.loads(df.to_json(orient="records", date_format="iso"))
        except Exception as exc:
            logger.exception("DuckDB query failed", extra={"sql": sql})
            raise exc
        finally:
            conn.close()

    def execute(self, sql: str, params: Any = None) -> None:
        conn = duckdb.connect(self.db_path)
        try:
            if params is not None:
                conn.execute(sql, params)
            else:
                conn.execute(sql)
        finally:
            conn.close()


db_service = DuckDBService()


def ensure_analytics_tables() -> None:
    """Ensure core analytics tables exist in the active DuckDB file."""
    db_service.execute(CREATE_STOCK_PRICES_SQL)
    db_service.execute(CREATE_FINANCIAL_METRICS_SQL)
    db_service.execute(CREATE_NEWS_SQL)
