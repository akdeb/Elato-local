import time
from typing import List, Optional

from .models import Session


class SessionsMixin:
    def get_sessions(
        self, limit: int = 50, offset: int = 0, user_id: Optional[str] = None
    ) -> List[Session]:
        conn = self._get_conn()
        cursor = conn.cursor()
        if user_id:
            cursor.execute(
                "SELECT * FROM sessions WHERE user_id = ? ORDER BY started_at DESC LIMIT ? OFFSET ?",
                (user_id, limit, offset),
            )
        else:
            cursor.execute(
                "SELECT * FROM sessions ORDER BY started_at DESC LIMIT ? OFFSET ?",
                (limit, offset),
            )
        rows = cursor.fetchall()
        conn.close()
        return [
            Session(
                id=row["id"],
                started_at=row["started_at"],
                ended_at=row["ended_at"],
                duration_sec=row["duration_sec"],
                client_type=row["client_type"],
                user_id=row["user_id"],
                personality_id=row["personality_id"],
            )
            for row in rows
        ]

    def start_session(
        self,
        session_id: str,
        client_type: str,
        user_id: Optional[str] = None,
        personality_id: Optional[str] = None,
    ) -> None:
        started_at = time.time()
        conn = self._get_conn()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT OR IGNORE INTO sessions (id, started_at, ended_at, duration_sec, client_type, user_id, personality_id)
            VALUES (?, ?, NULL, NULL, ?, ?, ?)
            """,
            (session_id, started_at, client_type, user_id, personality_id),
        )
        if user_id is not None or personality_id is not None:
            cursor.execute(
                """
                UPDATE sessions
                SET user_id = COALESCE(user_id, ?),
                    personality_id = COALESCE(personality_id, ?)
                WHERE id = ?
                """,
                (user_id, personality_id, session_id),
            )
        conn.commit()
        conn.close()

    def end_session(self, session_id: str) -> None:
        conn = self._get_conn()
        cursor = conn.cursor()
        cursor.execute("SELECT started_at, ended_at FROM sessions WHERE id = ?", (session_id,))
        row = cursor.fetchone()
        if row and row["started_at"] and not row["ended_at"]:
            ended_at = time.time()
            duration = ended_at - row["started_at"]
            cursor.execute(
                "UPDATE sessions SET ended_at = ?, duration_sec = ? WHERE id = ?",
                (ended_at, duration, session_id),
            )
        conn.commit()
        conn.close()
