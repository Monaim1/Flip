import json
import os
import requests
import duckdb
from datetime import datetime
from pathlib import Path

import argparse

# Root paths
BACKEND_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_ROOT.parent


def resolve_db_path() -> str:
    env_path = os.getenv("FINANCE_DB_PATH")
    if env_path:
        candidate = Path(env_path)
        if not candidate.is_absolute():
            candidate = (BACKEND_ROOT / candidate).resolve()
        if candidate.exists():
            return str(candidate)

    candidates = [
        REPO_ROOT / "data" / "finance.db",
        BACKEND_ROOT / "finance.db",
        BACKEND_ROOT / "data" / "finance.db",
    ]
    for candidate in candidates:
        if candidate.exists():
            return str(candidate)

    return str(candidates[1])


DB_PATH = resolve_db_path()

# Default fixtures from ai-hedge-fund
DEFAULT_TICKERS = ["AAPL", "MSFT", "TSLA"]
DEFAULT_DATE_SUFFIX = "_2024-03-01_2025-03-08"
BASE_URL = "https://raw.githubusercontent.com/virattt/ai-hedge-fund/main/tests/fixtures/api"

def setup_db():
    conn = duckdb.connect(DB_PATH)
    
    # Create tables
    conn.execute("""
    CREATE TABLE IF NOT EXISTS stock_prices (
        ticker VARCHAR,
        date TIMESTAMP,
        open DOUBLE,
        high DOUBLE,
        low DOUBLE,
        close DOUBLE,
        volume BIGINT
    )
    """)
    
    conn.execute("""
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
    """)
    
    conn.execute("""
    CREATE TABLE IF NOT EXISTS news (
        ticker VARCHAR,
        date TIMESTAMP,
        title VARCHAR,
        author VARCHAR,
        source VARCHAR,
        url VARCHAR,
        sentiment DOUBLE
    )
    """)
    
    conn.close()

def sync_prices(tickers, suffix):
    conn = duckdb.connect(DB_PATH)
    conn.execute("DELETE FROM stock_prices")
    
    for ticker in tickers:
        print(f"Syncing prices for {ticker}...")
        url = f"{BASE_URL}/prices/{ticker}{suffix}.json"
        response = requests.get(url)
        if response.status_code == 200:
            content = response.json()
            data = content.get('prices', [])
            for item in data:
                dt = item.get('time') or item.get('date')
                conn.execute(
                    "INSERT INTO stock_prices VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (ticker, dt, item['open'], item['high'], item['low'], item['close'], item['volume'])
                )
        else:
            print(f"Failed to fetch prices for {ticker}: {response.status_code}")
    conn.close()

def sync_metrics(tickers, suffix):
    conn = duckdb.connect(DB_PATH)
    conn.execute("DELETE FROM financial_metrics")
    
    for ticker in tickers:
        print(f"Syncing metrics for {ticker}...")
        url = f"{BASE_URL}/financial_metrics/{ticker}{suffix}.json"
        response = requests.get(url)
        if response.status_code == 200:
            content = response.json()
            data = content.get('financial_metrics', [])
            for report in data:
                conn.execute(
                    "INSERT INTO financial_metrics VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (ticker, report['report_period'], report['market_cap'], 
                     report.get('price_to_earnings_ratio'), report.get('price_to_book_ratio'), 
                     report.get('current_ratio'), report.get('debt_to_equity'), 
                     report.get('revenue_growth'), report.get('net_income_growth'), 
                     report.get('free_cash_flow_yield'))
                )
        else:
            print(f"Failed to fetch metrics for {ticker}: {response.status_code}")
    conn.close()

def sync_news(tickers, suffix):
    conn = duckdb.connect(DB_PATH)
    conn.execute("DELETE FROM news")
    
    for ticker in tickers:
        print(f"Syncing news for {ticker}...")
        url = f"{BASE_URL}/news/{ticker}{suffix}.json"
        response = requests.get(url)
        if response.status_code == 200:
            content = response.json()
            data = content.get('news', [])
            for article in data:
                conn.execute(
                    "INSERT INTO news VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (ticker, article['date'], article['title'], article['author'], 
                     article['source'], article['url'], article.get('sentiment_score') or article.get('sentiment') or 0.0)
                )
        else:
            print(f"Failed to fetch news for {ticker}: {response.status_code}")
    conn.close()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Synchronize real financial data from ai-hedge-fund fixtures.")
    parser.add_argument("--tickers", nargs="+", default=DEFAULT_TICKERS, help="List of tickers to sync (e.g. AAPL MSFT TSLA)")
    parser.add_argument("--suffix", default=DEFAULT_DATE_SUFFIX, help="Date suffix for the fixture files (e.g. _2024-03-01_2024-03-08)")
    
    args = parser.parse_args()
    
    # Handle space-separated strings if passed as a single argument (e.g. from Makefile)
    if len(args.tickers) == 1 and " " in args.tickers[0]:
        args.tickers = args.tickers[0].split()
    
    print(f"Using database at: {DB_PATH}")
    print("Setting up DuckDB schema...")
    setup_db()
    
    print(f"\nSynchronizing for tickers: {', '.join(args.tickers)}")
    print(f"Using date range suffix: {args.suffix}")
    
    sync_prices(args.tickers, args.suffix)
    sync_metrics(args.tickers, args.suffix)
    sync_news(args.tickers, args.suffix)
    
    print("\nSync completed successfully!")
