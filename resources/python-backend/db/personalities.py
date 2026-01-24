import json
import time
import uuid
from typing import Any, List, Optional

from .models import Personality


class PersonalitiesMixin:
    def get_personalities(self, include_hidden: bool = False) -> List[Personality]:
        conn = self._get_conn()
        cursor = conn.cursor()
        if include_hidden:
            cursor.execute("SELECT * FROM personalities ORDER BY created_at DESC, rowid DESC")
        else:
            cursor.execute(
                "SELECT * FROM personalities WHERE is_visible = 1 ORDER BY created_at DESC, rowid DESC"
            )
        rows = cursor.fetchall()
        conn.close()
        return [
            Personality(
                id=row["id"],
                name=row["name"],
                prompt=row["prompt"],
                short_description=row["short_description"],
                tags=json.loads(row["tags"]) if row["tags"] else [],
                is_visible=bool(row["is_visible"]),
                is_global=bool(row["is_global"]),
                voice_id=row["voice_id"],
                img_src=row["img_src"],
                created_at=row["created_at"],
            )
            for row in rows
        ]

    def get_personality(self, p_id: str) -> Optional[Personality]:
        conn = self._get_conn()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM personalities WHERE id = ?", (p_id,))
        row = cursor.fetchone()
        conn.close()
        if not row:
            return None
        return Personality(
            id=row["id"],
            name=row["name"],
            prompt=row["prompt"],
            short_description=row["short_description"],
            tags=json.loads(row["tags"]) if row["tags"] else [],
            is_visible=bool(row["is_visible"]),
            is_global=bool(row["is_global"]),
            voice_id=row["voice_id"],
            img_src=row["img_src"],
            created_at=row["created_at"],
        )

    def create_personality(
        self,
        name: str,
        prompt: str,
        short_description: str,
        tags: List[str],
        voice_id: str,
        is_visible: bool = True,
        is_global: bool = False,
        img_src: Optional[str] = None,
    ) -> Personality:
        if not self._voice_exists(voice_id):
            fallback = self._default_voice_id()
            if not fallback:
                raise ValueError("No voices available")
            voice_id = fallback

        p_id = str(uuid.uuid4())
        conn = self._get_conn()
        cursor = conn.cursor()
        created_at = time.time()
        cursor.execute(
            """
            INSERT INTO personalities (id, name, prompt, short_description, tags, is_visible, voice_id, is_global, img_src, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                p_id,
                name,
                prompt,
                short_description,
                json.dumps(tags),
                bool(is_visible),
                voice_id,
                bool(is_global),
                img_src,
                created_at,
            ),
        )
        conn.commit()
        conn.close()
        return Personality(
            id=p_id,
            name=name,
            prompt=prompt,
            short_description=short_description,
            tags=tags,
            is_visible=is_visible,
            is_global=is_global,
            voice_id=voice_id,
            img_src=img_src,
            created_at=created_at,
        )

    def update_personality(self, p_id: str, **kwargs: Any) -> Optional[Personality]:
        current = self.get_personality(p_id)
        if not current:
            return None

        fields: List[str] = []
        values: List[Any] = []

        if "name" in kwargs:
            fields.append("name = ?")
            values.append(kwargs["name"])
        if "prompt" in kwargs:
            fields.append("prompt = ?")
            values.append(kwargs["prompt"])
        if "short_description" in kwargs:
            fields.append("short_description = ?")
            values.append(kwargs["short_description"])
        if "tags" in kwargs:
            fields.append("tags = ?")
            values.append(json.dumps(kwargs["tags"]))
        if "is_visible" in kwargs:
            fields.append("is_visible = ?")
            values.append(kwargs["is_visible"])
        if "voice_id" in kwargs:
            voice_id = kwargs["voice_id"]
            if not self._voice_exists(voice_id):
                fallback = self._default_voice_id()
                if not fallback:
                    raise ValueError("No voices available")
                voice_id = fallback
            fields.append("voice_id = ?")
            values.append(voice_id)
        if "img_src" in kwargs:
            fields.append("img_src = ?")
            values.append(kwargs["img_src"])

        if not fields:
            return current

        values.append(p_id)
        query = f"UPDATE personalities SET {', '.join(fields)} WHERE id = ?"
        conn = self._get_conn()
        cursor = conn.cursor()
        cursor.execute(query, tuple(values))
        conn.commit()
        conn.close()
        return self.get_personality(p_id)

    def delete_personality(self, p_id: str) -> bool:
        conn = self._get_conn()
        cursor = conn.cursor()
        cursor.execute(
            "DELETE FROM personalities WHERE id = ? AND COALESCE(is_global, 0) = 0",
            (p_id,),
        )
        success = cursor.rowcount > 0
        conn.commit()
        conn.close()
        return success
