import json
import uuid
from typing import Any, List, Optional

from .models import User


class UsersMixin:
    def get_users(self) -> List[User]:
        conn = self._get_conn()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM users")
        rows = cursor.fetchall()
        conn.close()
        return [
            User(
                id=row["id"],
                name=row["name"],
                age=row["age"],
                dob=row["dob"],
                about_you=row["about_you"] or "",
                personality_type=row["personality_type"],
                likes=json.loads(row["likes"]) if row["likes"] else [],
                current_personality_id=row["current_personality_id"],
                user_type=row["user_type"] or "family",
                avatar_emoji=row["avatar_emoji"] if "avatar_emoji" in row.keys() else None,
            )
            for row in rows
        ]

    def get_user(self, u_id: str) -> Optional[User]:
        conn = self._get_conn()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM users WHERE id = ?", (u_id,))
        row = cursor.fetchone()
        conn.close()
        if not row:
            return None
        return User(
            id=row["id"],
            name=row["name"],
            age=row["age"],
            dob=row["dob"],
            about_you=row["about_you"] or "",
            personality_type=row["personality_type"],
            likes=json.loads(row["likes"]) if row["likes"] else [],
            current_personality_id=row["current_personality_id"],
            user_type=row["user_type"] or "family",
            avatar_emoji=row["avatar_emoji"] if "avatar_emoji" in row.keys() else None,
        )

    def create_user(
        self,
        name: str,
        age: Optional[int] = None,
        dob: Optional[str] = None,
        about_you: str = "",
        personality_type: Optional[str] = None,
        likes: Optional[List[str]] = None,
        current_personality_id: Optional[str] = None,
        user_type: str = "family",
        avatar_emoji: Optional[str] = None,
    ) -> User:
        likes = likes or []
        u_id = str(uuid.uuid4())
        conn = self._get_conn()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO users (id, name, age, dob, hobbies, about_you, personality_type, likes, current_personality_id, user_type, avatar_emoji)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                u_id,
                name,
                age,
                dob,
                json.dumps([]),
                about_you or "",
                personality_type,
                json.dumps(likes),
                current_personality_id,
                user_type,
                avatar_emoji,
            ),
        )
        conn.commit()
        conn.close()
        return User(
            id=u_id,
            name=name,
            age=age,
            dob=dob,
            about_you=about_you or "",
            personality_type=personality_type,
            likes=likes,
            current_personality_id=current_personality_id,
            user_type=user_type,
            avatar_emoji=avatar_emoji,
        )

    def update_user(self, u_id: str, **kwargs: Any) -> Optional[User]:
        current = self.get_user(u_id)
        if not current:
            return None

        fields: List[str] = []
        values: List[Any] = []

        if "name" in kwargs:
            fields.append("name = ?")
            values.append(kwargs["name"])
        if "age" in kwargs:
            fields.append("age = ?")
            values.append(kwargs["age"])
        if "dob" in kwargs:
            fields.append("dob = ?")
            values.append(kwargs["dob"])
        if "about_you" in kwargs:
            fields.append("about_you = ?")
            values.append(kwargs["about_you"] or "")
        if "personality_type" in kwargs:
            fields.append("personality_type = ?")
            values.append(kwargs["personality_type"])
        if "likes" in kwargs:
            fields.append("likes = ?")
            values.append(json.dumps(kwargs["likes"]))
        if "current_personality_id" in kwargs:
            fields.append("current_personality_id = ?")
            values.append(kwargs["current_personality_id"])
        if "user_type" in kwargs:
            fields.append("user_type = ?")
            values.append(kwargs["user_type"])
        if "avatar_emoji" in kwargs:
            fields.append("avatar_emoji = ?")
            values.append(kwargs["avatar_emoji"])

        if not fields:
            return current

        values.append(u_id)
        query = f"UPDATE users SET {', '.join(fields)} WHERE id = ?"
        conn = self._get_conn()
        cursor = conn.cursor()
        cursor.execute(query, tuple(values))
        conn.commit()
        conn.close()
        return self.get_user(u_id)
