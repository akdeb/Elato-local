import os
from pathlib import Path
from typing import Optional


def resolve_voice_ref_audio_path(voice_id: Optional[str]) -> Optional[str]:
    if not voice_id:
        return None
    voices_dir = os.environ.get("ELATO_VOICES_DIR")
    if not voices_dir:
        return None
    try:
        path = Path(voices_dir).joinpath(f"{voice_id}.wav")
        if path.exists() and path.is_file():
            return str(path)
    except Exception:
        return None
    return None
