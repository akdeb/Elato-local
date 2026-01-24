import time
import uuid
from typing import List, Optional

from .models import Conversation


class ConversationsMixin:
    def log_conversation(
        self, role: str, transcript: str, session_id: Optional[str] = None
    ) -> Conversation:
        c_id = str(uuid.uuid4())
        timestamp = time.time()
        conn = self._get_conn()
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO conversations (id, role, transcript, timestamp, session_id) VALUES (?, ?, ?, ?, ?)",
            (c_id, role, transcript, timestamp, session_id),
        )
        conn.commit()
        conn.close()
        return Conversation(c_id, role, transcript, timestamp, session_id)

    def get_conversations(
        self,
        limit: int = 50,
        offset: int = 0,
        session_id: Optional[str] = None,
    ) -> List[Conversation]:
        conn = self._get_conn()
        cursor = conn.cursor()
        if session_id:
            cursor.execute(
                "SELECT * FROM conversations WHERE session_id = ? ORDER BY timestamp ASC",
                (session_id,),
            )
        else:
            cursor.execute(
                "SELECT * FROM conversations ORDER BY timestamp DESC LIMIT ? OFFSET ?",
                (limit, offset),
            )
        rows = cursor.fetchall()
        conn.close()
        return [
            Conversation(
                id=row["id"],
                role=row["role"],
                transcript=row["transcript"],
                timestamp=row["timestamp"],
                session_id=row["session_id"],
            )
            for row in rows
        ]
