import asyncio

import mlx.core as mx
import numpy as np
from mlx_lm import generate as mx_generate
from mlx_lm.utils import load as load_llm
from mlx_audio.stt.models.whisper import Model as Whisper

from tts import ChatterboxTTS
from utils import STT, LLM, TTS


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
        tts_backend: str = "chatterbox",
    ):
        self.silence_threshold = silence_threshold
        self.silence_duration = silence_duration
        self.input_sample_rate = input_sample_rate
        self.output_sample_rate = output_sample_rate
        self.streaming_interval = streaming_interval
        self.frame_duration_ms = frame_duration_ms

        self.stt_model_id = stt_model
        self.llm_model = llm_model
        self.tts_ref_audio = tts_ref_audio
        self.tts_backend = tts_backend

        self.mlx_lock = asyncio.Lock()

    async def init_models(self):
        self.llm, self.tokenizer = await asyncio.to_thread(
            lambda: load_llm(self.llm_model)
        )
        self.stt = Whisper.from_pretrained(self.stt_model_id)
        await self._init_tts()

    async def _init_tts(self):
        backend = (self.tts_backend or "").strip().lower() or "chatterbox"
        if backend != "chatterbox":
            backend = "chatterbox"

        self.tts = ChatterboxTTS(
            model_id=TTS,
            output_sample_rate=self.output_sample_rate,
            stream=True,
            streaming_interval=self.streaming_interval,
        )

        await asyncio.to_thread(self.tts.load)

    async def set_tts_backend(self, backend: str) -> str:
        backend = (backend or "").strip().lower()
        if backend != "chatterbox":
            raise ValueError("tts_backend must be 'chatterbox'")

        async with self.mlx_lock:
            self.tts_backend = backend
            await self._init_tts()
        return backend

    def _apply_chat_template(self, messages, add_generation_prompt: bool, clear_thinking: bool | None):
        try:
            if clear_thinking is None:
                return self.tokenizer.apply_chat_template(
                    messages, tokenize=False, add_generation_prompt=add_generation_prompt
                )
            return self.tokenizer.apply_chat_template(
                messages,
                tokenize=False,
                add_generation_prompt=add_generation_prompt,
                clear_thinking=clear_thinking,
            )
        except TypeError:
            return self.tokenizer.apply_chat_template(
                messages, tokenize=False, add_generation_prompt=add_generation_prompt
            )

    async def generate_text_simple(
        self,
        prompt: str,
        max_tokens=100,
        clear_thinking: bool | None = None,
    ) -> str:
        if not self.llm or not self.tokenizer:
            raise RuntimeError("LLM not initialized")

        messages = [{"role": "user", "content": prompt}]
        formatted_prompt = self._apply_chat_template(
            messages, add_generation_prompt=True, clear_thinking=clear_thinking
        )

        async with self.mlx_lock:
            response = await asyncio.to_thread(
                lambda: mx_generate(
                    self.llm,
                    self.tokenizer,
                    prompt=formatted_prompt,
                    max_tokens=max_tokens,
                    verbose=False,
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
        messages=None,
        max_tokens: int = 512,
        clear_thinking: bool | None = None,
    ) -> str:
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

        prompt = self._apply_chat_template(
            messages, add_generation_prompt=True, clear_thinking=clear_thinking
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
        ref_audio_path: str | None = None,
    ):
        audio_queue = asyncio.Queue()
        loop = asyncio.get_running_loop()

        def _tts_stream():
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
