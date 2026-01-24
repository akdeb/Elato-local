import json
import logging
import time
import uuid

from .paths import assets_dir

logger = logging.getLogger(__name__)


class SeedMixin:
    def sync_global_voices_and_personalities(self) -> None:
        voices_path = assets_dir() / "voices.json"
        personalities_path = assets_dir() / "personalities.json"
        if not voices_path.exists() or not personalities_path.exists():
            return

        try:
            voices_payload = json.loads(voices_path.read_text(encoding="utf-8"))
            personalities_payload = json.loads(personalities_path.read_text(encoding="utf-8"))
        except Exception:
            return

        conn = self._get_conn()
        cursor = conn.cursor()

        if isinstance(voices_payload, list):
            for item in voices_payload:
                if not isinstance(item, dict):
                    continue
                vid = item.get("voice_id") or item.get("id")
                vname = item.get("voice_name") or item.get("name")
                if not vid or not vname:
                    continue
                cursor.execute(
                    """
                    INSERT INTO voices (voice_id, gender, voice_name, voice_description, voice_src, is_global, created_at)
                    VALUES (?, ?, ?, ?, ?, 1, ?)
                    ON CONFLICT(voice_id) DO UPDATE SET
                      gender = excluded.gender,
                      voice_name = excluded.voice_name,
                      voice_description = excluded.voice_description,
                      voice_src = excluded.voice_src,
                      is_global = excluded.is_global,
                      created_at = COALESCE(voices.created_at, excluded.created_at)
                    """,
                    (
                        str(vid),
                        item.get("gender"),
                        str(vname),
                        item.get("voice_description") or item.get("description"),
                        item.get("voice_src") or item.get("src"),
                        time.time(),
                    ),
                )

        if isinstance(personalities_payload, list):
            for item in personalities_payload:
                if not isinstance(item, dict):
                    continue
                p_id = item.get("id")
                name = item.get("name")
                prompt = item.get("prompt")
                voice_id = item.get("voice_id")
                if not p_id or not name or not prompt or not voice_id:
                    continue
                cursor.execute(
                    "SELECT 1 FROM voices WHERE voice_id = ? LIMIT 1",
                    (str(voice_id),),
                )
                if not cursor.fetchone():
                    continue
                cursor.execute(
                    """
                    INSERT INTO personalities (id, name, prompt, short_description, tags, is_visible, voice_id, is_global, img_src, created_at)
                    VALUES (?, ?, ?, ?, ?, 1, ?, 1, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                      name = excluded.name,
                      prompt = excluded.prompt,
                      short_description = excluded.short_description,
                      tags = excluded.tags,
                      is_visible = excluded.is_visible,
                      voice_id = excluded.voice_id,
                      is_global = excluded.is_global,
                      img_src = excluded.img_src,
                      created_at = COALESCE(personalities.created_at, excluded.created_at)
                    """,
                    (
                        str(p_id),
                        str(name),
                        str(prompt),
                        str(item.get("short_description") or ""),
                        json.dumps(item.get("tags") or []),
                        str(voice_id),
                        str(item.get("img_src") or ""),
                        time.time(),
                    ),
                )

        conn.commit()
        conn.close()

    def _seed_default_user(self) -> None:
        conn = self._get_conn()
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(1) AS n FROM users")
        row = cursor.fetchone()
        if row and row["n"]:
            conn.close()
            return

        user_id = str(uuid.uuid4())
        cursor.execute(
            """
            INSERT INTO users (id, name, age, dob, hobbies, about_you, personality_type, likes, current_personality_id, user_type)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                user_id,
                "User",
                None,
                None,
                json.dumps([]),
                "",
                None,
                json.dumps([]),
                None,
                "family",
            ),
        )
        conn.commit()
        conn.close()

        if not self.get_active_user_id():
            self.set_active_user_id(user_id)
