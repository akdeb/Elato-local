import sqlite3
import json
import uuid
import time
import os
import glob
import random
import sys
import logging
import urllib.request
from pathlib import Path
from typing import List, Optional, Dict, Any
from dataclasses import dataclass

logger = logging.getLogger(__name__)

def _argv_value(flag: str) -> Optional[str]:
    try:
        i = sys.argv.index(flag)
    except ValueError:
        return None
    if i + 1 >= len(sys.argv):
        return None
    v = sys.argv[i + 1].strip()
    return v if v else None


def _default_db_path() -> str:
    app_id = os.environ.get("ELATO_APP_ID") or os.environ.get("TAURI_BUNDLE_IDENTIFIER") or "com.elato.epic-local-ai-toys"
    if sys.platform == "darwin":
        base = os.path.expanduser("~/Library/Application Support")
        return os.path.join(base, app_id, "elato.db")
    if os.name == "nt":
        base = os.environ.get("APPDATA") or os.path.expanduser("~")
        return os.path.join(base, app_id, "elato.db")
    # linux / other
    base = os.environ.get("XDG_DATA_HOME") or os.path.expanduser("~/.local/share")
    return os.path.join(base, app_id, "elato.db")


DEFAULT_DB_PATH = _default_db_path()

DB_PATH = (
    _argv_value("--db-path")
    or _argv_value("--db_path")
    or os.environ.get("ELATO_DB_PATH")
    or DEFAULT_DB_PATH
)

# Normalize to an absolute path early so WAL/SHM end up in a predictable location.
try:
    if DB_PATH and DB_PATH != ":memory:":
        DB_PATH = str(Path(DB_PATH).expanduser().resolve())
except Exception:
    pass

logger.info("DB_PATH resolved to: %s", DB_PATH)

@dataclass
class Personality:
    id: str
    name: str
    prompt: str
    short_description: str
    tags: List[str]
    is_visible: bool
    is_global: bool
    voice_id: str  # Added to map to tts voice (dave, jo, mara, santa)
    img_src: Optional[str] = None
    created_at: Optional[float] = None

@dataclass
class Voice:
    voice_id: str
    gender: Optional[str]
    voice_name: str
    voice_description: Optional[str]
    voice_src: Optional[str]
    is_global: bool
    created_at: Optional[float] = None

@dataclass
class Conversation:
    id: str
    role: str  # 'user' or 'ai'
    transcript: str
    timestamp: float
    session_id: Optional[str] = None

@dataclass
class User:
    id: str
    name: str
    age: Optional[int]
    dob: Optional[str]
    about_you: str
    personality_type: Optional[str]
    likes: List[str]
    current_personality_id: Optional[str]
    user_type: str = "family"

@dataclass
class Session:
    id: str  # session_id
    started_at: float
    ended_at: Optional[float]
    duration_sec: Optional[float]
    client_type: str  # 'desktop' | 'device'
    user_id: Optional[str]
    personality_id: Optional[str]

class DBService:
    def __init__(self, db_path: str = DB_PATH):
        if not db_path:
            db_path = DEFAULT_DB_PATH
        self.db_path = db_path
        if self.db_path != ":memory:":
            try:
                Path(self.db_path).expanduser().parent.mkdir(parents=True, exist_ok=True)
            except Exception:
                pass
        self.seeded_ok = False
        self._maybe_reset_db()
        self._apply_migrations()
        self._seed_defaults()
        self.seeded_ok = True

    def sync_global_voices_and_personalities(self) -> None:
        conn = self._get_conn()
        cursor = conn.cursor()
        try:
            self._sync_global_voices_and_personalities(cursor, conn)
            conn.commit()
        finally:
            conn.close()

    def get_table_count(self, table: str) -> int:
        try:
            conn = self._get_conn()
            cursor = conn.cursor()
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table,))
            if not cursor.fetchone():
                conn.close()
                return 0
            cursor.execute(f"SELECT COUNT(1) AS n FROM {table}")
            row = cursor.fetchone()
            conn.close()
            return int(row["n"]) if row and row["n"] is not None else 0
        except Exception:
            return 0

    def _get_conn(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _maybe_reset_db(self) -> None:
        if os.environ.get("ELATO_WIPE_DB", "0") != "1":
            return
        try:
            if os.path.exists(self.db_path):
                os.remove(self.db_path)
            wal = f"{self.db_path}-wal"
            shm = f"{self.db_path}-shm"
            if os.path.exists(wal):
                os.remove(wal)
            if os.path.exists(shm):
                os.remove(shm)
        except Exception:
            pass

    def _apply_migrations(self) -> None:
        base_dir = os.path.dirname(os.path.abspath(__file__))
        
        # Try specific locations:
        # 1. Env var
        # 2. Local "migrations" folder (bundled/production)
        # 3. "../../migrations" (dev mode, repo root)
        candidates = [
            os.environ.get("ELATO_MIGRATIONS_DIR"),
            os.path.join(base_dir, "migrations"),
            os.path.abspath(os.path.join(base_dir, "../../migrations")),
        ]
        
        migrations_dir = None
        for candidate in candidates:
            if candidate and os.path.isdir(candidate):
                migrations_dir = candidate
                break
        
        if not migrations_dir:
            print(f"Warning: Migrations directory not found. Searched: {candidates}")
            return

        conn = self._get_conn()
        cursor = conn.cursor()

        cursor.execute("PRAGMA journal_mode=WAL;")
        cursor.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at REAL NOT NULL)"
        )

        cursor.execute("SELECT version FROM schema_migrations")
        applied = {row["version"] for row in cursor.fetchall()}

        files = sorted(glob.glob(os.path.join(migrations_dir, "*.sql")))
        for path in files:
            version = os.path.basename(path)
            if version in applied:
                continue
            with open(path, "r", encoding="utf-8") as f:
                sql = f.read().strip()
            if sql:
                cursor.executescript(sql)
            cursor.execute(
                "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
                (version, time.time()),
            )

        conn.commit()
        conn.close()

    def get_active_user_id(self) -> Optional[str]:
        conn = self._get_conn()
        cursor = conn.cursor()
        cursor.execute("SELECT value FROM app_state WHERE key = ?", ("active_user_id",))
        row = cursor.fetchone()
        conn.close()
        return row["value"] if row and row["value"] else None

    def set_active_user_id(self, user_id: Optional[str]) -> None:
        conn = self._get_conn()
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            ("active_user_id", user_id)
        )
        conn.commit()
        conn.close()

    def get_app_mode(self) -> str:
        conn = self._get_conn()
        cursor = conn.cursor()
        cursor.execute("SELECT value FROM app_state WHERE key = ?", ("app_mode",))
        row = cursor.fetchone()
        conn.close()
        return (row["value"] if row and row["value"] else None) or "idle"

    def set_app_mode(self, mode: Optional[str]) -> str:
        conn = self._get_conn()
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            ("app_mode", mode or "idle")
        )
        conn.commit()
        conn.close()
        return self.get_app_mode()

    def get_device_status(self) -> Dict[str, Any]:
        conn = self._get_conn()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT key, value FROM app_state WHERE key IN (?, ?, ?)",
            ("esp32_device", "esp32_connected", "esp32_session_id")
        )
        rows = cursor.fetchall()
        conn.close()

        data = {row["key"]: row["value"] for row in rows}

        # Preferred: JSON blob
        raw = data.get("esp32_device")
        if raw:
            try:
                obj = json.loads(raw)
                if isinstance(obj, dict):
                    # Do not expose legacy/removed fields.
                    obj.pop("power_state", None)
                    obj.pop("ws_session_id", None)
                    return obj
            except Exception:
                pass

        # Backwards compatibility
        connected = (data.get("esp32_connected") or "0") == "1"
        return {
            "mac_address": None,
            "volume": None,
            "flashed": None,
            "ws_status": "connected" if connected else "disconnected",
            "ws_last_seen": None,
            "firmware_version": None,
        }

    def set_device_status(self, connected: bool, session_id: Optional[str] = None) -> None:
        # Backwards-compatible setter (used by any older call sites).
        # Writes the new JSON blob and also keeps old keys updated.
        current = self.get_device_status() or {}
        current["ws_status"] = "connected" if connected else "disconnected"

        conn = self._get_conn()
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            ("esp32_device", json.dumps(current))
        )
        cursor.execute(
            "INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            ("esp32_connected", "1" if connected else "0")
        )
        conn.commit()
        conn.close()

    def update_esp32_device(self, patch: Dict[str, Any]) -> Dict[str, Any]:
        """Merge a patch into the esp32_device JSON blob and persist."""
        current = self.get_device_status() or {}
        if not isinstance(current, dict):
            current = {}
        if patch and isinstance(patch, dict):
            # Do not persist removed/legacy fields.
            patch = dict(patch)
            patch.pop("power_state", None)
            patch.pop("ws_session_id", None)
            patch.pop("ws_sessionId", None)
            patch.pop("esp32_session_id", None)
            current.update(patch)
        self.set_setting("esp32_device", json.dumps(current))
        return current

    def get_setting(self, key: str) -> Optional[str]:
        """Get a setting value by key from app_state."""
        conn = self._get_conn()
        cursor = conn.cursor()
        cursor.execute("SELECT value FROM app_state WHERE key = ?", (key,))
        row = cursor.fetchone()
        conn.close()
        return row["value"] if row else None

    def set_setting(self, key: str, value: Optional[str]) -> None:
        """Set a setting value by key in app_state."""
        conn = self._get_conn()
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value)
        )
        conn.commit()
        conn.close()

    def get_all_settings(self) -> Dict[str, Optional[str]]:
        """Get all settings from app_state."""
        conn = self._get_conn()
        cursor = conn.cursor()
        cursor.execute("SELECT key, value FROM app_state")
        rows = cursor.fetchall()
        conn.close()
        return {row["key"]: row["value"] for row in rows}

    def delete_setting(self, key: str) -> bool:
        """Delete a setting by key."""
        conn = self._get_conn()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM app_state WHERE key = ?", (key,))
        success = cursor.rowcount > 0
        conn.commit()
        conn.close()
        return success

    def start_session(self, session_id: str, client_type: str, user_id: Optional[str] = None, personality_id: Optional[str] = None) -> None:
        if user_id is None:
            user_id = self.get_active_user_id()
        conn = self._get_conn()
        cursor = conn.cursor()
        started_at = time.time()

        cursor.execute("PRAGMA table_info(sessions)")
        session_columns = [row["name"] for row in cursor.fetchall()]

        if "channel" in session_columns:
            cursor.execute(
                "INSERT OR IGNORE INTO sessions (id, started_at, ended_at, duration_sec, client_type, channel, user_id, personality_id) VALUES (?, ?, NULL, NULL, ?, ?, ?, ?)",
                (session_id, started_at, client_type, "chat", user_id, personality_id)
            )
        else:
            cursor.execute(
                "INSERT OR IGNORE INTO sessions (id, started_at, ended_at, duration_sec, client_type, user_id, personality_id) VALUES (?, ?, NULL, NULL, ?, ?, ?)",
                (session_id, started_at, client_type, user_id, personality_id)
            )

        if user_id is not None or personality_id is not None:
            cursor.execute(
                "UPDATE sessions SET user_id = COALESCE(user_id, ?), personality_id = COALESCE(personality_id, ?) WHERE id = ?",
                (user_id, personality_id, session_id)
            )
        conn.commit()
        conn.close()

    def end_session(self, session_id: str) -> None:
        conn = self._get_conn()
        cursor = conn.cursor()
        ended_at = time.time()
        cursor.execute("SELECT started_at, ended_at FROM sessions WHERE id = ?", (session_id,))
        row = cursor.fetchone()
        if row and row["started_at"] and not row["ended_at"]:
            duration = ended_at - row["started_at"]
            cursor.execute(
                "UPDATE sessions SET ended_at = ?, duration_sec = ? WHERE id = ?",
                (ended_at, duration, session_id)
            )
        conn.commit()
        conn.close()

    def get_sessions(self, limit: int = 50, offset: int = 0, user_id: Optional[str] = None) -> List[Session]:
        conn = self._get_conn()
        cursor = conn.cursor()
        cursor.execute("PRAGMA table_info(sessions)")
        session_columns = [row["name"] for row in cursor.fetchall()]

        if user_id and "user_id" in session_columns:
            cursor.execute(
                "SELECT * FROM sessions WHERE user_id = ? ORDER BY started_at DESC LIMIT ? OFFSET ?",
                (user_id, limit, offset)
            )
        else:
            cursor.execute(
                "SELECT * FROM sessions ORDER BY started_at DESC LIMIT ? OFFSET ?",
                (limit, offset)
            )
        rows = cursor.fetchall()
        conn.close()

        items: List[Session] = []
        for row in rows:
            items.append(
                Session(
                    id=row["id"],
                    started_at=row["started_at"],
                    ended_at=row["ended_at"],
                    duration_sec=row["duration_sec"],
                    client_type=row["client_type"],
                    user_id=row["user_id"] if "user_id" in session_columns else None,
                    personality_id=row["personality_id"] if "personality_id" in session_columns else None,
                )
            )
        return items

    def _seed_defaults(self):
        conn = self._get_conn()
        cursor = conn.cursor()

        try:
            self._sync_global_voices_and_personalities(cursor, conn)
        except Exception:
            pass

        cursor.execute("SELECT COUNT(1) AS n FROM users")
        row = cursor.fetchone()
        has_users = bool(row and row["n"])
        if not has_users:
            cursor.execute("SELECT id FROM personalities WHERE voice_id = ?", ("radio",))
            p_row = cursor.fetchone()
            default_personality_id = p_row["id"] if p_row else None
            default_user_id = str(uuid.uuid4())

            hobbies_csv = os.environ.get("ELATO_DEFAULT_USER_HOBBIES", "reading,lego,science")
            default_hobbies = ", ".join([h.strip() for h in hobbies_csv.split(",") if h.strip()])

            default_user_name = "Elato"
            cursor.execute(
                """INSERT INTO users (id, name, age, dob, hobbies, about_you, personality_type, likes, current_personality_id, user_type)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (default_user_id, default_user_name, 11, None, json.dumps([]), default_hobbies, None, json.dumps([]), default_personality_id, "family")
            )

        conn.commit()
        conn.close()

        if not self.get_active_user_id():
            conn = self._get_conn()
            cursor = conn.cursor()
            cursor.execute("SELECT id FROM users ORDER BY rowid ASC LIMIT 1")
            u = cursor.fetchone()
            conn.close()
            if u and u["id"]:
                self.set_active_user_id(u["id"])

    def _load_global_assets_payloads(self) -> tuple[Optional[Any], Optional[Any]]:
        base_dir = os.path.dirname(os.path.abspath(__file__))
        assets_candidates = [
            os.environ.get("ELATO_ASSETS_DIR"),
            os.path.abspath(os.path.join(base_dir, "../../elato-local/src/assets")),
        ]
        assets_dir = None
        for candidate in assets_candidates:
            if candidate and os.path.isdir(candidate):
                assets_dir = candidate
                break

        def _load_json_url(url: str) -> Optional[Any]:
            try:
                with urllib.request.urlopen(url, timeout=10) as resp:
                    return json.loads(resp.read().decode("utf-8"))
            except Exception:
                return None

        def _load_json_file(path: str) -> Optional[Any]:
            try:
                with open(path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                return None

        voices_url = os.environ.get(
            "ELATO_VOICES_JSON_URL",
            "https://raw.githubusercontent.com/akdeb/epic-local-ai-toys/refs/heads/main/elato-ui/src/assets/voices.json",
        )
        personalities_url = os.environ.get(
            "ELATO_PERSONALITIES_JSON_URL",
            "https://raw.githubusercontent.com/akdeb/epic-local-ai-toys/refs/heads/main/elato-ui/src/assets/personalities.json",
        )

        voices_payload = _load_json_url(voices_url)
        personalities_payload = _load_json_url(personalities_url)

        if voices_payload is None and assets_dir:
            voices_payload = _load_json_file(os.path.join(assets_dir, "voices.json"))
        if personalities_payload is None and assets_dir:
            personalities_payload = _load_json_file(os.path.join(assets_dir, "personalities.json"))

        return voices_payload, personalities_payload

    def _sync_global_voices_and_personalities(self, cursor: Any, conn: Any) -> None:
        try:
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='voices'")
            has_voices_table = bool(cursor.fetchone())
        except Exception:
            has_voices_table = False

        try:
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='personalities'")
            has_personalities_table = bool(cursor.fetchone())
        except Exception:
            has_personalities_table = False

        if not has_voices_table and not has_personalities_table:
            return

        voices_payload, personalities_payload = self._load_global_assets_payloads()

        if has_voices_table and isinstance(voices_payload, list):
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
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(voice_id) DO UPDATE SET
                      gender = excluded.gender,
                      voice_name = excluded.voice_name,
                      voice_description = excluded.voice_description,
                      voice_src = excluded.voice_src,
                      is_global = excluded.is_global,
                      created_at = COALESCE(voices.created_at, excluded.created_at)
                    WHERE voices.is_global = 1
                    """,
                    (
                        str(vid),
                        item.get("gender"),
                        str(vname),
                        item.get("voice_description") or item.get("description"),
                        item.get("voice_src") or item.get("src"),
                        True,
                        time.time(),
                    ),
                )

            conn.commit()

        if has_personalities_table and isinstance(personalities_payload, list):
            for item in personalities_payload:
                if not isinstance(item, dict):
                    continue
                p_id = item.get("id")
                name = item.get("name")
                prompt = item.get("prompt")
                short_desc = item.get("short_description")
                img_src = item.get("img_src")
                voice_id = item.get("voice_id")
                if not p_id or not name or not prompt or voice_id is None:
                    continue

                try:
                    cursor.execute("SELECT 1 FROM voices WHERE voice_id = ? LIMIT 1", (str(voice_id),))
                    if not cursor.fetchone():
                        continue
                except Exception:
                    continue

                cursor.execute(
                    """
                    INSERT INTO personalities (id, name, prompt, short_description, tags, is_visible, voice_id, is_global, img_src, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                    WHERE personalities.is_global = 1
                    """,
                    (
                        str(p_id),
                        str(name),
                        str(prompt),
                        str(short_desc or ""),
                        json.dumps([]),
                        True,
                        str(voice_id),
                        True,
                        str(img_src or ""),
                        time.time(),
                    ),
                )

    # --- Personalities CRUD ---

    # --- Voices CRUD ---

    def get_voices(self, include_non_global: bool = True) -> List[Voice]:
        conn = self._get_conn()
        cursor = conn.cursor()

        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='voices'")
        if not cursor.fetchone():
            conn.close()
            return []

        order = "ORDER BY CAST(COALESCE(created_at, 0) AS REAL) DESC, rowid DESC"
        if include_non_global:
            cursor.execute(f"SELECT * FROM voices {order}")
        else:
            cursor.execute(f"SELECT * FROM voices WHERE is_global = 1 {order}")

        rows = cursor.fetchall()
        conn.close()
        return [
            Voice(
                voice_id=row["voice_id"],
                gender=row["gender"],
                voice_name=row["voice_name"],
                voice_description=row["voice_description"],
                voice_src=row["voice_src"],
                is_global=bool(row["is_global"]) if "is_global" in row.keys() else False,
                created_at=row["created_at"] if "created_at" in row.keys() else None,
            )
            for row in rows
        ]

    def get_voice(self, voice_id: str) -> Optional[Voice]:
        conn = self._get_conn()
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='voices'")
        if not cursor.fetchone():
            conn.close()
            return None
        cursor.execute("SELECT * FROM voices WHERE voice_id = ?", (voice_id,))
        row = cursor.fetchone()
        conn.close()
        if not row:
            return None
        return Voice(
            voice_id=row["voice_id"],
            gender=row["gender"],
            voice_name=row["voice_name"],
            voice_description=row["voice_description"],
            voice_src=row["voice_src"],
            is_global=bool(row["is_global"]) if "is_global" in row.keys() else False,
            created_at=row["created_at"] if "created_at" in row.keys() else None,
        )

    def upsert_voice(
        self,
        voice_id: str,
        voice_name: str,
        gender: Optional[str] = None,
        voice_description: Optional[str] = None,
        voice_src: Optional[str] = None,
        is_global: bool = False,
    ) -> Optional[Voice]:
        conn = self._get_conn()
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='voices'")
        if not cursor.fetchone():
            conn.close()
            return None

        created_at = time.time()
        cursor.execute(
            """
            INSERT INTO voices (voice_id, gender, voice_name, voice_description, voice_src, is_global, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(voice_id) DO UPDATE SET
              gender = excluded.gender,
              voice_name = excluded.voice_name,
              voice_description = excluded.voice_description,
              voice_src = excluded.voice_src,
              is_global = excluded.is_global,
              created_at = COALESCE(voices.created_at, excluded.created_at)
            """,
            (voice_id, gender, voice_name, voice_description, voice_src, bool(is_global), created_at),
        )
        conn.commit()
        conn.close()
        return self.get_voice(voice_id)

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
        if self.get_voice(voice_id) is None:
            voice_id = "radio"

        p_id = str(uuid.uuid4())
        conn = self._get_conn()
        cursor = conn.cursor()

        created_at = time.time()
        cursor.execute(
            "INSERT INTO personalities (id, name, prompt, short_description, tags, is_visible, voice_id, is_global, img_src, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (p_id, name, prompt, short_description, json.dumps(tags), is_visible, voice_id, is_global, img_src, created_at),
        )

        conn.commit()
        conn.close()
        return Personality(p_id, name, prompt, short_description, tags, is_visible, is_global, voice_id, img_src, created_at)

    def get_personalities(self, include_hidden: bool = False) -> List[Personality]:
        conn = self._get_conn()
        cursor = conn.cursor()

        order = "ORDER BY CAST(COALESCE(created_at, 0) AS REAL) DESC, rowid DESC"
        if include_hidden:
            cursor.execute(f"SELECT * FROM personalities {order}")
        else:
            cursor.execute(f"SELECT * FROM personalities WHERE is_visible = 1 {order}")

        rows = cursor.fetchall()
        conn.close()

        results = []
        for row in rows:
            is_global = False
            if "is_global" in row.keys():
                is_global = bool(row["is_global"])

            results.append(
                Personality(
                    id=row["id"],
                    name=row["name"],
                    prompt=row["prompt"],
                    short_description=row["short_description"],
                    tags=json.loads(row["tags"]) if row["tags"] else [],
                    is_visible=bool(row["is_visible"]),
                    is_global=is_global,
                    voice_id=row["voice_id"],
                    img_src=row["img_src"] if "img_src" in row.keys() else None,
                    created_at=row["created_at"] if "created_at" in row.keys() else None,
                )
            )
        return results

    def get_personality(self, p_id: str) -> Optional[Personality]:
        conn = self._get_conn()
        cursor = conn.cursor()

        cursor.execute("SELECT * FROM personalities WHERE id = ?", (p_id,))
        row = cursor.fetchone()
        conn.close()
        
        if row:
            is_global = False
            if "is_global" in row.keys():
                is_global = bool(row["is_global"])

            return Personality(
                id=row["id"],
                name=row["name"],
                prompt=row["prompt"],
                short_description=row["short_description"],
                tags=json.loads(row["tags"]),
                is_visible=bool(row["is_visible"]),
                is_global=is_global,
                voice_id=row["voice_id"],
                img_src=row["img_src"] if "img_src" in row.keys() else None,
            )
        return None
    
    def get_personality_by_voice(self, voice_id: str) -> Optional[Personality]:
        conn = self._get_conn()
        cursor = conn.cursor()

        cursor.execute("SELECT * FROM personalities WHERE voice_id = ?", (voice_id,))
        row = cursor.fetchone()
        conn.close()
        
        if row:
            is_global = False
            if "is_global" in row.keys():
                is_global = bool(row["is_global"])

            return Personality(
                id=row["id"],
                name=row["name"],
                prompt=row["prompt"],
                short_description=row["short_description"],
                tags=json.loads(row["tags"]),
                is_visible=bool(row["is_visible"]),
                is_global=is_global,
                voice_id=row["voice_id"],
                img_src=row["img_src"] if "img_src" in row.keys() else None,
            )
        return None

    def update_personality(self, p_id: str, **kwargs) -> Optional[Personality]:
        current = self.get_personality(p_id)
        if not current:
            return None

        if getattr(current, "is_global", False) and "img_src" in kwargs:
            kwargs = dict(kwargs)
            kwargs.pop("img_src", None)
            
        # Prepare updates
        fields = []
        values = []
        
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
            if self.get_voice(kwargs["voice_id"]) is None:
                kwargs["voice_id"] = "radio"
            fields.append("voice_id = ?")
            values.append(kwargs["voice_id"])

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
        # Cascade delete: conversations (by session_id) -> sessions (by personality_id) -> personality.
        conn = self._get_conn()
        cursor = conn.cursor()

        # Detach users currently using this personality.
        try:
            cursor.execute(
                "UPDATE users SET current_personality_id = NULL WHERE current_personality_id = ?",
                (p_id,),
            )
        except Exception:
            pass

        # Find sessions associated with this personality.
        session_ids: List[str] = []
        try:
            cursor.execute("SELECT id FROM sessions WHERE personality_id = ?", (p_id,))
            session_ids = [row["id"] for row in cursor.fetchall()]
        except Exception:
            session_ids = []

        if session_ids:
            placeholders = ",".join(["?"] * len(session_ids))
            try:
                cursor.execute(f"DELETE FROM conversations WHERE session_id IN ({placeholders})", tuple(session_ids))
            except Exception:
                pass
            try:
                cursor.execute(f"DELETE FROM sessions WHERE id IN ({placeholders})", tuple(session_ids))
            except Exception:
                pass

        cursor.execute("DELETE FROM personalities WHERE id = ? AND COALESCE(is_global, 0) = 0", (p_id,))
        success = cursor.rowcount > 0
        conn.commit()
        conn.close()
        return success

    # --- Conversations CRUD ---

    def log_conversation(self, role: str, transcript: str, session_id: Optional[str] = None) -> Conversation:
        c_id = str(uuid.uuid4())
        timestamp = time.time()
        
        conn = self._get_conn()
        cursor = conn.cursor()

        cursor.execute(
            "INSERT INTO conversations (id, role, transcript, timestamp, session_id) VALUES (?, ?, ?, ?, ?)",
            (c_id, role, transcript, timestamp, session_id)
        )
        conn.commit()
        conn.close()
        
        return Conversation(c_id, role, transcript, timestamp, session_id)

    def get_conversations(self, limit: int = 50, offset: int = 0, session_id: Optional[str] = None) -> List[Conversation]:
        conn = self._get_conn()
        cursor = conn.cursor()

        if session_id:
            cursor.execute(
                "SELECT * FROM conversations WHERE session_id = ? ORDER BY timestamp ASC",
                (session_id,)
            )
        else:
            cursor.execute(
                "SELECT * FROM conversations ORDER BY timestamp DESC LIMIT ? OFFSET ?",
                (limit, offset)
            )
        rows = cursor.fetchall()
        conn.close()
        
        return [
            Conversation(
                id=row["id"],
                role=row["role"],
                transcript=row["transcript"],
                timestamp=row["timestamp"],
                session_id=row["session_id"] if "session_id" in row.keys() else None
            )
            for row in rows
        ]

    def delete_conversation(self, c_id: str) -> bool:
        conn = self._get_conn()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM conversations WHERE id = ?", (c_id,))
        success = cursor.rowcount > 0
        conn.commit()
        conn.close()
        return success

    def clear_conversations(self):
        conn = self._get_conn()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM conversations")
        conn.commit()
        conn.close()

    # --- User CRUD ---

    def create_user(
        self,
        name: str,
        age: Optional[int] = None,
        dob: Optional[str] = None,
        about_you: str = "",
        personality_type: Optional[str] = None,
        likes: List[str] = [],
        current_personality_id: Optional[str] = None,
        user_type: str = "family",
    ) -> User:
        u_id = str(uuid.uuid4())
        conn = self._get_conn()
        cursor = conn.cursor()
        cursor.execute(
            """INSERT INTO users (id, name, age, dob, hobbies, about_you, personality_type, likes, current_personality_id, user_type) 
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (u_id, name, age, dob, json.dumps([]), about_you or "", personality_type, json.dumps(likes), current_personality_id, user_type)
        )
        conn.commit()
        conn.close()
        return User(u_id, name, age, dob, about_you or "", personality_type, likes, current_personality_id, user_type)

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
                about_you=(row["about_you"] if "about_you" in row.keys() and row["about_you"] is not None else ""),
                personality_type=row["personality_type"],
                likes=json.loads(row["likes"]) if row["likes"] else [],
                current_personality_id=row["current_personality_id"],
                user_type=row["user_type"] if "user_type" in row.keys() else "family",
            )
            for row in rows
        ]

    def get_user(self, u_id: str) -> Optional[User]:
        conn = self._get_conn()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM users WHERE id = ?", (u_id,))
        row = cursor.fetchone()
        conn.close()
        
        if row:
            return User(
                id=row["id"],
                name=row["name"],
                age=row["age"],
                dob=row["dob"],
                about_you=(row["about_you"] if "about_you" in row.keys() and row["about_you"] is not None else ""),
                personality_type=row["personality_type"],
                likes=json.loads(row["likes"]) if row["likes"] else [],
                current_personality_id=row["current_personality_id"],
                user_type=row["user_type"] if "user_type" in row.keys() else "family",
            )
        return None

    def update_user(self, u_id: str, **kwargs) -> Optional[User]:
        current = self.get_user(u_id)
        if not current:
            return None
            
        fields = []
        values = []
        
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

    def delete_user(self, u_id: str) -> bool:
        conn = self._get_conn()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM users WHERE id = ?", (u_id,))
        success = cursor.rowcount > 0
        conn.commit()
        conn.close()
        return success

db_service = DBService()
