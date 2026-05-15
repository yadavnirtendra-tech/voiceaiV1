# 🎙️ VoiceForge AI - The VAPI Killer

**World's Fastest Self-Hosted Voice AI Platform.** 
Zero Cost. Unlimited Minutes. Sovereign AI.

VoiceForge AI gives you a professional-grade Voice AI infrastructure that runs entirely on your own hardware. No per-minute fees, no latency penalties from cloud hopping, and total privacy.

## 🚀 Features
- **⚡ Ultra-Low Latency:** Sub-500ms response times using local model streaming.
- **🗣️ Natural Human Voices:** Powered by Kokoro 82M (MOS 4.2), better than most paid APIs.
- **📞 Twilio Integration:** Full support for Inbound & Outbound phone calls via bidirectional Media Streams.
- **🌐 Browser Calling:** Talk to your agents directly from the dashboard using WebRTC/WebSockets.
- **🧠 Brains (LLM):** Pluggable local LLMs (Llama 3.2, Mistral, Phi-3) via Ollama.
- **👂 Ears (STT):** High-accuracy real-time transcription via Faster-Whisper.
- **🏢 Retail Ready:** Knowledge base, transfer logic, and webhooks included.
- **🌍 Multilingual:** Support for 30+ languages for both listening and speaking.

## 🛠️ Stack
- **Backend:** Node.js, Express, WebSocket, Prisma (SQLite)
- **Frontend:** Vanilla JS, CSS (Premium Glassmorphism)
- **AI Infrastructure:**
  - **LLM:** [Ollama](https://ollama.ai) (Local)
  - **TTS:** [Kokoro-FastAPI](https://github.com/remsky/kokoro-fastapi) (Docker)
  - **STT:** [Faster-Whisper-Server](https://github.com/fedirz/faster-whisper-server) (Docker)

## 📦 Installation

### 1. Prerequisite: Install Ollama
Download and install [Ollama](https://ollama.ai).
Once installed, pull your preferred model:
```bash
ollama pull llama3.2
```

### 2. Start AI Services (Docker)
Ensure Docker is running, then start the STT and TTS services:
```bash
docker compose up -d
```

### 3. Setup Backend
```bash
cd backend
npm install
npx prisma migrate dev --name init
```

### 4. Run App
```bash
npm run dev
```
Open `http://localhost:3000` to access your dashboard.

## 📞 Twilio Setup (Optional)
To receive phone calls:
1. Set up a Twilio account and buy a number.
2. In your `.env`, add your `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN`.
3. Use a tool like **ngrok** to expose your local port 3000: `ngrok http 3000`.
4. Point your Twilio Number's "A Call Comes In" Webhook to `https://your-ngrok-url/api/voice/twilio/incoming`.

## 🛡️ License
MIT - Free forever. No limits.
