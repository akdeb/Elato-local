from pathlib import Path
from sqlite3 import Connection


def apply_migrations(conn: Connection, migrations_path: Path) -> None:
    migrations_path.mkdir(parents=True, exist_ok=True)
    cursor = conn.cursor()
    cursor.execute(
        "CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at REAL NOT NULL)"
    )
    cursor.execute("SELECT version FROM schema_migrations")
    applied = {row[0] for row in cursor.fetchall()}

    for path in sorted(migrations_path.glob("*.sql")):
        version = path.name
        if version in applied:
            continue
        sql = path.read_text(encoding="utf-8").strip()
        if sql:
            cursor.executescript(sql)
        cursor.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?, strftime('%s','now'))",
            (version,),
        )
    conn.commit()
