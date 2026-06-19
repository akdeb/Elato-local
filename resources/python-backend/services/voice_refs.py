import os
import json
import logging
from pathlib import Path
from typing import Optional

VOICE_TRANSCRIPT_CACHE: dict[str, str] | None = None
logger = logging.getLogger(__name__)

def _default_app_data_dir() -> Path:
    db_path = os.environ.get("ELATO_DB_PATH")
    if db_path:
        return Path(db_path).expanduser().resolve().parent
    try:
        from db.paths import default_db_path
        return Path(default_db_path()).expanduser().resolve().parent
    except Exception:
        return Path.cwd()


def _voices_dir() -> Path:
    return Path(os.environ.get("ELATO_VOICES_DIR") or _default_app_data_dir().joinpath("voices"))


def _assets_dir() -> Path:
    if os.environ.get("ELATO_ASSETS_DIR"):
        return Path(os.environ["ELATO_ASSETS_DIR"]).expanduser().resolve()
    return Path(__file__).resolve().parents[3] / "app" / "src" / "assets"


def _cache_voice_transcripts_from_payload(payload: object) -> None:
    if not isinstance(payload, list):
        return
    for item in payload:
        if not isinstance(item, dict):
            continue
        vid = str(item.get("voice_id") or "").strip()
        transcript = str(item.get("transcript") or "").strip()
        if vid and transcript:
            VOICE_TRANSCRIPT_CACHE[vid] = transcript


def resolve_voice_ref_audio_path(voice_id: Optional[str]) -> Optional[str]:
    if not voice_id:
        return None
    try:
        path = _voices_dir().joinpath(f"{voice_id}.wav")
        if path.exists() and path.is_file():
            return str(path)
    except Exception:
        return None
    return None


def resolve_voice_ref_text(voice_id: Optional[str]) -> Optional[str]:
    if not voice_id:
        return None

    # Deterministic source of truth: DB (covers both global and user-created voices).
    try:
        import db_service

        v = db_service.db_service.get_voice(voice_id)
        t = (getattr(v, "transcript", None) or "").strip() if v else ""
        if t:
            return t
    except Exception:
        pass

    global VOICE_TRANSCRIPT_CACHE
    if VOICE_TRANSCRIPT_CACHE is None:
        VOICE_TRANSCRIPT_CACHE = {}
        voices_json = _assets_dir() / "voices.json"
        try:
            if voices_json.exists():
                _cache_voice_transcripts_from_payload(json.loads(voices_json.read_text(encoding="utf-8")))
        except Exception as e:
            logger.warning("Failed to load local voice transcripts (%s): %s", voices_json, e)
    return VOICE_TRANSCRIPT_CACHE.get(voice_id)
