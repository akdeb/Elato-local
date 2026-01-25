import sqlite3

ALLOWED_TABLES = {
    "app_state",
    "conversations",
    "personalities",
    "sessions",
    "users",
    "voices",
}


class BaseDB:
    db_path: str

    def _get_conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def get_table_count(self, table: str) -> int:
        if table not in ALLOWED_TABLES:
            return 0
        conn = self._get_conn()
        cursor = conn.cursor()
        cursor.execute(f"SELECT COUNT(1) AS n FROM {table}")
        row = cursor.fetchone()
        conn.close()
        return int(row["n"]) if row and row["n"] is not None else 0
