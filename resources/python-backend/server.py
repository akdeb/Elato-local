# main.py
import argparse
import asyncio
import base64
import json
import logging
import os
import re
import subprocess
import sys
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from glob import glob
from typing import Dict, List, Optional
import socket

os.environ.setdefault("HF_HUB_DISABLE_XET", "1")
os.environ.setdefault("HF_HUB_ENABLE_HF_TRANSFER", "1")
os.environ.setdefault("HF_XET_DISABLE", "1")
os.environ.setdefault("HF_HUB_DISABLE_HF_XET", "1")

from engine.characters import build_llm_messages, build_runtime_context, build_system_prompt

import mlx.core as mx
import numpy as np
import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Query
from fastapi.responses import StreamingResponse
from starlette.websockets import WebSocketState
from mlx_lm import generate as mx_generate
from mlx_lm.utils import load as load_llm

from mlx_audio.stt.models.whisper import Model as Whisper
from tts import ChatterboxTTS, PocketTTS
import db_service  # DB ops exposed via HTTP endpoints
from fastapi.middleware.cors import CORSMiddleware
import utils
from utils import STT, LLM, TTS, create_opus_packetizer

# Client type constants
CLIENT_TYPE_DESKTOP = "desktop"
CLIENT_TYPE_ESP32 = "esp32"

# Bump this string when changing prompt/sanitization so logs prove which code is running.
SERVER_BUILD_MARKER = "sanitize_v1_paraling_v2"


def _sanitize_spoken_text(text: str, *, allow_paralinguistic: bool = True) -> str:
    if not text:
        return text

    allowed_cues = {
        "laugh",
        "chuckle",
        "sigh",
        "gasp",
        "cough",
        "clear throat",
        "sniff",
        "groan",
        "shush",
    }

    # Strip common Markdown markers that sometimes leak into speech.
    text = text.replace("`", "")
    text = text.replace("**", "")
    text = text.replace("*", "")
    text = text.replace("__", "")
    text = text.replace("_", "")

    if allow_paralinguistic:
        def _keep_or_drop(m: re.Match) -> str:
            tag = (m.group(1) or "").strip()
            tag_norm = " ".join(tag.lower().split())
            if tag_norm in allowed_cues:
                return f"[{tag_norm}]"
            return ""

        text = re.sub(r"\[([^\]]+)\]", _keep_or_drop, text)
    else:
        text = re.sub(r"\[[^\]]+\]", "", text)
    text = re.sub(r"\s{2,}", " ", text).strip()
    return text

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)
logger.info(f"Server build marker: {SERVER_BUILD_MARKER}")

GAIN_DB = 7.0
CEILING = 0.89

def _resolve_voice_ref_audio_path(voice_id: Optional[str]) -> Optional[str]:
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


class VoicePipeline:
    def __init__(
        self,
        silence_threshold=0.03,
        silence_duration=1.5,
        input_sample_rate=16_000,
        output_sample_rate=24_000,
        streaming_interval=1.5,
        frame_duration_ms=30,
        stt_model=STT,
        llm_model=LLM,
        tts_ref_audio: str | None = None,
        tts_backend: str = "pocket",
    ):
        self.silence_threshold = silence_threshold
        self.silence_duration = silence_duration
        self.input_sample_rate = input_sample_rate
        self.output_sample_rate = output_sample_rate
        self.streaming_interval = streaming_interval
        self.frame_duration_ms = frame_duration_ms

        # Hardcoded STT model as requested
        self.stt_model_id = STT
        # LLM model is dynamic
        self.llm_model = llm_model
        self.tts_ref_audio = tts_ref_audio
        self.tts_backend = tts_backend

        self.mlx_lock = asyncio.Lock()

    async def init_models(self):
        logger.info(f"Loading text generation model: {self.llm_model}")
        self.llm, self.tokenizer = await asyncio.to_thread(
            lambda: load_llm(self.llm_model)
        )

        logger.info(f"Loading speech-to-text model: {self.stt_model_id}")
        self.stt = Whisper.from_pretrained(self.stt_model_id)

        await self._init_tts()

    async def _init_tts(self):
        backend = (self.tts_backend or "").strip().lower() or "pocket"
        if backend not in ("pocket", "chatterbox"):
            backend = "pocket"

        if backend == "chatterbox":
            self.tts = ChatterboxTTS(
                model_id=TTS,
                output_sample_rate=self.output_sample_rate,
                stream=True,
                streaming_interval=self.streaming_interval,
            )
        else:
            self.tts = PocketTTS(
                model_id=TTS,
                output_sample_rate=self.output_sample_rate,
                stream=True,
                streaming_interval=self.streaming_interval,
            )

        await asyncio.to_thread(self.tts.load)

    async def set_tts_backend(self, backend: str) -> str:
        backend = (backend or "").strip().lower()
        if backend not in ("pocket", "chatterbox"):
            raise ValueError("tts_backend must be 'pocket' or 'chatterbox'")

        async with self.mlx_lock:
            self.tts_backend = backend
            await self._init_tts()
        return backend

        # # Warm up TTS once at startup
        # logger.info("Warming up TTS...")
        # async with self.mlx_lock:
        #     await asyncio.to_thread(self.tts.warmup)
        # logger.info("TTS warmup done.")

    async def generate_text_simple(self, prompt: str, max_tokens=100) -> str:
        """Helper to generate text from the loaded LLM for internal tasks."""
        if not self.llm or not self.tokenizer:
            # If LLM is not loaded, we can't generate. 
            # In a real app we might want to load it on demand or fail gracefully.
            raise RuntimeError("LLM not initialized")
            
        messages = [{"role": "user", "content": prompt}]
        formatted_prompt = self.tokenizer.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=True
        )
        
        async with self.mlx_lock:
             # Run generation in thread to avoid blocking loop
             response = await asyncio.to_thread(
                 lambda: mx_generate(
                     self.llm, 
                     self.tokenizer, 
                     prompt=formatted_prompt, 
                     max_tokens=max_tokens, 
                     verbose=False
                 )
             )
        return response.strip()

    async def transcribe(self, audio_bytes: bytes) -> str:
        audio = (
            np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32) / 32768.0
        )
        async with self.mlx_lock:
            result = await asyncio.to_thread(self.stt.generate, mx.array(audio))
        return result.text.strip()

    async def generate_response(
        self,
        text: str,
        system_prompt: str = None,
        messages: Optional[List[Dict[str, str]]] = None,
        max_tokens: int = 512,
    ) -> str:
        """
        Generate full LLM response text.
        """
        if messages is None:
            sys_content = system_prompt or (
                "You are a helpful voice assistant. You always respond with short "
                "sentences and never use punctuation like parentheses or colons "
                "that wouldn't appear in conversational speech."
            )
            messages = [
                {"role": "system", "content": sys_content},
                {"role": "user", "content": text},
            ]

        prompt = self.tokenizer.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=True
        )

        async with self.mlx_lock:
            response = await asyncio.to_thread(
                lambda: mx_generate(
                    self.llm,
                    self.tokenizer,
                    prompt=prompt,
                    max_tokens=max_tokens,
                    verbose=False,
                )
            )
        return response.strip()

    async def synthesize_speech(
        self,
        text: str,
        cancel_event: asyncio.Event = None,
        ref_audio_path: Optional[str] = None,
    ):
        """
        Generator that yields audio chunks (as int16 PCM bytes) for the given text.
        Can be cancelled by setting cancel_event.
        """
        audio_queue = asyncio.Queue()
        loop = asyncio.get_running_loop()

        def _tts_stream():
            # TTS wrapper already returns int16 PCM bytes
            for audio_bytes in self.tts.generate(text, ref_audio_path=ref_audio_path):
                if cancel_event and cancel_event.is_set():
                    break
                loop.call_soon_threadsafe(audio_queue.put_nowait, audio_bytes)
            loop.call_soon_threadsafe(audio_queue.put_nowait, None)

        async with self.mlx_lock:
            tts_task = asyncio.create_task(asyncio.to_thread(_tts_stream))
            try:
                while True:
                    chunk = await audio_queue.get()
                    if chunk is None:
                        break
                    if cancel_event and cancel_event.is_set():
                        break
                    yield chunk
            finally:
                await tts_task


class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info(
            f"Client connected. Total connections: {len(self.active_connections)}"
        )

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        logger.info(
            f"Client disconnected. Total connections: {len(self.active_connections)}"
        )


pipeline: VoicePipeline = None
manager = ConnectionManager()

# mDNS service advertisement
mdns_service_info = None
zeroconf_instance = None
current_mdns_ip = None


def _get_local_ip() -> str:
    """Get the local IP address of this machine on the network."""
    try:
        # Create a socket to determine the local IP
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


def _start_mdns_service(port: int):
    """Start mDNS service advertisement for ESP32 discovery."""
    global mdns_service_info, zeroconf_instance, current_mdns_ip
    try:
        from zeroconf import ServiceInfo, Zeroconf
        
        local_ip = _get_local_ip()
        logger.info(f"Starting mDNS service advertisement on {local_ip}:{port}")
        
        # Create service info for _elato._tcp.local
        mdns_service_info = ServiceInfo(
            "_elato._tcp.local.",
            "Elato Voice Server._elato._tcp.local.",
            addresses=[socket.inet_aton(local_ip)],
            port=port,
            properties={"path": "/ws/esp32"},
            server="elato.local.",
        )
        
        zeroconf_instance = Zeroconf()
        zeroconf_instance.register_service(mdns_service_info)
        current_mdns_ip = local_ip
        logger.info(f"mDNS service registered: _elato._tcp.local on {local_ip}:{port}")
    except ImportError:
        logger.warning("zeroconf not installed, mDNS service advertisement disabled")
    except Exception as e:
        logger.error(f"Failed to start mDNS service: {e}")


def _stop_mdns_service():
    """Stop mDNS service advertisement."""
    global mdns_service_info, zeroconf_instance, current_mdns_ip
    try:
        if zeroconf_instance and mdns_service_info:
            zeroconf_instance.unregister_service(mdns_service_info)
            zeroconf_instance.close()
            logger.info("mDNS service stopped")
    except Exception as e:
        logger.error(f"Failed to stop mDNS service: {e}")
    finally:
        mdns_service_info = None
        zeroconf_instance = None
        current_mdns_ip = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global pipeline
    app.state.pipeline_ready = False
    
    # Start mDNS service advertisement
    server_port = getattr(app.state, "server_port", 8000)
    _start_mdns_service(server_port)
    
    # Initialize database (already handled by module import, but logging for clarity)
    logger.info("Database service active")

    # Sync latest global voices/personalities on startup (best-effort).
    try:
        db_service.db_service.sync_global_voices_and_personalities()
    except Exception as e:
        logger.warning(f"Global assets sync failed: {e}")

    # Set defaults if not already set (e.g. running via uvicorn directly)
    if not hasattr(app.state, "stt_model"):
        app.state.stt_model = STT
    if not hasattr(app.state, "llm_model"):
        app.state.llm_model = db_service.db_service.get_setting("llm_model") or LLM
    if not hasattr(app.state, "tts_backend"):
        app.state.tts_backend = db_service.db_service.get_setting("tts_backend") or "pocket"
    # if not hasattr(app.state, "tts_ref_audio"):
    #     app.state.tts_ref_audio = os.path.join(os.path.dirname(__file__), "tts", "santa.wav")
    if not hasattr(app.state, "silence_threshold"):
        app.state.silence_threshold = 0.03
    if not hasattr(app.state, "silence_duration"):
        app.state.silence_duration = 1.5
    if not hasattr(app.state, "streaming_interval"):
        app.state.streaming_interval = 3
    if not hasattr(app.state, "output_sample_rate"):
        app.state.output_sample_rate = 24_000
    
    pipeline = VoicePipeline(
        stt_model=app.state.stt_model,
        llm_model=app.state.llm_model,
        # tts_ref_audio=app.state.tts_ref_audio,
        tts_ref_audio=None,
        tts_backend=app.state.tts_backend,
        silence_threshold=app.state.silence_threshold,
        silence_duration=app.state.silence_duration,
        streaming_interval=app.state.streaming_interval,
        output_sample_rate=app.state.output_sample_rate,
    )
    await pipeline.init_models()
    logger.info("Voice pipeline initialized")
    app.state.pipeline_ready = True
    yield
    logger.info("Shutting down...")
    _stop_mdns_service()


app = FastAPI(title="Voice Pipeline WebSocket Server", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=".*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- HTTP Endpoints for Settings ---

from pydantic import BaseModel
from typing import Optional, Dict, Any

class SettingUpdate(BaseModel):
    value: Optional[str] = None

@app.get("/network-info")
async def network_info():
    real_ip = _get_local_ip()
    return {
        "ip": real_ip,
        "advertising_ip": current_mdns_ip
    }

@app.post("/restart-mdns")
async def restart_mdns():
    """Force restart mDNS service (useful after network change)."""
    server_port = getattr(app.state, "server_port", 8000)
    logger.info("Manual mDNS restart requested")
    _stop_mdns_service()
    _start_mdns_service(server_port)
    return {"status": "restarted", "ip": current_mdns_ip}

@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/startup-status")
async def startup_status():
    voices_n = db_service.db_service.get_table_count("voices")
    personalities_n = db_service.db_service.get_table_count("personalities")
    seeded = bool(getattr(db_service.db_service, "seeded_ok", False)) and voices_n > 0 and personalities_n > 0
    pipeline_ready = bool(getattr(app.state, "pipeline_ready", False))
    return {
        "ready": bool(seeded and pipeline_ready),
        "seeded": bool(seeded),
        "pipeline_ready": bool(pipeline_ready),
        "counts": {"voices": voices_n, "personalities": personalities_n},
    }

@app.get("/settings")
async def get_all_settings():
    """Get all settings from app_state."""
    return db_service.db_service.get_all_settings()

@app.get("/settings/{key}")
async def get_setting(key: str):
    """Get a specific setting by key."""
    value = db_service.db_service.get_setting(key)
    return {"key": key, "value": value}

@app.put("/settings/{key}")
async def set_setting(key: str, body: SettingUpdate):
    """Set a setting value."""
    db_service.db_service.set_setting(key, body.value)
    if key == "tts_backend":
        try:
            if pipeline:
                await pipeline.set_tts_backend(body.value or "")
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
    return {"key": key, "value": body.value}

@app.delete("/settings/{key}")
async def delete_setting(key: str):
    """Delete a setting."""
    success = db_service.db_service.delete_setting(key)
    return {"deleted": success}

# --- Convenience endpoints for common settings ---

@app.get("/active-user")
async def get_active_user():
    """Get the active user ID."""
    user_id = db_service.db_service.get_active_user_id()
    user = db_service.db_service.get_user(user_id) if user_id else None
    return {
        "user_id": user_id,
        "user": {
            "id": user.id,
            "name": user.name,
            "current_personality_id": user.current_personality_id,
        } if user else None
    }

class ActiveUserUpdate(BaseModel):
    user_id: Optional[str] = None

@app.put("/active-user")
async def set_active_user(body: ActiveUserUpdate):
    """Set the active user ID."""
    db_service.db_service.set_active_user_id(body.user_id)
    return await get_active_user()

@app.get("/app-mode")
async def get_app_mode():
    """Get the current app mode."""
    return {"mode": db_service.db_service.get_app_mode()}

class AppModeUpdate(BaseModel):
    mode: str

@app.put("/app-mode")
async def set_app_mode(body: AppModeUpdate):
    """Set the app mode."""
    mode = db_service.db_service.set_app_mode(body.mode)
    return {"mode": mode}

# --- ESP32 device state ---

class DeviceUpdate(BaseModel):
    mac_address: Optional[str] = None
    volume: Optional[int] = None
    flashed: Optional[bool] = None
    ws_status: Optional[str] = None
    ws_last_seen: Optional[float] = None
    firmware_version: Optional[str] = None

@app.get("/device")
async def get_device():
    """Get current ESP32 device state."""
    return db_service.db_service.get_device_status()

@app.put("/device")
async def update_device(body: DeviceUpdate):
    """Patch ESP32 device state."""
    patch = body.model_dump(exclude_unset=True)
    return db_service.db_service.update_esp32_device(patch)


class FirmwareFlashRequest(BaseModel):
    port: str
    baud: int = 460800
    chip: str = "esp32s3"
    offset: str = "0x10000"


def _list_serial_ports() -> List[str]:
    try:
        from serial.tools import list_ports  # type: ignore

        ports = [p.device for p in list_ports.comports() if getattr(p, "device", None)]
        ports = [p for p in ports if isinstance(p, str) and p]
        return sorted(list(dict.fromkeys(ports)))
    except Exception:
        paths = []
        paths.extend(glob("/dev/tty.*"))
        paths.extend(glob("/dev/cu.*"))
        return sorted(list(dict.fromkeys([p for p in paths if isinstance(p, str) and p])))


def _firmware_bin_path() -> Path:
    base = Path(__file__).resolve().parent
    return base / "firmware" / "firmware.bin"


@app.get("/firmware/ports")
async def firmware_ports():
    return {"ports": _list_serial_ports()}


@app.post("/firmware/flash")
async def firmware_flash(body: FirmwareFlashRequest):
    fw_path = _firmware_bin_path()
    if not fw_path.exists():
        raise HTTPException(status_code=404, detail=f"firmware.bin not found at {fw_path}")

    cmd = [
        sys.executable,
        "-m",
        "esptool",
        "--before",
        "default_reset",
        "--after",
        "hard_reset",
        "--chip",
        body.chip,
        "--port",
        body.port,
        "--baud",
        str(body.baud),
        "write_flash",
        "-z",
        body.offset,
        str(fw_path),
    ]

    def run() -> Dict[str, object]:
        proc = subprocess.run(cmd, capture_output=True, text=True)
        out = (proc.stdout or "") + ("\n" if proc.stdout and proc.stderr else "") + (proc.stderr or "")
        return {
            "ok": proc.returncode == 0,
            "exit_code": proc.returncode,
            "command": " ".join(cmd),
            "output": out,
        }

    return await asyncio.to_thread(run)

import webrtcvad

# --- Models endpoint (for frontend Models.tsx) ---

@app.get("/models")
async def get_models():
    """Get current model configuration."""
    return {
        "llm": {
            "backend": "mlx",
            "repo": db_service.db_service.get_setting("llm_model") or LLM,
            "file": None,
            "context_window": 4096,
            "loaded": pipeline is not None and pipeline.llm is not None,
        },
        "tts": {
            "backend": (getattr(pipeline, "tts_backend", None) or db_service.db_service.get_setting("tts_backend") or "pocket"),
            "backbone_repo": None,
            "codec_repo": None,
            "loaded": pipeline is not None and pipeline.tts is not None,
        },
        "stt": {
            "backend": "whisper",
            "repo": "mlx-community/whisper-large-v3-turbo",
            "loaded": pipeline is not None and pipeline.stt is not None,
        }
    }

class ModelsUpdate(BaseModel):
    model_repo: Optional[str] = None

@app.put("/models")
async def set_models(body: ModelsUpdate):
    """Set model configuration (requires restart to take effect)."""
    if body.model_repo:
        db_service.db_service.set_setting("llm_model", body.model_repo)
    return await get_models()


class ModelSwitchRequest(BaseModel):
    model_repo: str


@app.post("/models/switch")
async def switch_model(body: ModelSwitchRequest):
    """
    Download a new LLM model and hot-swap it into the running pipeline.
    Returns a streaming response with progress updates as JSON lines.
    
    Progress format (newline-delimited JSON):
    {"stage": "downloading", "progress": 0.5, "message": "Downloading..."}
    {"stage": "loading", "progress": 0.9, "message": "Loading model weights..."}
    {"stage": "complete", "progress": 1.0, "message": "Model switched successfully"}
    {"stage": "error", "error": "Error message"}
    """
    global pipeline
    
    model_repo = body.model_repo.strip()
    if not model_repo:
        raise HTTPException(status_code=400, detail="model_repo is required")
    
    async def generate_progress():
        try:
            # Stage 1: Download the model
            yield json.dumps({"stage": "downloading", "progress": 0.0, "message": f"Starting download of {model_repo}..."}) + "\n"
            
            from huggingface_hub import HfApi, snapshot_download
            from huggingface_hub.constants import HF_HUB_CACHE
            import threading
            import time
            
            download_complete = threading.Event()
            download_error = [None]
            download_path = [None]
            start_time = [asyncio.get_event_loop().time()]
            expected_total_bytes = [None]
            baseline_bytes = [0]
            last_bytes = [0]
            last_change_monotonic = [time.monotonic()]

            def _repo_cache_dir() -> str:
                # HF cache layout: $HF_HUB_CACHE/models--org--repo
                repo_dir_name = f"models--{model_repo.replace('/', '--')}"
                return os.path.join(str(HF_HUB_CACHE), repo_dir_name)

            def _repo_cache_bytes() -> int:
                # Count both completed blobs and any .incomplete files.
                try:
                    base = _repo_cache_dir()
                    total = 0
                    for sub in ("blobs", "snapshots"):
                        d = os.path.join(base, sub)
                        if not os.path.isdir(d):
                            continue
                        for root, _dirs, files in os.walk(d):
                            for fn in files:
                                fp = os.path.join(root, fn)
                                try:
                                    st = os.stat(fp)
                                    total += int(st.st_size)
                                except Exception:
                                    continue
                    return total
                except Exception:
                    return 0

            def _xet_cache_bytes() -> int:
                # When HF uses Xet/CAS (cas-bridge.xethub.hf.co), the bulk data is stored under
                # the xet cache (typically alongside the hub cache).
                try:
                    # HF_HUB_CACHE is usually .../huggingface/hub; xet cache is often .../huggingface/xet
                    hub_cache = str(HF_HUB_CACHE)
                    root = os.path.dirname(hub_cache)
                    candidates = [
                        os.path.join(root, "xet"),
                        os.path.join(root, "xet-cache"),
                    ]
                    # Allow overrides if present
                    for env_key in ("HF_XET_CACHE", "XET_CACHE_DIR", "XET_HOME"):
                        v = os.environ.get(env_key)
                        if v and v.strip():
                            candidates.insert(0, v.strip())

                    total = 0
                    for d in candidates:
                        if not d or not os.path.isdir(d):
                            continue
                        for root_dir, _dirs, files in os.walk(d):
                            for fn in files:
                                fp = os.path.join(root_dir, fn)
                                try:
                                    st = os.stat(fp)
                                    total += int(st.st_size)
                                except Exception:
                                    continue
                    return total
                except Exception:
                    return 0

            def _total_cache_bytes() -> int:
                # Track overall cache growth (hub + xet) relative to a baseline.
                return _repo_cache_bytes() + _xet_cache_bytes()

            def _compute_expected_total_bytes() -> int | None:
                try:
                    # Some repos only expose per-file sizes when files_metadata=True.
                    info = HfApi().model_info(model_repo, files_metadata=True)
                    total = 0
                    siblings = getattr(info, "siblings", None) or []
                    for s in siblings:
                        size = getattr(s, "size", None)
                        if isinstance(size, int) and size > 0:
                            total += size
                    return total or None
                except Exception:
                    return None
            
            def download_model():
                try:
                    # Reliability knobs:
                    # - Disable Xet backend (it can stall on some networks)
                    # - Try to enable hf_transfer if installed (faster/more resilient)
                    os.environ["HF_HUB_DISABLE_XET"] = "1"
                    os.environ["HF_HUB_ENABLE_HF_TRANSFER"] = "1"
                    os.environ["HF_XET_DISABLE"] = "1"
                    os.environ["HF_HUB_DISABLE_HF_XET"] = "1"

                    expected_total_bytes[0] = _compute_expected_total_bytes()

                    # Download the full model snapshot
                    path = snapshot_download(
                        repo_id=model_repo,
                        local_files_only=False,
                        resume_download=True,
                        max_workers=4,
                    )
                    download_path[0] = path
                except Exception as e:
                    download_error[0] = str(e)
                finally:
                    download_complete.set()
            
            # Start download in background thread
            download_thread = threading.Thread(target=download_model)
            download_thread.start()
            
            # Poll for completion and send progress updates.
            # We compute progress from bytes in the HF cache (works reliably when Xet is disabled).
            # Also detect stalls (no byte growth for a while) and surface a clear error.
            stall_seconds = 300  # 5 minutes

            # Baseline the cache size at start so we can report bytes downloaded for this request.
            baseline_bytes[0] = _total_cache_bytes()
            last_bytes[0] = 0
            while not download_complete.is_set():
                await asyncio.sleep(1.0)  # Check every second
                elapsed = asyncio.get_event_loop().time() - start_time[0]

                current_bytes = max(0, _total_cache_bytes() - baseline_bytes[0])
                if current_bytes != last_bytes[0]:
                    last_bytes[0] = current_bytes
                    last_change_monotonic[0] = time.monotonic()
                else:
                    if time.monotonic() - last_change_monotonic[0] > stall_seconds:
                        yield json.dumps({
                            "stage": "error",
                            "error": (
                                "Model download appears stalled (no disk progress for 5 minutes). "
                                "This is often caused by the HuggingFace Xet backend or an unstable network. "
                                "Please retry; the server now forces HF_HUB_DISABLE_XET=1."
                            ),
                        }) + "\n"
                        return

                if isinstance(expected_total_bytes[0], int) and expected_total_bytes[0] > 0:
                    progress = min(0.99, current_bytes / expected_total_bytes[0])
                else:
                    # Fallback: keep UI moving even if we couldn't estimate the total size.
                    progress = min(0.95, 1.0 - (1.0 / (1.0 + elapsed / 10.0)))
                
                # Show elapsed time in message for long downloads
                if elapsed > 30:
                    mins = int(elapsed // 60)
                    secs = int(elapsed % 60)
                    time_str = f"{mins}m {secs}s" if mins > 0 else f"{secs}s"
                    if isinstance(expected_total_bytes[0], int) and expected_total_bytes[0] > 0:
                        gb = current_bytes / (1024 ** 3)
                        total_gb = expected_total_bytes[0] / (1024 ** 3)
                        msg = f"Downloading {model_repo}... ({gb:.2f}/{total_gb:.2f} GB, {time_str} elapsed)"
                    else:
                        gb = current_bytes / (1024 ** 3)
                        msg = f"Downloading {model_repo}... ({gb:.2f} GB downloaded, {time_str} elapsed)"
                else:
                    gb = current_bytes / (1024 ** 3)
                    msg = f"Downloading {model_repo}... ({gb:.2f} GB)"
                
                yield json.dumps({"stage": "downloading", "progress": progress, "message": msg}) + "\n"
            
            download_thread.join()
            
            if download_error[0]:
                yield json.dumps({"stage": "error", "error": f"Download failed: {download_error[0]}"}) + "\n"
                return
            
            yield json.dumps({"stage": "downloading", "progress": 1.0, "message": "Download complete!"}) + "\n"
            
            # Stage 2: Load the model into memory
            yield json.dumps({"stage": "loading", "progress": 0.0, "message": "Loading model weights..."}) + "\n"
            
            try:
                # Load the new model
                new_llm, new_tokenizer = await asyncio.to_thread(
                    lambda: load_llm(model_repo)
                )
                
                yield json.dumps({"stage": "loading", "progress": 0.5, "message": "Model loaded, swapping..."}) + "\n"
                
                # Hot-swap the model in the pipeline
                if pipeline:
                    async with pipeline.mlx_lock:
                        # Replace the old model with the new one
                        old_llm = pipeline.llm
                        old_tokenizer = pipeline.tokenizer
                        
                        pipeline.llm = new_llm
                        pipeline.tokenizer = new_tokenizer
                        pipeline.llm_model = model_repo
                        
                        # Clear old model from memory
                        del old_llm
                        del old_tokenizer
                        mx.metal.clear_cache()
                
                # Save the setting
                db_service.db_service.set_setting("llm_model", model_repo)
                
                yield json.dumps({"stage": "loading", "progress": 1.0, "message": "Model weights loaded!"}) + "\n"
                yield json.dumps({"stage": "complete", "progress": 1.0, "message": f"Successfully switched to {model_repo}"}) + "\n"
                
            except Exception as e:
                logger.error(f"Failed to load model: {e}")
                yield json.dumps({"stage": "error", "error": f"Failed to load model: {str(e)}"}) + "\n"
                
        except Exception as e:
            logger.error(f"Model switch failed: {e}")
            yield json.dumps({"stage": "error", "error": str(e)}) + "\n"
    
    return StreamingResponse(
        generate_progress(),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    )


# --- Voices ---

@app.get("/voices")
async def get_voices(include_non_global: bool = True):
    voices = db_service.db_service.get_voices(include_non_global=include_non_global)
    return [
        {
            "voice_id": v.voice_id,
            "gender": v.gender,
            "voice_name": v.voice_name,
            "voice_description": v.voice_description,
            "voice_src": v.voice_src,
            "is_global": v.is_global,
            "created_at": getattr(v, "created_at", None),
        }
        for v in voices
    ]


class VoiceCreate(BaseModel):
    voice_id: str
    voice_name: str
    voice_description: Optional[str] = None


@app.post("/voices")
async def create_voice(body: VoiceCreate):
    v = db_service.db_service.upsert_voice(
        voice_id=body.voice_id,
        voice_name=body.voice_name,
        voice_description=body.voice_description,
        gender=None,
        voice_src=None,
        is_global=False,
    )
    if not v:
        raise HTTPException(status_code=500, detail="Failed to create voice")
    return {
        "voice_id": v.voice_id,
        "gender": v.gender,
        "voice_name": v.voice_name,
        "voice_description": v.voice_description,
        "voice_src": v.voice_src,
        "is_global": v.is_global,
        "created_at": getattr(v, "created_at", None),
    }

# --- Users CRUD ---

@app.get("/users")
async def get_users():
    """Get all users."""
    users = db_service.db_service.get_users()
    return [
        {
            "id": u.id,
            "name": u.name,
            "age": u.age,
            "current_personality_id": u.current_personality_id,
            "user_type": u.user_type,
            "about_you": getattr(u, "about_you", "") or "",
        }
        for u in users
    ]

class UserCreate(BaseModel):
    name: str
    age: Optional[int] = None
    about_you: Optional[str] = ""

@app.post("/users")
async def create_user(body: UserCreate):
    """Create a new user."""
    user = db_service.db_service.create_user(
        name=body.name,
        age=body.age,
        about_you=body.about_you or "",
    )
    return {"id": user.id, "name": user.name}

@app.put("/users/{user_id}")
async def update_user(user_id: str, body: Dict[str, Any]):
    """Update a user."""
    user = db_service.db_service.update_user(user_id, **body)
    if not user:
        return {"error": "User not found"}, 404
    return {"id": user.id, "name": user.name}

# --- Personalities CRUD ---

@app.get("/personalities")
async def get_personalities(include_hidden: bool = False):
    """Get all personalities."""
    personalities = db_service.db_service.get_personalities(include_hidden=include_hidden)
    return [
        {
            "id": p.id,
            "name": p.name,
            "prompt": p.prompt,
            "short_description": p.short_description,
            "tags": p.tags,
            "is_visible": p.is_visible,
            "is_global": p.is_global,
            "voice_id": p.voice_id,
            "img_src": getattr(p, "img_src", None),
            "created_at": getattr(p, "created_at", None),
        }
        for p in personalities
    ]

class PersonalityCreate(BaseModel):
    name: str
    prompt: str
    short_description: Optional[str] = ""
    tags: list = []
    voice_id: str = "radio"
    is_global: bool = False
    img_src: Optional[str] = None

@app.post("/personalities")
async def create_personality(body: PersonalityCreate):
    """Create a new personality."""
    p = db_service.db_service.create_personality(
        name=body.name,
        prompt=body.prompt,
        short_description=body.short_description or "",
        tags=body.tags,
        voice_id=body.voice_id,
        is_global=False,
        img_src=body.img_src,
    )
    return {"id": p.id, "name": p.name}

class GeneratePersonalityRequest(BaseModel):
    description: str
    voice_id: Optional[str] = None

@app.post("/personalities/generate")
async def generate_personality(body: GeneratePersonalityRequest):
    """Generate a personality from a description using the LLM."""
    if not pipeline:
         raise HTTPException(status_code=503, detail="AI engine not ready")
    
    description = body.description
    voice_id = body.voice_id or "radio"
    logger.info(f"Generating personality from description: {description}")
    
    # 1. Generate Name
    name_prompt = f"Based on this description: '{description}', suggest a short, creative name for this character. Output ONLY the name, nothing else."
    name = await pipeline.generate_text_simple(name_prompt, max_tokens=30)
    name = name.strip().strip('"').strip("'").split("\n")[0]
    
    # 2. Generate Short Description
    desc_prompt = f"Based on this description: '{description}', provide a very short (1 sentence) description of this character. Output ONLY the description."
    short_desc = await pipeline.generate_text_simple(desc_prompt, max_tokens=100)
    short_desc = short_desc.strip().strip('"').strip("'")
    
    # 3. Generate System Prompt
    sys_prompt = f"Based on this description: '{description}', write a system prompt for an AI to act as this character. The prompt should start with 'You are [Name]...'. Output ONLY the prompt."
    system_prompt = await pipeline.generate_text_simple(sys_prompt, max_tokens=300)
    system_prompt = system_prompt.strip()
    
    tags: list = []
    
    # Create the personality
    p = db_service.db_service.create_personality(
        name=name,
        prompt=system_prompt,
        short_description=short_desc,
        tags=tags,
        voice_id=voice_id,
        is_global=False
    )
    
    return {
        "id": p.id,
        "name": p.name,
        "prompt": p.prompt,
        "short_description": p.short_description,
        "tags": p.tags,
        "voice_id": p.voice_id,
        "img_src": getattr(p, "img_src", None),
    }

@app.put("/personalities/{personality_id}")
async def update_personality(personality_id: str, body: Dict[str, Any]):
    """Update a personality."""
    p = db_service.db_service.update_personality(personality_id, **body)
    if not p:
        return {"error": "Personality not found"}, 404
    return {"id": p.id, "name": p.name}


@app.delete("/personalities/{personality_id}")
async def delete_personality(personality_id: str):
    ok = db_service.db_service.delete_personality(personality_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Personality not found or cannot delete global personality")
    return {"ok": True}

# --- Conversations ---

@app.get("/conversations")
async def get_conversations(limit: int = 50, offset: int = 0, session_id: Optional[str] = None):
    """Get conversations."""
    convos = db_service.db_service.get_conversations(limit=limit, offset=offset, session_id=session_id)
    return [
        {
            "id": c.id,
            "role": c.role,
            "transcript": c.transcript,
            "timestamp": c.timestamp,
            "session_id": c.session_id,
        }
        for c in convos
    ]

# --- Sessions ---

@app.get("/sessions")
async def get_sessions(limit: int = 50, offset: int = 0, user_id: Optional[str] = None):
    """Get sessions."""
    sessions = db_service.db_service.get_sessions(limit=limit, offset=offset, user_id=user_id)
    return [
        {
            "id": s.id,
            "started_at": s.started_at,
            "ended_at": s.ended_at,
            "duration_sec": s.duration_sec,
            "client_type": s.client_type,
            "user_id": s.user_id,
            "personality_id": s.personality_id,
        }
        for s in sessions
    ]

# --- Shutdown ---

@app.post("/shutdown")
async def shutdown():
    """Shutdown the server."""
    import signal
    os.kill(os.getpid(), signal.SIGTERM)
    return {"status": "shutting down"}


@app.websocket("/ws")
async def websocket_unified(websocket: WebSocket, client_type: str = Query(default=CLIENT_TYPE_DESKTOP)):
    """
    Unified WebSocket endpoint for voice communication.
    
    Supports two client types differentiated by query param or header:
    - desktop (default): React UI client - uses base64 JSON audio
    - esp32: ESP32 device - uses raw PCM binary + Opus output
    
    Query param: ?client_type=esp32 or ?client_type=desktop
    Header: X-Client-Type: esp32 or X-Client-Type: desktop
    
    Desktop Protocol:
    - Client sends: {"type": "audio", "data": "<base64 int16 PCM>"}
    - Client sends: {"type": "end_of_speech"}
    - Server sends: {"type": "transcription", "text": "..."}
    - Server sends: {"type": "response", "text": "..."}
    - Server sends: {"type": "audio", "data": "<base64 int16 PCM>"}
    - Server sends: {"type": "audio_end"}
    
    ESP32 Protocol:
    - Client sends: raw PCM16 bytes at 16kHz
    - Client sends: {"type": "instruction", "msg": "end_of_speech"}
    - Server sends: {"type": "server", "msg": "RESPONSE.CREATED"/"RESPONSE.COMPLETE"/"AUDIO.COMMITTED"}
    - Server sends: Opus-encoded audio bytes at 24kHz
    """
    # Check header for client type override
    header_client = websocket.headers.get("x-client-type", "").lower()
    if header_client in (CLIENT_TYPE_ESP32, CLIENT_TYPE_DESKTOP):
        client_type = header_client
    
    is_esp32 = client_type == CLIENT_TYPE_ESP32
    client_label = "[ESP32]" if is_esp32 else "[Desktop]"
    
    if is_esp32:
        await websocket.accept()
    else:
        await manager.connect(websocket)

    if not pipeline:
        await websocket.close()
        return

    session_id = str(uuid.uuid4())
    
    # Get active user/personality
    user_id = db_service.db_service.get_active_user_id()
    personality_id = None
    if user_id:
        u = db_service.db_service.get_user(user_id)
        personality_id = u.current_personality_id if u else None
    
    personality = None
    if personality_id:
        try:
            personality = db_service.db_service.get_personality(personality_id)
        except Exception:
            personality = None

    # Start session
    try:
        db_service.db_service.start_session(
            session_id=session_id,
            client_type="device" if is_esp32 else "desktop",
            user_id=user_id,
            personality_id=personality_id,
        )
    except Exception as e:
        logger.error(f"Failed to start session: {e}")

    # Helper to build LLM context with conversation history
    def _build_llm_context(user_text: str) -> List[Dict[str, str]]:
        try:
            convos = db_service.db_service.get_conversations(session_id=session_id)
        except Exception:
            convos = []

        runtime = build_runtime_context()
        user_ctx = None
        try:
            u = db_service.db_service.get_user(user_id) if user_id else None
            if u:
                user_ctx = {
                    "name": u.name,
                    "age": u.age,
                    "about_you": getattr(u, "about_you", "") or "",
                    "user_type": u.user_type,
                }
        except Exception:
            user_ctx = None

        tts_backend = (getattr(pipeline, "tts_backend", None) or db_service.db_service.get_setting("tts_backend") or "pocket")
        tts_backend = (tts_backend or "").strip().lower() or "pocket"

        behavior_constraints = (
            "You always respond with short sentences. "
            "Avoid punctuation like parentheses or colons or markdown that would not appear in conversational speech. Do not use Markdown formatting (no *, **, _, __, backticks). "
        )

        if tts_backend != "pocket":
            behavior_constraints += (
                "To add expressivity, you should occasionally use ONLY these paralinguistic cues in brackets: "
                "[laugh], [chuckle], [sigh], [gasp], [cough], [clear throat], [sniff], [groan], [shush]. "
                "Use only these cues naturally in context to enhance the conversational flow. "
                "Examples: [chuckle] That is funny. [sigh] That was a long day."
            )

        sys_prompt = build_system_prompt(
            personality_name=getattr(personality, "name", None),
            personality_prompt=getattr(personality, "prompt", None),
            user_context=user_ctx,
            runtime=runtime,
            extra_system_prompt=behavior_constraints,
        )

        history_msgs: List[Dict[str, str]] = []
        for c in convos:
            if c.role == "user":
                history_msgs.append({"role": "user", "content": c.transcript})
            elif c.role == "ai":
                history_msgs.append({"role": "assistant", "content": c.transcript})

        return build_llm_messages(
            system_prompt=sys_prompt,
            history=history_msgs,
            user_text=user_text,
            max_history_messages=30,
        )

    # Get volume setting
    volume = 100
    try:
        raw = db_service.db_service.get_setting("laptop_volume")
        if raw is not None:
            volume = int(raw)
    except Exception:
        pass
    
    # Send auth/session message
    if is_esp32:
        try:
            await websocket.send_json({
                "type": "auth",
                "volume_control": volume,
                "pitch_factor": 1.0,
                "is_ota": False,
                "is_reset": False
            })
        except Exception:
            return
    else:
        try:
            await websocket.send_text(json.dumps({"type": "session_started", "session_id": session_id}))
        except Exception:
            pass
    
    logger.info(f"{client_label} Client connected, session={session_id}")
    
    # Generate and send initial greeting (speak first, then listen)
    cancel_event = asyncio.Event()
    try:
        greeting_user_text = "[System] The user just connected. Greet them with a short friendly sentence (under 8 words)."
        greeting_messages = _build_llm_context(greeting_user_text)
        greeting_text = await pipeline.generate_response(
            greeting_user_text, messages=greeting_messages, max_tokens=50
        )
        greeting_text = greeting_text.strip() or "Hello!"

        allow_paralinguistic = (getattr(pipeline, "tts_backend", None) or "pocket") != "pocket"
        greeting_text = _sanitize_spoken_text(greeting_text, allow_paralinguistic=allow_paralinguistic)
        
        logger.info(f"{client_label} Greeting: {greeting_text}")
        
        ref_audio_path = _resolve_voice_ref_audio_path(getattr(personality, "voice_id", None))
        
        if is_esp32:
            # ESP32: Send RESPONSE.CREATED, then Opus audio, then RESPONSE.COMPLETE
            try:
                await websocket.send_json({"type": "server", "msg": "RESPONSE.CREATED", "volume_control": volume})
            except Exception:
                pass

            opus_packets = []
            opus = create_opus_packetizer(lambda pkt: opus_packets.append(pkt))
            
            async for audio_chunk in pipeline.synthesize_speech(greeting_text, ref_audio_path=ref_audio_path):
                chunk_mutable = bytearray(audio_chunk)
                utils.boost_limit_pcm16le_in_place(chunk_mutable, gain_db=GAIN_DB, ceiling=CEILING)
                opus.push(chunk_mutable)
                while opus_packets:
                    try:
                        await websocket.send_bytes(opus_packets.pop(0))
                    except Exception:
                        break
            
            opus.flush(pad_final_frame=True)
            while opus_packets:
                try:
                    await websocket.send_bytes(opus_packets.pop(0))
                except Exception:
                    break
            opus.close()

            try:
                await websocket.send_json({"type": "server", "msg": "RESPONSE.COMPLETE"})
            except Exception:
                pass
        else:
            # Desktop: Send response text, then base64 audio, then audio_end
            try:
                await websocket.send_text(json.dumps({"type": "response", "text": greeting_text}))
            except Exception:
                pass
            
            async for audio_chunk in pipeline.synthesize_speech(greeting_text, ref_audio_path=ref_audio_path):
                try:
                    await websocket.send_text(
                        json.dumps({
                            "type": "audio",
                            "data": base64.b64encode(audio_chunk).decode("utf-8"),
                        })
                    )
                except Exception:
                    break
            
            try:
                await websocket.send_text(json.dumps({"type": "audio_end"}))
            except Exception:
                pass

        # Log a synthetic user message so history alternates properly (user -> assistant)
        try:
            db_service.db_service.log_conversation(role="user", transcript="[connected]", session_id=session_id)
        except Exception:
            pass
        try:
            db_service.db_service.log_conversation(role="ai", transcript=greeting_text, session_id=session_id)
        except Exception:
            pass
    except Exception as e:
        logger.error(f"{client_label} Greeting generation failed: {e}")

    # Common state
    audio_buffer = bytearray()
    cancel_event = asyncio.Event()
    current_tts_task = None
    ws_open = True
    session_system_prompt = None
    session_voice = "dave"

    # VAD setup for ESP32
    if is_esp32:
        vad = webrtcvad.Vad(3)
        input_sample_rate = 16000
        vad_frame_ms = 30
        vad_frame_bytes = int(input_sample_rate * vad_frame_ms / 1000) * 2
        speech_frames = []
        is_speaking = False
        silence_count = 0
        SILENCE_FRAMES = int(1.5 / (vad_frame_ms / 1000))  # 1.5s of silence
    
    # Desktop prebuffer settings
    PREBUFFER_MS = 300
    PREBUFFER_BYTES = int(pipeline.output_sample_rate * (PREBUFFER_MS / 1000.0) * 2)

    async def process_transcription_and_respond(transcription: str, for_esp32: bool):
        """Common logic for processing transcription and generating response."""
        nonlocal cancel_event, personality, ws_open, volume
        
        if not transcription or not transcription.strip():
            return
        
        logger.info(f"{client_label} Transcript: {transcription}")
        
        # Send transcription acknowledgment
        if for_esp32:
            try:
                await websocket.send_json({"type": "server", "msg": "AUDIO.COMMITTED"})
            except Exception as e:
                logger.error(f"{client_label} Failed to send AUDIO.COMMITTED: {e}")
                return
        else:
            try:
                await websocket.send_text(json.dumps({"type": "transcription", "text": transcription}))
            except Exception as e:
                logger.error(f"{client_label} Failed to send transcription: {e}")
                return

        # Build LLM context BEFORE logging the user message to avoid duplicate
        cancel_event.clear()
        llm_messages = _build_llm_context(transcription)
        
        # Now log the user conversation
        try:
            db_service.db_service.log_conversation(
                role="user", transcript=transcription, session_id=session_id
            )
        except Exception as e:
            logger.error(f"Failed to log user conversation: {e}")
        
        # Generate LLM response
        logger.info(f"{client_label} Generating LLM response...")
        try:
            full_response = await pipeline.generate_response(
                transcription, messages=llm_messages
            )
        except Exception as e:
            logger.error(f"{client_label} LLM generation error: {e}")
            return

        raw_response = full_response
        allow_paralinguistic = (getattr(pipeline, "tts_backend", None) or "pocket") != "pocket"
        full_response = _sanitize_spoken_text(full_response, allow_paralinguistic=allow_paralinguistic)
        if raw_response != full_response:
            logger.info(
                f"{client_label} Sanitized LLM response (raw_len={len(raw_response)}, sanitized_len={len(full_response)})"
            )
        
        if cancel_event.is_set():
            logger.warning(f"{client_label} Cancelled before LLM response")
            return
        if not ws_open:
            logger.warning(f"{client_label} WebSocket closed before LLM response")
            return
        if not full_response or not full_response.strip():
            logger.warning(f"{client_label} Empty LLM response")
            return
        
        logger.info(f"{client_label} LLM response: {full_response}")
        
        # Send response notification
        if for_esp32:
            try:
                await websocket.send_json({
                    "type": "server",
                    "msg": "RESPONSE.CREATED",
                    "volume_control": volume
                })
            except Exception:
                return
        else:
            try:
                await websocket.send_text(json.dumps({"type": "response", "text": full_response}))
            except Exception:
                return
        
        # Log AI response
        try:
            db_service.db_service.log_conversation(
                role="ai", transcript=full_response, session_id=session_id
            )
        except Exception as e:
            logger.error(f"Failed to log AI conversation: {e}")

        # Stream TTS audio
        ref_audio_path = _resolve_voice_ref_audio_path(getattr(personality, "voice_id", None))
        
        if for_esp32:
            # ESP32: Encode to Opus and send binary
            opus_packets = []
            opus = create_opus_packetizer(lambda pkt: opus_packets.append(pkt))
            
            async for audio_chunk in pipeline.synthesize_speech(
                full_response,
                cancel_event,
                ref_audio_path=ref_audio_path,
            ):
                if cancel_event.is_set() or not ws_open:
                    break
                
                # Boost and limit audio (in-place)
                # Ensure we have a mutable bytearray
                chunk_mutable = bytearray(audio_chunk)
                utils.boost_limit_pcm16le_in_place(chunk_mutable, gain_db=GAIN_DB, ceiling=CEILING)
                
                opus.push(chunk_mutable)
                while opus_packets:
                    try:
                        await websocket.send_bytes(opus_packets.pop(0))
                    except Exception:
                        cancel_event.set()
                        break
            
            opus.flush(pad_final_frame=True)
            while opus_packets:
                try:
                    await websocket.send_bytes(opus_packets.pop(0))
                except Exception:
                    break
            opus.close()
            
            try:
                await websocket.send_json({"type": "server", "msg": "RESPONSE.COMPLETE"})
            except Exception:
                pass
        else:
            # Desktop: Send base64-encoded audio with prebuffering
            buffered = bytearray()
            started = False

            async for audio_chunk in pipeline.synthesize_speech(
                full_response,
                cancel_event,
                ref_audio_path=ref_audio_path,
            ):
                if cancel_event.is_set() or not ws_open:
                    break

                if not started:
                    buffered.extend(audio_chunk)
                    if len(buffered) < PREBUFFER_BYTES:
                        continue

                    try:
                        await websocket.send_text(
                            json.dumps({
                                "type": "audio",
                                "data": base64.b64encode(bytes(buffered)).decode("utf-8"),
                            })
                        )
                    except Exception:
                        break
                    buffered.clear()
                    started = True
                else:
                    try:
                        await websocket.send_text(
                            json.dumps({
                                "type": "audio",
                                "data": base64.b64encode(audio_chunk).decode("utf-8"),
                            })
                        )
                    except Exception:
                        break

            # Flush remaining buffered audio
            if buffered:
                try:
                    await websocket.send_text(
                        json.dumps({
                            "type": "audio",
                            "data": base64.b64encode(bytes(buffered)).decode("utf-8"),
                        })
                    )
                except Exception:
                    pass

            try:
                await websocket.send_text(json.dumps({"type": "audio_end"}))
            except Exception:
                pass

    try:
        while True:
            try:
                message = await websocket.receive()
            except Exception:
                break
            
            if message.get("type") == "websocket.disconnect":
                break
            
            if is_esp32:
                # ESP32: Handle binary audio with VAD
                if "bytes" in message:
                    audio_buffer.extend(message["bytes"])
                    
                    # VAD processing
                    while len(audio_buffer) >= vad_frame_bytes:
                        frame = bytes(audio_buffer[:vad_frame_bytes])
                        audio_buffer = audio_buffer[vad_frame_bytes:]
                        
                        is_speech = vad.is_speech(frame, input_sample_rate)
                        
                        if is_speech:
                            if not is_speaking:
                                is_speaking = True
                                logger.info(f"{client_label} Speech started")
                            speech_frames.append(frame)
                            silence_count = 0
                        elif is_speaking:
                            speech_frames.append(frame)
                            silence_count += 1
                            
                            if silence_count > SILENCE_FRAMES:
                                is_speaking = False
                                logger.info(f"{client_label} Speech ended, processing...")
                                
                                # Combine and transcribe
                                full_audio = b"".join(speech_frames)
                                speech_frames = []
                                silence_count = 0
                                
                                transcription = await pipeline.transcribe(full_audio)
                                await process_transcription_and_respond(transcription, for_esp32=True)
                
                # ESP32: Handle JSON messages (manual end_of_speech, interrupts)
                elif "text" in message:
                    try:
                        data = json.loads(message["text"])
                        msg_type = data.get("type")
                        
                        if msg_type == "instruction":
                            msg = data.get("msg")
                            if msg == "end_of_speech" and speech_frames:
                                # Manual end of speech trigger
                                is_speaking = False
                                full_audio = b"".join(speech_frames)
                                speech_frames = []
                                silence_count = 0
                                transcription = await pipeline.transcribe(full_audio)
                                await process_transcription_and_respond(transcription, for_esp32=True)
                            elif msg == "INTERRUPT":
                                # Cancel current TTS
                                cancel_event.set()
                                speech_frames = []
                                audio_buffer.clear()
                        
                        if "system_prompt" in data:
                            session_system_prompt = data["system_prompt"]
                    except Exception:
                        pass
            else:
                # Desktop: Handle JSON messages
                if "text" in message:
                    try:
                        data = json.loads(message["text"])
                        msg_type = data.get("type")
                        
                        if msg_type == "config":
                            session_voice = data.get("voice", "dave")
                            session_system_prompt = data.get("system_prompt")
                            logger.info(f"Config updated: voice={session_voice}, prompt_len={len(session_system_prompt) if session_system_prompt else 0}")
                        
                        elif msg_type == "audio":
                            audio_data = base64.b64decode(data["data"])
                            audio_buffer.extend(audio_data)

                            # If user is speaking while we're TTS-ing, cancel current TTS
                            if current_tts_task and not current_tts_task.done():
                                cancel_event.set()
                                try:
                                    await current_tts_task
                                except asyncio.CancelledError:
                                    pass
                                cancel_event.clear()
                                current_tts_task = None
                        
                        elif msg_type == "end_of_speech":
                            if audio_buffer:
                                logger.info("Processing audio...")
                                transcription = await pipeline.transcribe(bytes(audio_buffer))
                                audio_buffer.clear()
                                
                                if transcription and transcription.strip():
                                    async def _run_response(text: str):
                                        try:
                                            await process_transcription_and_respond(text, for_esp32=False)
                                        except Exception as e:
                                            logger.error(f"{client_label} Response task error: {e}")
                                            import traceback
                                            traceback.print_exc()
                                    
                                    current_tts_task = asyncio.create_task(_run_response(transcription))
                        
                        elif msg_type == "cancel":
                            if current_tts_task and not current_tts_task.done():
                                cancel_event.set()
                            audio_buffer.clear()
                    except Exception as e:
                        logger.error(f"Error parsing message: {e}")
                        
    except WebSocketDisconnect:
        logger.info(f"{client_label} Disconnected")
    except Exception as e:
        logger.error(f"{client_label} WebSocket error: {e}")
    finally:
        ws_open = False
        if current_tts_task and not current_tts_task.done():
            cancel_event.set()
            current_tts_task.cancel()
        if not is_esp32:
            manager.disconnect(websocket)
        try:
            db_service.db_service.end_session(session_id)
        except Exception:
            pass
        logger.info(f"{client_label} Session ended: {session_id}")


# Backward compatibility: Keep /ws/esp32 as alias
@app.websocket("/ws/esp32")
async def websocket_esp32_compat(websocket: WebSocket):
    """Backward compatibility endpoint for ESP32. Redirects to unified /ws with esp32 client type."""
    # Call the unified endpoint with ESP32 client type
    await websocket_unified(websocket, client_type=CLIENT_TYPE_ESP32)


def main():
    if len(sys.argv) >= 6 and sys.argv[1:5] == ["-B", "-S", "-I", "-c"]:
        code = sys.argv[5]
        if isinstance(code, str) and code.startswith("from multiprocessing."):
            exec(code, {"__name__": "__main__"})
            return

    parser = argparse.ArgumentParser(description="Voice Pipeline WebSocket Server")
    parser.add_argument(
        "--stt_model",
        type=str,
        default=STT,
        help="STT model",
    )
    parser.add_argument(
        "--llm_model",
        type=str,
        default=LLM,
        help="LLM model",
    )
    # default_ref_audio = os.path.join(os.path.dirname(__file__), "tts", "santa.wav")
    # parser.add_argument(
    #     "--tts_ref_audio",
    #     type=str,
    #     default=default_ref_audio,
    #     help="Reference audio WAV path for voice cloning",
    # )
    parser.add_argument(
        "--silence_duration", type=float, default=1.5, help="Silence duration"
    )
    parser.add_argument(
        "--silence_threshold", type=float, default=0.03, help="Silence threshold"
    )
    parser.add_argument(
        "--streaming_interval", type=int, default=3, help="Streaming interval"
    )
    parser.add_argument(
        "--output_sample_rate",
        type=int,
        default=24_000,
        help="Output sample rate for TTS audio",
    )
    parser.add_argument("--host", type=str, default="0.0.0.0", help="Host to bind to")
    parser.add_argument("--port", type=int, default=8000, help="Port to bind to")
    args = parser.parse_args()

    app.state.stt_model = args.stt_model
    app.state.llm_model = args.llm_model
    # app.state.tts_ref_audio = args.tts_ref_audio
    app.state.silence_threshold = args.silence_threshold
    app.state.silence_duration = args.silence_duration
    app.state.streaming_interval = args.streaming_interval
    app.state.output_sample_rate = args.output_sample_rate
    app.state.server_port = args.port

    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
