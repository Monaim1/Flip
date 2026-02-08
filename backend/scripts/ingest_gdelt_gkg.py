import argparse
import csv
import datetime as dt
import io
import os
import re
import tempfile
import zipfile
from urllib.parse import urlparse

import duckdb
import requests


BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DEFAULT_DB_PATH = os.path.join(BASE_DIR, "data", "finance.db")

MASTERFILE_URL = "https://data.gdeltproject.org/gdeltv2/masterfilelist.txt"
URL_RE = re.compile(r"https?://", re.IGNORECASE)
TONE_RE = re.compile(r"^-?\d+(?:\.\d+)?(,-?\d+(?:\.\d+)?){2,}$")


def parse_date(value: str) -> dt.datetime:
    return dt.datetime.strptime(value, "%Y-%m-%d")


def parse_gkg_datetime(value: str) -> dt.datetime | None:
    if not value or len(value) < 14:
        return None
    try:
        return dt.datetime.strptime(value[:14], "%Y%m%d%H%M%S")
    except ValueError:
        return None


def setup_db(conn: duckdb.DuckDBPyConnection) -> None:
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


def get_masterfile_lines() -> list[str]:
    resp = requests.get(MASTERFILE_URL, timeout=30)
    resp.raise_for_status()
    return resp.text.splitlines()


def iter_gkg_urls(
    start: dt.datetime,
    end: dt.datetime,
    max_files: int | None,
    limit_per_day: int | None,
):
    count = 0
    per_day: dict[str, int] = {}
    for line in get_masterfile_lines():
        parts = line.strip().split()
        if len(parts) < 3:
            continue
        ts, _, url = parts[0], parts[1], parts[2]
        if not url.endswith(".gkg.csv.zip"):
            continue
        try:
            file_dt = dt.datetime.strptime(ts, "%Y%m%d%H%M%S")
        except ValueError:
            continue
        if file_dt < start or file_dt > end:
            continue

        if limit_per_day is not None:
            day_key = file_dt.strftime("%Y-%m-%d")
            per_day.setdefault(day_key, 0)
            if per_day[day_key] >= limit_per_day:
                continue
            per_day[day_key] += 1

        yield url
        count += 1
        if max_files is not None and count >= max_files:
            return


def extract_url(fields: list[str]) -> str | None:
    for field in reversed(fields):
        if URL_RE.search(field or ""):
            value = field.strip()
            if ";" in value:
                value = value.split(";", 1)[0]
            if "," in value:
                value = value.split(",", 1)[0]
            return value
    return None


def derive_title(url: str) -> str:
    parsed = urlparse(url)
    slug = parsed.path.rsplit("/", 1)[-1]
    slug = slug.split("?", 1)[0]
    slug = slug.split("#", 1)[0]
    slug = slug.replace("-", " ").replace("_", " ").strip()
    if not slug:
        slug = parsed.netloc
    return slug[:180]


def extract_source(url: str) -> str:
    parsed = urlparse(url)
    return parsed.netloc or ""


def extract_sentiment(fields: list[str]) -> float | None:
    for field in fields:
        if not field:
            continue
        if TONE_RE.match(field.strip()):
            try:
                return float(field.split(",", 1)[0])
            except ValueError:
                return None
    return None


def parse_gkg_file(path: str, start: dt.datetime, end: dt.datetime):
    rows = []
    with zipfile.ZipFile(path) as zf:
        names = zf.namelist()
        if not names:
            return rows
        with zf.open(names[0]) as handle:
            reader = csv.reader(io.TextIOWrapper(handle, encoding="utf-8"), delimiter="\t")
            for fields in reader:
                if not fields:
                    continue
                record_dt = parse_gkg_datetime(fields[0])
                if record_dt is None or record_dt < start or record_dt > end:
                    continue
                url = extract_url(fields)
                if not url:
                    continue
                title = derive_title(url)
                source = extract_source(url)
                sentiment = extract_sentiment(fields)
                rows.append(
                    (
                        "MARKET",
                        record_dt,
                        title,
                        None,
                        source,
                        url,
                        sentiment,
                    )
                )
    return rows


def clear_existing_market_news(conn: duckdb.DuckDBPyConnection):
    conn.execute("DELETE FROM news WHERE ticker = 'MARKET'")


def insert_rows(conn: duckdb.DuckDBPyConnection, rows: list[tuple]):
    if not rows:
        return
    conn.executemany(
        "INSERT INTO news VALUES (?, ?, ?, ?, ?, ?, ?)",
        rows,
    )


def download_to_temp(url: str) -> str:
    resp = requests.get(url, timeout=60)
    resp.raise_for_status()
    temp = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
    try:
        temp.write(resp.content)
        temp.flush()
        return temp.name
    finally:
        temp.close()


def main():
    parser = argparse.ArgumentParser(description="Ingest GDELT GKG data into DuckDB.")
    parser.add_argument("--start", required=True, help="Start date (YYYY-MM-DD).")
    parser.add_argument("--end", required=True, help="End date (YYYY-MM-DD).")
    parser.add_argument("--db", default=DEFAULT_DB_PATH, help="Path to DuckDB file.")
    parser.add_argument("--max-files", type=int, default=None, help="Limit number of GKG files to ingest.")
    parser.add_argument("--limit-per-day", type=int, default=None, help="Limit files per day (for sampling).")
    parser.add_argument("--clear", action="store_true", help="Delete existing MARKET rows first.")
    parser.add_argument("--max-rows", type=int, default=None, help="Stop after inserting this many rows.")
    args = parser.parse_args()

    start = parse_date(args.start)
    end = parse_date(args.end) + dt.timedelta(days=1) - dt.timedelta(seconds=1)
    if end < start:
        raise SystemExit("End date must be >= start date.")

    conn = duckdb.connect(args.db)
    total_rows = 0
    try:
        setup_db(conn)
        if args.clear:
            clear_existing_market_news(conn)

        for url in iter_gkg_urls(start, end, args.max_files, args.limit_per_day):
            print(f"Downloading {url}...")
            temp_path = download_to_temp(url)
            try:
                rows = parse_gkg_file(temp_path, start, end)
                insert_rows(conn, rows)
                total_rows += len(rows)
                print(f"Inserted {len(rows)} rows (total {total_rows}).")
                if args.max_rows is not None and total_rows >= args.max_rows:
                    break
            finally:
                try:
                    os.unlink(temp_path)
                except OSError:
                    pass
    finally:
        conn.close()


if __name__ == "__main__":
    main()
