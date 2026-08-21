[English](README.md) | 中文

<div align="center">

<img src="assets/logo.png" width="100" align="center"/>
<br />

# OpenToys

### 面向玩具、陪伴设备和机器人的开源本地语音 AI，可在你的 MacBook 上运行

*OpenToys 是 [ElatoAI](https://www.github.com/akdeb/ElatoAI) 的本地优先平台版本。无需云端运行、没有订阅锁定，数据保留在本机设备上。*

**Apple Silicon · Rust + React · ESP32-S3 · Whisper ASR · Qwen3-TTS · MLX LLMs**

[![App](https://img.shields.io/badge/App-Tauri%20%2B%20React-yellow)](#技术栈)
[![ESP32](https://img.shields.io/badge/Hardware-ESP32--S3-red?logo=espressif&logoColor=white)](#esp32-diy-硬件)
[![License](https://img.shields.io/badge/License-MIT-brightgreen)](LICENSE)
[![Releases](https://img.shields.io/badge/Download-Latest%20DMG-blue)](https://github.com/akdeb/open-toys/releases/latest/download/OpenToys_0.1.0_aarch64.dmg)

</div>

## 媒体报道
<p>
  <a href="https://www.wired.com/story/the-new-wild-west-of-ai-kids-toys/" target="_blank">
    <img src="assets/wired.png" width="180" align="left"/>
  </a>
  <strong>The New Wild West of AI Kids Toys</strong>
  <br/>
  <a href="https://www.wired.com/story/the-new-wild-west-of-ai-kids-toys/">阅读 WIRED 文章 →</a>
</p>
<br clear="left"/>

<p>
  <a href="https://www.hackster.io/news/the-easy-way-to-build-interactive-ai-toys-for-your-kids-0ba401a9328f" target="_blank">
    <img src="assets/hackster.png" width="180" align="left"/>
  </a>
  <strong>The Easy Way to Build Interactive AI Toys for Your Kids</strong>
  <br/>
  <a href="https://www.hackster.io/news/the-easy-way-to-build-interactive-ai-toys-for-your-kids-0ba401a9328f">阅读 Hackster 文章 →</a>
</p>
<br clear="left"/>

## 🎥 演示视频

[![OpenToys Demo](assets/demo.png)](https://youtu.be/V5uNgMRsBHE)

## 最新动态
- **2026-03-14：** OpenToys 发布 🎉 正好也是 Pi Day！如果你想在 ESP32 设备上运行 OpenAI Realtime、Gemini、ElevenLabs 等实时 AI 模型，可以查看 [ElatoAI](https://www.github.com/akdeb/ElatoAI)。

## 为什么选择 OpenToys？

- **完全本地运行**：不依赖云端、不需要订阅、数据不离开你的设备，永久免费使用本地 AI。
- **多语言支持**：OpenToys 支持多种语言和口音，包括英语 🇺🇸/🇬🇧、中文 🇨🇳、西班牙语 🇪🇸、法语 🇫🇷、日语 🇯🇵、韩语 🇰🇷、葡萄牙语 🇵🇹、德语 🇩🇪、意大利语 🇮🇹 等。
- **声音克隆**：使用少于 10 秒的音频，克隆你自己的声音或喜欢的角色声音。
- **高度可定制**：用 ESP32 构建你自己的玩具、陪伴设备、机器人等。
- **开源**：社区开源，欢迎自由使用和贡献。

## 应用设计
<!-- ![OpenToys Cover](assets/cover.png) -->
![OpenToys Demo](assets/open-toys.gif)

## ESP32 DIY 硬件

![ESP32 DIY Hardware](assets/pcb-design.png)
[固件文档 ⏭️](https://www.elatoai.com/docs/blog/firmware)

## 下载与安装

- 直接下载 DMG：[OpenToys_0.1.0_aarch64.dmg](https://github.com/akdeb/open-toys/releases/latest/download/OpenToys_0.1.0_aarch64.dmg)
- 所有版本：[GitHub Releases](https://github.com/akdeb/open-toys/releases)

## 🚀 快速开始（开发环境）

1. 克隆仓库：`git clone https://github.com/akdeb/open-toys.git`
2. 安装 Rust 和 Tauri：`curl https://sh.rustup.rs -sSf | sh`
3. 从[这里](https://nodejs.org/en/download)安装 Node
4. 运行 `cd app`
5. 运行 `npm install`
6. 运行 `npm run tauri dev`

## 角色卡片与故事

你可以创建会玩游戏、讲故事、进行教育对话的角色体验。下面是一些默认角色，更多提示词细节可查看 [personalities.json](./app/src/assets/personalities.json)。

<p align="center">
  <img src="assets/card1.png" width="24%">
  <img src="assets/card2.png" width="24%">
  <img src="assets/card3.png" width="24%">
  <img src="assets/card4.png" width="24%">
</p>

## 技术栈

- STT：Whisper Turbo ASR
- TTS：Qwen3-TTS 和 Chatterbox-turbo
- LLM：来自 [`mlx-community`](http://huggingface.co/mlx-community) 的任意 LLM（Qwen3、Llama、Mistral3 等）
- App：Tauri、React、Tailwind CSS、TypeScript、Rust
- 重点平台：Apple Silicon（M1/2/3/4/5）
- 硬件设备：ESP32-S3

## ⚡️ 刷写到 ESP32

1. 用 USB 线将 ESP32-S3 连接到 Apple Silicon Mac。
2. 在 OpenToys 中进入 `Settings` → `Connect your ESP32 Here`，选择串口后点击 `Flash`。
3. OpenToys 会直接刷写内置固件镜像（`bootloader`、`partitions`、`firmware`）。
4. 刷写完成后即可拔掉数据线。只有在更新固件时才需要重复这一步。

## 🎮 开始使用

玩具会自己开一个 WiFi 热点，由 Mac 主动加入。因此不需要配置路由器，没有配网页面，
也不涉及你家里的网络。

1. **给玩具上电。** 启动后它会开启一个名为 **`ELATO`** 的开放热点（无密码），
   地址为 `192.168.4.1`。等待期间 LED 会亮粉色。
2. **在 Mac 上加入 `ELATO`。** 它会像普通网络一样出现在 macOS 的 WiFi 菜单里。
   macOS 会提示该网络无法连接互联网 —— 这是正常的，玩具并不是路由器。
3. **稍等片刻完成握手。** 玩具会检测到你的 Mac，找到其上运行的 OpenToys 服务并建立
   websocket 连接。此时 LED 变为白色，应用中的状态栏会显示 `Ready on device`。
4. **按下绿色的 `Play` 按钮。** 在玩具连接成功之前该按钮不可点击（悬停会提示
   *"Connect your Mac to ELATO first"*），握手完成的瞬间它就会自动变为可用。
   点击后玩具即可开始对话。

使用期间请保持 OpenToys 运行 —— 语音识别、大模型推理和语音合成都在你的 Mac 上进行。
结束时在应用中按 `End`（会结束会话并跳转到对话记录），或直接给玩具断电。

> [!TIP]
> 当 Mac 连接到 `ELATO` 时是没有互联网的。请在加入热点**之前**先下载好模型和声音，
> 或者切回常用 WiFi 下载完成后再重新加入 `ELATO`。

### 如果 `Play` 按钮一直是灰的

- **WiFi 列表里没有 `ELATO`** —— 玩具没有上电，或固件没有刷写成功。重新刷写并留意
  启动时的粉色 LED。
- **已加入 `ELATO` 但没有反应** —— 确认 Mac 上的 OpenToys 正在运行。玩具会在加入热点的
  设备上探测 `49320` 和 `8000` 端口，并等待其中之一响应。
- **按钮显示 `Download voice`** —— 所选角色的声音还没有下载到本地。点击它下载完成后再返回。

## 🛡️ 安全注意事项

AI 系统（无论本地还是云端）都并不完美。这个项目以数据隐私和安全为核心设计，但仍有重要限制：

- **幻觉问题**：LLM 和 TTS 模型可能给出错误或误导性回答，不应被当作事实来源。
- **不当输出**：对抗性或含糊的提示词有时可能产生不安全的回复。
- **情感影响**：AI 不应替代真实的人际互动，尤其是面向儿童时。

*与儿童一起使用时，请保持家长知情和陪伴，把它作为探索工具，而不是权威来源。*

## 测试设备 ✅

1. M1 Pro 2021 MacBook Pro
2. M3 2024 MacBook Air
3. M4 Pro 2024 MacBook Pro

## 项目结构

```
open-toys/
├── app/
├── arduino/
├── resources/
├────────── python-backend/
├────────── firmware/
└── README.md
```

Python 3.11 运行时二进制文件、依赖包和 Hugging Face 模型会在应用首次设置时下载到应用数据目录。

## License
MIT

---

如果你喜欢这个项目，欢迎在 GitHub 上给我们点一个 star ⭐️！
