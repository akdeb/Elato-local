from typing import Dict, Optional


class SettingsMixin:
    def get_setting(self, key: str) -> Optional[str]:
        conn = self._get_conn()
        cursor = conn.cursor()
        cursor.execute("SELECT value FROM app_state WHERE key = ?", (key,))
        row = cursor.fetchone()
        conn.close()
        return row["value"] if row else None

    def set_setting(self, key: str, value: Optional[str]) -> None:
        conn = self._get_conn()
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO app_state (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )
        conn.commit()
        conn.close()

    def get_all_settings(self) -> Dict[str, Optional[str]]:
        conn = self._get_conn()
        cursor = conn.cursor()
        cursor.execute("SELECT key, value FROM app_state")
        rows = cursor.fetchall()
        conn.close()
        return {row["key"]: row["value"] for row in rows}

    def delete_setting(self, key: str) -> bool:
        conn = self._get_conn()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM app_state WHERE key = ?", (key,))
        success = cursor.rowcount > 0
        conn.commit()
        conn.close()
        return success

    def get_active_user_id(self) -> Optional[str]:
        return self.get_setting("active_user_id")

    def set_active_user_id(self, user_id: Optional[str]) -> None:
        self.set_setting("active_user_id", user_id)

    def get_app_mode(self) -> str:
        return self.get_setting("app_mode") or "idle"

    def set_app_mode(self, mode: Optional[str]) -> str:
        self.set_setting("app_mode", mode or "idle")
        return self.get_app_mode()
