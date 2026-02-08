import argparse
import datetime as dt
import os
import random

import duckdb


BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DEFAULT_DB_PATH = os.path.join(BASE_DIR, "data", "finance.db")


def setup_db(conn: duckdb.DuckDBPyConnection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS stock_prices (
            ticker VARCHAR,
            date TIMESTAMP,
            open DOUBLE,
            high DOUBLE,
            low DOUBLE,
            close DOUBLE,
            volume BIGINT
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS news (
            ticker VARCHAR,
            date TIMESTAMP,
            title VARCHAR,
            author VARCHAR,
            source VARCHAR,
            url VARCHAR,
            sentiment DOUBLE
        )
        """
    )


def daterange(start: dt.date, end: dt.date):
    current = start
    while current <= end:
        yield current
        current += dt.timedelta(days=1)


def generate_series(
    ticker: str,
    start: dt.date,
    end: dt.date,
    seed: int,
    base_price: float,
    drift: float,
    volatility: float,
    volume_base: int,
):
    rng = random.Random(seed)
    price = base_price
    rows = []

    for day in daterange(start, end):
        daily_return = rng.gauss(drift, volatility)
        open_price = price
        close_price = max(0.01, open_price * (1 + daily_return))

        swing = abs(rng.gauss(0, volatility / 2))
        high_price = max(open_price, close_price) * (1 + swing)
        low_price = min(open_price, close_price) * (1 - swing)

        volume = int(max(0, rng.gauss(volume_base, volume_base * 0.2)))

        rows.append(
            (
                ticker,
                dt.datetime.combine(day, dt.time(0, 0)),
                open_price,
                high_price,
                low_price,
                close_price,
                volume,
            )
        )
        price = close_price

    return rows


def clear_stock_prices(conn: duckdb.DuckDBPyConnection, tickers: list[str]) -> None:
    if not tickers:
        return
    placeholders = ", ".join(["?"] * len(tickers))
    conn.execute(f"DELETE FROM stock_prices WHERE ticker IN ({placeholders})", tickers)


def insert_stock_prices(conn: duckdb.DuckDBPyConnection, rows: list[tuple]) -> None:
    if not rows:
        return
    conn.executemany(
        "INSERT INTO stock_prices VALUES (?, ?, ?, ?, ?, ?, ?)",
        rows,
    )


def duplicate_news(
    conn: duckdb.DuckDBPyConnection,
    start: dt.date,
    end: dt.date,
    per_day: int | None,
    seed: int,
) -> int:
    existing = conn.execute(
        "SELECT ticker, date, title, author, source, url, sentiment FROM news"
    ).fetchall()
    if not existing:
        print("No existing news rows found to duplicate.")
        return 0

    rng = random.Random(seed)
    total_inserted = 0

    for idx, day in enumerate(daterange(start, end), start=1):
        if per_day is not None and per_day < len(existing):
            day_rows = rng.sample(existing, per_day)
        else:
            day_rows = existing

        batch = []
        for row in day_rows:
            ticker, date_val, title, author, source, url, sentiment = row
            if isinstance(date_val, dt.datetime):
                time_part = date_val.time()
            else:
                time_part = dt.time(12, 0)
            new_dt = dt.datetime.combine(day, time_part)
            batch.append((ticker, new_dt, title, author, source, url, sentiment))

        conn.executemany(
            "INSERT INTO news VALUES (?, ?, ?, ?, ?, ?, ?)",
            batch,
        )
        total_inserted += len(batch)

        if idx % 30 == 0:
            print(f"Duplicated news through {day.isoformat()} (total {total_inserted}).")

    return total_inserted


def main():
    parser = argparse.ArgumentParser(description="Generate mock market data in DuckDB.")
    parser.add_argument("--start", required=True, help="Start date (YYYY-MM-DD).")
    parser.add_argument("--end", required=True, help="End date (YYYY-MM-DD).")
    parser.add_argument(
        "--tickers",
        nargs="+",
        default=["AAPL", "MSFT", "TSLA", "BTC", "SP500"],
        help="Tickers to generate.",
    )
    parser.add_argument(
        "--clear",
        action="store_true",
        help="Delete existing rows for these tickers before inserting.",
    )
    parser.add_argument(
        "--news-per-day",
        type=int,
        default=None,
        help="If set, sample this many existing news rows per day.",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=42,
        help="Seed for deterministic mock data.",
    )
    parser.add_argument(
        "--db",
        default=DEFAULT_DB_PATH,
        help="Path to DuckDB file.",
    )
    args = parser.parse_args()

    start = dt.date.fromisoformat(args.start)
    end = dt.date.fromisoformat(args.end)
    if end < start:
        raise SystemExit("End date must be >= start date.")

    params = {
        "AAPL": dict(base=180.0, drift=0.0002, vol=0.01, volume=85_000_000),
        "MSFT": dict(base=420.0, drift=0.00025, vol=0.012, volume=30_000_000),
        "TSLA": dict(base=200.0, drift=0.0003, vol=0.02, volume=70_000_000),
        "BTC": dict(base=45000.0, drift=0.00035, vol=0.03, volume=250_000),
        "SP500": dict(base=4800.0, drift=0.00015, vol=0.007, volume=0),
    }

    conn = duckdb.connect(args.db)
    try:
        setup_db(conn)
        tickers = [t.upper() for t in args.tickers]
        if args.clear:
            clear_stock_prices(conn, tickers)

        for ticker in tickers:
            if ticker not in params:
                print(f"Skipping unknown ticker: {ticker}")
                continue
            conf = params[ticker]
            rows = generate_series(
                ticker=ticker,
                start=start,
                end=end,
                seed=args.seed + hash(ticker) % 10_000,
                base_price=conf["base"],
                drift=conf["drift"],
                volatility=conf["vol"],
                volume_base=conf["volume"],
            )
            insert_stock_prices(conn, rows)
            print(f"Inserted {len(rows)} rows for {ticker}.")

        total_news = duplicate_news(
            conn, start=start, end=end, per_day=args.news_per_day, seed=args.seed
        )
        print(f"Duplicated {total_news} news rows over the date range.")

    finally:
        conn.close()


if __name__ == "__main__":
    main()
