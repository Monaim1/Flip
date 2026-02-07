from app.utils.sql_guard import is_safe_sql, filter_safe_queries


def test_allows_basic_select():
    assert is_safe_sql("SELECT * FROM stock_prices LIMIT 10")


def test_disallows_write_statements():
    assert not is_safe_sql("DELETE FROM stock_prices")
    assert not is_safe_sql("UPDATE stock_prices SET close=1")
    assert not is_safe_sql("DROP TABLE stock_prices")


def test_disallows_unknown_tables():
    assert not is_safe_sql("SELECT * FROM users")


def test_disallows_multiple_statements():
    assert not is_safe_sql("SELECT * FROM stock_prices; SELECT * FROM news")


def test_filters_safe_queries():
    queries = [
        "SELECT * FROM stock_prices LIMIT 1",
        "DROP TABLE stock_prices",
        "SELECT * FROM news LIMIT 1",
    ]
    assert filter_safe_queries(queries) == [
        "SELECT * FROM stock_prices LIMIT 1",
        "SELECT * FROM news LIMIT 1",
    ]
