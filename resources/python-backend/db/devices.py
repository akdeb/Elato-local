import json
from typing import Any, Dict

DEFAULT_DEVICE_STATUS = {
    "mac_address": None,
    "volume": None,
    "flashed": None,
    "ws_status": "disconnected",
    "ws_last_seen": None,
    "firmware_version": None,
}


class DeviceMixin:
    def get_device_status(self) -> Dict[str, Any]:
        raw = self.get_setting("esp32_device")
        if raw:
            try:
                data = json.loads(raw)
                if isinstance(data, dict):
                    return {**DEFAULT_DEVICE_STATUS, **data}
            except Exception:
                pass
        return dict(DEFAULT_DEVICE_STATUS)

    def update_esp32_device(self, patch: Dict[str, Any]) -> Dict[str, Any]:
        current = self.get_device_status()
        patch = patch or {}
        if isinstance(patch, dict):
            current.update(patch)
        self.set_setting("esp32_device", json.dumps(current))
        return current
