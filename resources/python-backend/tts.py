import numpy as np
from typing import Generator, Optional


from mlx_audio.tts.utils import load_model as load_tts

class ChatterboxTTS:
    """Chatterbox Turbo TTS backend with voice cloning support."""

    # Chunk size in samples (120ms at 24kHz = 2880 samples)
    # This MUST match the Opus frame size (OPUS_FRAME_SAMPLES in utils.py)
    CHUNK_SAMPLES = 2880

    def __init__(
        self,
        model_id: str = "mlx-community/chatterbox-turbo-fp16",
        ref_audio_path: Optional[str] = None,
        output_sample_rate: int = 24_000,
        temperature: float = 0.8,
        top_k: int = 1000,
        top_p: float = 0.95,
        repetition_penalty: float = 1.2,
        stream: bool = False,
        streaming_interval: float = 1.5,
    ):
        self.model_id = model_id
        self.ref_audio_path = ref_audio_path
        self.output_sample_rate = output_sample_rate
        self.temperature = temperature
        self.top_k = top_k
        self.top_p = top_p
        self.repetition_penalty = repetition_penalty
        self.stream = stream
        self.streaming_interval = streaming_interval
        self.model = None

    def load(self) -> None:
        """Load the Chatterbox model and prepare conditionals if ref audio provided."""
        self.model = load_tts(self.model_id)

        if self.ref_audio_path:
            self.model.prepare_conditionals(self.ref_audio_path)

    def prepare_ref_audio(self, ref_audio_path: Optional[str]) -> None:
        if not self.model:
            raise RuntimeError("TTS model not loaded")
        if ref_audio_path:
            self.model.prepare_conditionals(ref_audio_path)
            self.ref_audio_path = ref_audio_path
        else:
            self.ref_audio_path = None

    def generate(self, text: str, ref_audio_path: Optional[str] = None) -> Generator[bytes, None, None]:
        """Generate audio chunks for the given text."""
        if ref_audio_path is not None and ref_audio_path != self.ref_audio_path:
            self.prepare_ref_audio(ref_audio_path)
        for chunk in self.model.generate(
            text,
            ref_audio=None,  # Already prepared via prepare_conditionals
            temperature=self.temperature,
            top_k=self.top_k,
            top_p=self.top_p,
            repetition_penalty=self.repetition_penalty,
            stream=self.stream,
            streaming_interval=self.streaming_interval,
        ):
            audio_np = np.asarray(chunk.audio, dtype=np.float32)
            audio_np = np.clip(audio_np, -1.0, 1.0)
            audio_int16 = (audio_np * 32767.0).astype(np.int16)
            
            # Chunk the audio to avoid WebSocket message size limits
            for i in range(0, len(audio_int16), self.CHUNK_SAMPLES):
                audio_chunk = audio_int16[i:i + self.CHUNK_SAMPLES]
                yield audio_chunk.tobytes()

    def warmup(self) -> None:
        """Warm up the TTS model."""
        for _ in self.generate("Hello."):
            pass

    @property
    def sample_rate(self) -> int:
        return self.output_sample_rate


class Qwen3TTS:
    CHUNK_SAMPLES = 2880

    def __init__(
        self,
        model_id: str = "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16",
        ref_audio_path: Optional[str] = None,
        output_sample_rate: int = 24_000,
        temperature: float = 0.9,
        top_k: int = 50,
        top_p: float = 1.0,
        repetition_penalty: float = 1.05,
        stream: bool = False,
        streaming_interval: float = 2.0,
    ):
        self.model_id = model_id
        self.ref_audio_path = ref_audio_path
        self.output_sample_rate = output_sample_rate
        self.temperature = temperature
        self.top_k = top_k
        self.top_p = top_p
        self.repetition_penalty = repetition_penalty
        self.stream = stream
        self.streaming_interval = streaming_interval

        self.model = None
        self.ref_audio = None

    @staticmethod
    def _read_wav_mono_float32(path: str) -> tuple[np.ndarray, int]:
        with wave.open(path, "rb") as wf:
            channels = int(wf.getnchannels())
            sample_width = int(wf.getsampwidth())
            sample_rate = int(wf.getframerate())
            frames = int(wf.getnframes())
            raw = wf.readframes(frames)

        if sample_width != 2:
            raise ValueError("Only 16-bit PCM WAV reference audio is supported")

        audio = np.frombuffer(raw, dtype=np.int16)
        if channels == 2:
            audio = audio.reshape(-1, 2).mean(axis=1).astype(np.int16)
        elif channels != 1:
            raise ValueError("Only mono/stereo WAV reference audio is supported")

        audio_f32 = audio.astype(np.float32) / 32768.0
        return audio_f32, sample_rate

    def load(self) -> None:
        self.model = load_tts(self.model_id)
        self.output_sample_rate = int(getattr(self.model, "sample_rate", self.output_sample_rate))

        if self.ref_audio_path:
            self.prepare_ref_audio(self.ref_audio_path)

    def prepare_ref_audio(self, ref_audio_path: Optional[str]) -> None:
        if not self.model:
            raise RuntimeError("TTS model not loaded")

        if ref_audio_path:
            audio_f32, sr = self._read_wav_mono_float32(ref_audio_path)
            if sr != 24_000:
                raise ValueError("Qwen3-TTS reference audio must be 24kHz")
            self.ref_audio = mx.array(audio_f32)
            self.ref_audio_path = ref_audio_path
        else:
            self.ref_audio = None
            self.ref_audio_path = None

    def generate(self, text: str, ref_audio_path: Optional[str] = None) -> Generator[bytes, None, None]:
        if not self.model:
            raise RuntimeError("TTS model not loaded")

        if ref_audio_path is not None and ref_audio_path != self.ref_audio_path:
            self.prepare_ref_audio(ref_audio_path)

        for result in self.model.generate(
            text,
            temperature=self.temperature,
            top_k=self.top_k,
            top_p=self.top_p,
            repetition_penalty=self.repetition_penalty,
            stream=self.stream,
            streaming_interval=self.streaming_interval,
            ref_audio=self.ref_audio,
        ):
            audio = getattr(result, "audio", result)
            if hasattr(audio, "tolist") and not isinstance(audio, np.ndarray):
                audio_np = np.asarray(audio, dtype=np.float32)
            else:
                audio_np = np.asarray(audio, dtype=np.float32)

            audio_np = np.clip(audio_np, -1.0, 1.0)
            audio_int16 = (audio_np * 32767.0).astype(np.int16)

            for i in range(0, len(audio_int16), self.CHUNK_SAMPLES):
                audio_chunk = audio_int16[i : i + self.CHUNK_SAMPLES]
                yield audio_chunk.tobytes()

    def warmup(self) -> None:
        for _ in self.generate("Hello."):
            pass

    @property
    def sample_rate(self) -> int:
        return self.output_sample_rate


