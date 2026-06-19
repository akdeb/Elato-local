"""ESP32 device state, firmware, and disconnect endpoints."""

from __future__ import annotations

import asyncio
import json
import time
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

import db_service
from services import list_serial_ports, prepare_firmware_images, run_firmware_flash

router = APIRouter()


class DeviceUpdate(BaseModel):
    mac_address: Optional[str] = None
    volume: Optional[int] = None
    flashed: Optional[bool] = None
    ws_status: Optional[str] = None
    ws_last_seen: Optional[float] = None
    firmware_version: Optional[str] = None


@router.get("/device")
async def get_device():
    return db_service.db_service.get_device_status()


@router.put("/device")
async def update_device(body: DeviceUpdate):
    patch = body.model_dump(exclude_unset=True)
    return db_service.db_service.update_esp32_device(patch)


@router.post("/device/disconnect")
async def disconnect_device(request: Request):
    # Stop any in-flight response immediately so the toy stops speaking the moment
    # End is pressed, rather than finishing the current reply. This mirrors how an
    # interrupt cancels the active TTS, and we await it so the final idle signal
    # below isn't raced by the cancelled response's own RESPONSE.COMPLETE.
    stop_response = getattr(request.app.state, "esp32_stop_response", None)
    if stop_response is not None:
        try:
            await stop_response()
        except Exception:
            pass

    esp32_ws = getattr(request.app.state, "esp32_ws", None)
    if esp32_ws:
        try:
            # Ending the chat should return the toy to its idle (white) connected
            # state, not put it to sleep. keep_listening=False stops the hands-free
            # VAD loop and idles the device; SESSION.END would deep-sleep it, so we
            # avoid that here.
            await esp32_ws.send_json({"type": "server", "msg": "RESPONSE.COMPLETE", "keep_listening": False})
        except Exception:
            pass
        try:
            await esp32_ws.close(code=1000)
        except Exception:
            pass
    request.app.state.esp32_ws = None
    request.app.state.esp32_session_id = None
    status = db_service.db_service.update_esp32_device(
        {"ws_status": "disconnected", "ws_last_seen": time.time(), "session_id": None}
    )
    push_device_event(request.app, status)
    return status


@router.post("/device/start")
async def start_device(request: Request):
    esp32_ws = getattr(request.app.state, "esp32_ws", None)
    if not esp32_ws:
        raise HTTPException(status_code=409, detail="ESP32 is not connected")

    start_event = getattr(request.app.state, "esp32_start_event", None)
    if start_event is None:
        raise HTTPException(status_code=503, detail="ESP32 start event is not ready")

    start_event.set()
    status = db_service.db_service.update_esp32_device(
        {"ws_status": "connected", "ws_last_seen": time.time()}
    )
    push_device_event(request.app, status)
    return status


class FirmwareFlashRequest(BaseModel):
    port: str
    baud: int = 460800
    chip: str = "esp32s3"
    offset: str = "0x10000"


@router.get("/firmware/ports")
async def firmware_ports():
    return {"ports": list_serial_ports()}


@router.post("/firmware/flash")
async def firmware_flash(body: FirmwareFlashRequest):
    firmware_dir, prep_log = prepare_firmware_images()
    if not firmware_dir:
        raise HTTPException(
            status_code=404,
            detail=f"Firmware images not found. {prep_log}",
        )
    fw_path = firmware_dir / "firmware.bin"

    def run() -> Dict[str, object]:
        res = run_firmware_flash(
            port=body.port, baud=body.baud, chip=body.chip,
            offset=body.offset, firmware_path=fw_path,
        )
        if prep_log:
            existing = str(res.get("output") or "")
            res["output"] = (prep_log + "\n\n" + existing).strip()
        return res

    return await asyncio.to_thread(run)


def push_device_event(app, payload: Dict[str, object]) -> None:
    watchers = getattr(app.state, "device_watchers", set())
    for q in list(watchers):
        try:
            q.put_nowait(payload)
        except Exception:
            pass
