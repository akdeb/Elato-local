import logging
from typing import Optional

from .base import BaseDB
from .conversations import ConversationsMixin
from .devices import DeviceMixin
from .migrations import apply_migrations
from .paths import migrations_dir, resolve_db_path
from .personalities import PersonalitiesMixin
from .seeds import SeedMixin
from .sessions import SessionsMixin
from .settings import SettingsMixin
from .users import UsersMixin
from .voices import VoicesMixin

logger = logging.getLogger(__name__)


class DBService(
    BaseDB,
    SettingsMixin,
    DeviceMixin,
    VoicesMixin,
    PersonalitiesMixin,
    UsersMixin,
    SessionsMixin,
    ConversationsMixin,
    SeedMixin,
):
    def __init__(self, db_path: Optional[str] = None) -> None:
        self.db_path = resolve_db_path(db_path)
        if self.db_path and self.db_path != ":memory:":
            from pathlib import Path

            Path(self.db_path).expanduser().parent.mkdir(parents=True, exist_ok=True)

        conn = self._get_conn()
        apply_migrations(conn, migrations_dir())
        conn.close()

        self.seeded_ok = False
        try:
            self.sync_global_voices_and_personalities()
            self._seed_default_user()
            self.seeded_ok = True
        except Exception:
            logger.exception("DB seed failed")


db_service = DBService()
