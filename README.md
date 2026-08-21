English | [中文](README.zh.md)

<div align="center">

<img src="assets/logo.png" width="100" align="center"/>
<br />

# OpenToys

### Open-source local voice AI for toys, devices, and robots, powered by your Mac

*OpenToys is the local-first platform version of [ElatoAI](https://www.github.com/akdeb/ElatoAI). No cloud required, no subscription lock-in, and your data stays private on-device with inference running locally with a websocket transport to connect to your ESP32-S3.*

**Apple Silicon · Rust + React · ESP32-S3 · Whisper ASR · Qwen3-TTS · MLX LLMs**

[![App](https://img.shields.io/badge/App-Tauri%20%2B%20React-yellow)](#stack)
[![ESP32](https://img.shields.io/badge/Hardware-ESP32--S3-red?logo=espressif&logoColor=white)](#esp32-diy-hardware)
[![License](https://img.shields.io/badge/License-MIT-brightgreen)](LICENSE)
[![Releases](https://img.shields.io/badge/Download-Latest%20DMG-blue)](https://github.com/akdeb/open-toys/releases/latest/download/OpenToys_0.1.0_aarch64.dmg)

</div>

## Featured in
<p>
  <a href="https://www.wired.com/story/the-new-wild-west-of-ai-kids-toys/" target="_blank">
    <img src="assets/wired.png" width="180" align="left"/>
  </a>
  <strong>The New Wild West of AI Kids Toys</strong>
  <br/>
  <a href="https://www.wired.com/story/the-new-wild-west-of-ai-kids-toys/">Read the WIRED article →</a>
</p>
<br clear="left"/>
<p>
  <a href="https://arstechnica.com/ai/2026/05/the-new-wild-west-of-ai-kids-toys/" target="_blank">
    <img src="assets/arstechnica.png" width="180" align="left"/>
  </a>
<strong>AI kids' toys roundup </strong>
  <br/>
  <a href="https://arstechnica.com/ai/2026/05/the-new-wild-west-of-ai-kids-toys/">Read the ArsTechnica article →</a>
</p>
<br clear="left"/>

<p>
  <a href="https://www.hackster.io/news/the-easy-way-to-build-interactive-ai-toys-for-your-kids-0ba401a9328f" target="_blank">
    <img src="assets/hackster.png" width="180" align="left"/>
  </a>
  <strong>The Easy Way to Build Interactive AI Toys for Your Kids</strong>
  <br/>
  <a href="https://www.hackster.io/news/the-easy-way-to-build-interactive-ai-toys-for-your-kids-0ba401a9328f">Read the Hackster article →</a>
</p>
<br clear="left"/>

## 🎥 Demo Video

[![OpenToys Demo](assets/demo.png)](https://youtu.be/V5uNgMRsBHE)

## News
- **2026-03-14:** OpenToys launched🎉 And it's Pi Day! If you're looking to run realtime AI models like OpenAI Realtime, Gemini, Eleven Labs and more on your ESP32 device, check it out [here](https://www.github.com/akdeb/ElatoAI). 

## Why OpenToys?

- **Fully Local**: NO cloud, NO subscriptions, NO data leaving your home, FREE AI forever.
- **Multilingual**: OpenToys supports multiple languages and accents: English 🇺🇸/🇬🇧, Chinese 🇨🇳, Spanish 🇪🇸, French 🇫🇷, Japanese 🇯🇵, Korean 🇰🇷, Portuguese 🇵🇹, German 🇩🇪, Italian 🇮🇹 and more!
- **Voice Cloning**: Clone your own voice or your favorite characters with <10s of audio.
- **Customizable**: Build your own toys, companions, robots and more with an ESP32.
- **Open-source**: The community is open-source and free to use and contribute to.

## App Design
<!-- ![OpenToys Cover](assets/cover.png) -->
![OpenToys Demo](assets/open-toys.gif)

## ESP32 DIY Hardware

![ESP32 DIY Hardware](assets/pcb-design.png)
[Firmware Docs ⏭️](https://www.elatoai.com/docs/blog/firmware)

## Download & Install

- Direct DMG: [OpenToys_0.1.0_aarch64.dmg](https://github.com/akdeb/open-toys/releases/latest/download/OpenToys_0.1.0_aarch64.dmg)
- All releases: [GitHub Releases](https://github.com/akdeb/open-toys/releases)

## 🚀 Quick Start (for development)

1. Clone the repository with `git clone https://github.com/akdeb/open-toys.git`
2. Install Rust and Tauri with `curl https://sh.rustup.rs -sSf | sh`
3. Install Node from [here](https://nodejs.org/en/download)
4. Run `cd app`
5. Run `npm install`
6. Run `npm run tauri dev`

## Cards & Stories
Create experiences with personalities that can play games, tell stories, engage in educational conversations. Here are some of the default characters with more prompt details in [personalities.json](./app/src/assets/personalities.json).

<p align="center">
  <img src="assets/card1.png" width="24%">
  <img src="assets/card2.png" width="24%">
  <img src="assets/card3.png" width="24%">
  <img src="assets/card4.png" width="24%">
</p>

## Stack

- STT: Whisper Turbo ASR
- TTS: Qwen3-TTS and Chatterbox-turbo
- LLMs: any LLM from [`mlx-community`](http://huggingface.co/mlx-community) (Gemma 4, Qwen3.8, Muse Glimmer, Qwen3, Llama, Mistral3, etc.)
- App: Tauri, React, Tailwind CSS, TypeScript, Rust
- Platform focus: Apple Silicon (M1/2/3/4/5)
- Hardware device: ESP32-S3

## ⚡️ Flash to ESP32

1. Connect your ESP32-S3 to your Apple Silicon Mac with a USB cable.
2. In OpenToys, go to `Settings` → `Connect your ESP32 Here`, pick your serial port and click `Flash`.
3. OpenToys flashes the bundled firmware images (`bootloader`, `partitions`, `firmware`) directly.
4. Unplug the toy once flashing finishes. You only need to do this again to update the firmware.

## 🎮 Play

The toy hosts its own WiFi network and your Mac joins it, so there is no router
setup, no captive portal, and no home network involved.

1. **Power on the toy.** On boot it starts an open access point called **`ELATO`**
   (no password) at `192.168.4.1`. Its LED glows pink while it waits.
2. **Join `ELATO` from your Mac.** It appears in the macOS WiFi menu like any other
   network. macOS will warn that the network has no internet — that is expected,
   the toy is not a router.
3. **Wait a moment for the handshake.** The toy detects your Mac, finds the OpenToys
   server on it, and opens a websocket. The LED turns white and the status row in
   the app switches to `Ready on device`.
4. **Press the green `Play` button.** It is disabled until the toy is connected
   (it reads *"Connect your Mac to ELATO first"* on hover) and enables itself the
   moment the handshake lands. Press it and the toy is live — start talking.

Leave OpenToys running while you play; it is doing the speech-to-text, the LLM, and
the text-to-speech on your Mac. To finish, press `End` in the app — it drops the session
and takes you to the transcript — or just power off the toy.

> [!TIP]
> While your Mac is joined to `ELATO` it has no internet access. Download your models
> and voices **before** joining, or hop back onto your normal WiFi to fetch them and
> then rejoin `ELATO`.

### If the `Play` button stays greyed out

- **`ELATO` isn't in the WiFi list** — the toy isn't powered, or the firmware didn't
  flash. Reflash and watch for the pink LED on boot.
- **Joined `ELATO` but nothing happens** — make sure OpenToys is actually running on
  the Mac. The toy probes ports `49320` and `8000` on whichever machine joins it, and
  waits for one of them to answer.
- **The button says `Download voice`** — the selected character's voice isn't on disk
  yet. Click it to fetch the voice, then come back.

## 🛡️ Safety Considerations

AI systems (local or cloud) are not perfect. This project is built with data privacy and safety in mind, but there are still important limitations:

- **Hallucinations**: LLM and TTS models can give incorrect or misleading answers. This should not be treated as a source of truth.
- **Inappropriate outputs**: Adversarial or ambiguous prompts can sometimes produce unsafe responses.
- **Emotional impact**: AI should not replace real human interaction, especially for children.

*When using with children, use with parental awareness and treat this as a tool for exploration, not authority.*

## Tested on ✅

1. M1 Pro 2021 Macbook Pro
2. M3 2024 Macbook Air
2. M4 Pro 2024 Macbook Pro

## Project Structure

```
open-toys/
├── app/
├── arduino/
├── resources/
├────────── python-backend/
├────────── firmware/
└── README.md
```

Python 3.11 runtime binary, packages and HF models are downloaded on first app setup into the app data directory.

## License
MIT

---

If you like this project, consider supporting us with a star ⭐️ on GitHub!
