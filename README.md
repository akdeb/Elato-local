# NeuTTS OpenAI API

A FastAPI-based text-to-speech service using NeuTTS Air with **full OpenAI TTS streaming API compatibility**.

## 🎯 OpenAI TTS Streaming API Compatible

This service is fully compatible with the OpenAI TTS streaming API. Set up as shown below, then use with:

- **Pipecat** - Replace base URL with `localhost:8000/v1/`
- **LiveKit** - Replace base URL with `localhost:8000/v1/`
- **OpenWebUI** - Replace base URL with `localhost:8000/v1/`

## Features

- ✅ **OpenAI API compatible endpoints** - Drop-in replacement for OpenAI TTS
- ✅ **Streaming audio generation** - Real-time audio streaming
- ✅ **Multiple audio formats** - MP3, WAV, PCM, Opus, AAC, FLAC
- ✅ **GPU-accelerated inference** - CUDA 12.8 support
- ✅ **Multiple voice support** - Dave, Jo voices
- ✅ **Low-latency generation** - ~350ms median latency

## Quick Start

### Option 1: Manual Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/Edward-Zion-Saji/neutts-openai-api.git
   cd neutts-openai-api
   ```

2. **Create and activate virtual environment**
   ```bash
   python -m venv venv
   source venv/bin/activate
   ```

3. **Install dependencies**
   ```bash
   pip install -r requirements.txt
   ```

4. **Run the application**
   ```bash
   python openai.py
   ```

The API will be available at `http://localhost:8000`

### Option 2: Docker with GPU Support

1. **Clone the repository**
   ```bash
   git clone https://github.com/Edward-Zion-Saji/neutts-openai-api.git
   cd neutts-openai-api
   ```

2. **Build the Docker image**
   ```bash
   docker build -t neutts-openai-api .
   ```

3. **Run with GPU support**

   **Option A: Docker run**
   ```bash
   docker run --gpus all -p 8000:8000 neutts-openai-api
   ```

   **Option B: Docker Compose (recommended)**
   ```bash
   docker-compose up --build
   ```

## API Endpoints

### OpenAI Compatible Endpoint
```bash
POST /v1/audio/speech
```

**Request:**
```json
{
  "input": "Hello, this is a test",
  "voice": "coral",
  "response_format": "mp3"
}
```

### Custom Endpoints

- `POST /synthesize` - Basic TTS synthesis
- `POST /synthesize-with-timing` - TTS with timing information
- `GET /health` - Health check
- `GET /` - Web interface

## Supported Formats

- **MP3** - `audio/mpeg`
- **WAV** - `audio/wav`
- **PCM** - `audio/pcm`
- **Opus** - `audio/opus`
- **AAC** - `audio/aac`
- **FLAC** - `audio/flac`

## Voice Options

- `coral` - Maps to Dave voice
- `dave` - Dave voice

## Requirements

- Python 3.10+
- CUDA-compatible GPU (for GPU acceleration)
- Linux (recommended for Docker)

## Docker Requirements

- Docker with GPU support
- NVIDIA Container Toolkit
- CUDA drivers

### Docker Setup (Linux)

1. **Install NVIDIA Container Toolkit**
   ```bash
   distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
   curl -s -L https://nvidia.github.io/nvidia-docker/gpgkey | sudo apt-key add -
   curl -s -L https://nvidia.github.io/nvidia-docker/$distribution/nvidia-docker.list | sudo tee /etc/apt/sources.list.d/nvidia-docker.list
   
   sudo apt-get update && sudo apt-get install -y nvidia-docker2
   sudo systemctl restart docker
   ```

2. **Verify GPU support**
   ```bash
   docker run --rm --gpus all nvidia/cuda:12.8-base-ubuntu22.04 nvidia-smi
   ```

## Integration Examples

### Pipecat Integration
```python
from pipecat.pipeline.pipeline import Pipeline
from pipecat.services.openai import OpenAILLMService
from pipecat.services.elevenlabs import ElevenLabsTTSService

# Replace OpenAI TTS with NeuTTS
pipeline = Pipeline([
    OpenAILLMService(api_key="your-key", model="gpt-4"),
    ElevenLabsTTSService(api_key="your-key", voice_id="your-voice")
])

# Change to use local NeuTTS service
pipeline = Pipeline([
    OpenAILLMService(api_key="your-key", model="gpt-4"),
    ElevenLabsTTSService(api_key="dummy", voice_id="coral", base_url="http://localhost:8000/v1/")
])
```

### LiveKit Integration
```python
from livekit.agents import JobContext, WorkerOptions, cli
from livekit.agents.voice_assistant import VoiceAssistant
from livekit.plugins import openai

# Configure OpenAI TTS to use local NeuTTS
openai.TTS_BASE_URL = "http://localhost:8000/v1/"
```

### OpenWebUI Integration
```yaml
# In your OpenWebUI configuration
openai:
  base_url: "http://localhost:8000/v1/"
  api_key: "dummy"  # Not used by NeuTTS
```

## Documentation

Documentation available at `/docs` when the service is running.
