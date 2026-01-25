import json
import time
import uuid
from typing import Any, List, Literal, Optional

from .models import Experience

ExperienceType = Literal["personality", "game", "story"]


class PersonalitiesMixin:
    """Mixin for experience CRUD (personalities, games, stories)."""

    def _row_to_experience(self, row) -> Experience:
        return Experience(
            id=row["id"],
            name=row["name"],
            prompt=row["prompt"],
            short_description=row["short_description"],
            tags=json.loads(row["tags"]) if row["tags"] else [],
            is_visible=bool(row["is_visible"]),
            is_global=bool(row["is_global"]),
            voice_id=row["voice_id"],
            type=row["type"] if row["type"] else "personality",
            img_src=row["img_src"],
            created_at=row["created_at"],
        )

    def get_experiences(
        self,
        include_hidden: bool = False,
        experience_type: Optional[ExperienceType] = None,
    ) -> List[Experience]:
        conn = self._get_conn()
        cursor = conn.cursor()
        conditions = []
        params = []

        if not include_hidden:
            conditions.append("is_visible = 1")
        if experience_type:
            conditions.append("type = ?")
            params.append(experience_type)

        where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        cursor.execute(
            f"SELECT * FROM personalities {where} ORDER BY created_at DESC, rowid DESC",
            tuple(params),
        )
        rows = cursor.fetchall()
        conn.close()
        return [self._row_to_experience(row) for row in rows]

    def get_personalities(self, include_hidden: bool = False) -> List[Experience]:
        """Backward-compatible method to get only personalities."""
        return self.get_experiences(include_hidden, experience_type="personality")

    def get_experience(self, p_id: str) -> Optional[Experience]:
        conn = self._get_conn()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM personalities WHERE id = ?", (p_id,))
        row = cursor.fetchone()
        conn.close()
        if not row:
            return None
        return self._row_to_experience(row)

    def get_personality(self, p_id: str) -> Optional[Experience]:
        """Backward-compatible alias for get_experience."""
        return self.get_experience(p_id)

    def create_experience(
        self,
        name: str,
        prompt: str,
        short_description: str,
        tags: List[str],
        voice_id: str,
        experience_type: ExperienceType = "personality",
        is_visible: bool = True,
        is_global: bool = False,
        img_src: Optional[str] = None,
    ) -> Experience:
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
            INSERT INTO personalities (id, name, prompt, short_description, tags, is_visible, voice_id, is_global, img_src, type, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                experience_type,
                created_at,
            ),
        )
        conn.commit()
        conn.close()
        return Experience(
            id=p_id,
            name=name,
            prompt=prompt,
            short_description=short_description,
            tags=tags,
            is_visible=is_visible,
            is_global=is_global,
            voice_id=voice_id,
            type=experience_type,
            img_src=img_src,
            created_at=created_at,
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
    ) -> Experience:
        """Backward-compatible method to create a personality."""
        return self.create_experience(
            name=name,
            prompt=prompt,
            short_description=short_description,
            tags=tags,
            voice_id=voice_id,
            experience_type="personality",
            is_visible=is_visible,
            is_global=is_global,
            img_src=img_src,
        )

    def update_experience(self, p_id: str, **kwargs: Any) -> Optional[Experience]:
        current = self.get_experience(p_id)
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
        if "type" in kwargs:
            fields.append("type = ?")
            values.append(kwargs["type"])

        if not fields:
            return current

        values.append(p_id)
        query = f"UPDATE personalities SET {', '.join(fields)} WHERE id = ?"
        conn = self._get_conn()
        cursor = conn.cursor()
        cursor.execute(query, tuple(values))
        conn.commit()
        conn.close()
        return self.get_experience(p_id)

    def update_personality(self, p_id: str, **kwargs: Any) -> Optional[Experience]:
        """Backward-compatible alias for update_experience."""
        return self.update_experience(p_id, **kwargs)

    def delete_experience(self, p_id: str) -> bool:
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

    def delete_personality(self, p_id: str) -> bool:
        """Backward-compatible alias for delete_experience."""
        return self.delete_experience(p_id)
