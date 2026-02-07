import duckdb
from typing import List, Dict, Any

class DuckDBService:
    def __init__(self, db_path: str = "../data/finance.db"):
        self.db_path = db_path

    def query(self, sql: str) -> List[Dict[str, Any]]:
        conn = duckdb.connect(self.db_path)
        try:
            return conn.execute(sql).fetchdf().to_dict(orient='records')
        except Exception as e:
            print(f"Error executing query: {sql}\n{e}")
            return []
        finally:
            conn.close()

    def execute(self, sql: str, params: Any = None):
        conn = duckdb.connect(self.db_path)
        try:
            if params:
                conn.execute(sql, params)
            else:
                conn.execute(sql)
        finally:
            conn.close()

db_service = DuckDBService()
