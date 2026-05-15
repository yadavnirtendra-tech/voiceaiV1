# 🚀 VoiceForge AI: Complete Deployment & Call Setup Guide

This guide will walk you through deploying your "VAPI Killer" app and connecting a real phone number so users can call and talk to your AI.

---

## Phase 1: Local Infrastructure Setup

Before the app can "speak" or "hear," you need the AI engines running.

### 1. Install & Warm up Ollama (The Brain)
*   Download [Ollama](https://ollama.ai) for Windows.
*   Open your terminal and run:
    ```bash
    ollama pull llama3.2
    ```
*   Keep Ollama running in the background.

### 2. Start TTS & STT (The Voice & Ears)
*   Install [Docker Desktop](https://www.docker.com/products/docker-desktop/).
*   In the project root directory, run:
    ```bash
    docker compose up -d
    ```
    *This starts the high-speed Kokoro (TTS) and Whisper (STT) services.*

---

## Phase 2: Backend & Database Deployment

### 1. Configure Environment
Open `backend/.env` and ensure these are set (use `ngrok` for public access, see Phase 3):
```env
PORT=3000
DATABASE_URL="file:./voiceforge.db"
OLLAMA_BASE_URL="http://localhost:11434"
KOKORO_TTS_URL="http://localhost:8880"
WHISPER_STT_URL="ws://localhost:8765"
```

### 2. Initialize App
Run these commands in the `backend` folder:
```bash
npm install
npx prisma migrate dev --name init
npm run dev
```
*Your dashboard is now live at `http://localhost:3000`.*

---

## Phase 3: Making it Public (For Phone Calls)

Twilio needs a public URL to send audio to your local machine.

1.  **Install ngrok**: Download from [ngrok.com](https://ngrok.com).
2.  **Expose Port 3000**:
    ```bash
    ngrok http 3000
    ```
3.  **Copy the URL**: You will get a URL like `https://a1b2-c3d4.ngrok-free.app`.
4.  **Update .env**:
    ```env
    PUBLIC_URL="https://a1b2-c3d4.ngrok-free.app"
    ```

---

## Phase 4: Twilio Phone Number Configuration

1.  **Buy a Number**: In [Twilio Console](https://console.twilio.com), buy a Voice-capable number.
2.  **Configure Webhook**:
    *   Go to **Phone Numbers** > **Manage** > **Active Numbers**.
    *   Click your number.
    *   Scroll to **Voice & Fax**.
    *   Under "A CALL COMES IN", select **Webhook**.
    *   Paste: `https://your-ngrok-url.ngrok-free.app/api/voice/twilio/incoming`
    *   Set the method to **HTTP POST**.
3.  **Save Changes**.

---

## Phase 5: Setting Up your "Retail AI" Agent

1.  **Open Dashboard**: Go to `http://localhost:3000/#agents`.
2.  **Create Agent**:
    *   **Name**: "Retail Assistant"
    *   **Voice**: Choose a natural one (e.g., `af_heart` or `am_adam`).
    *   **System Prompt**: "You are a professional retail assistant for [Your Store]. Be helpful, polite, and brief."
    *   **Transfer Number**: Your real phone number (in case the AI needs help).
3.  **Add Knowledge Base**:
    *   Click the **Knowledge** button on your new agent.
    *   Add items like:
        *   *Q: What are your hours?* -> *A: We are open 9am to 9pm daily.*
        *   *Q: Where are you located?* -> *A: We are at 123 AI Street, Tech City.*
4.  **Map Number**:
    *   Go to **Phone Numbers** tab.
    *   Click **Add Number**.
    *   Enter your Twilio number and select your "Retail Assistant" agent.

---

## 📞 Testing the Call

1.  **Call your Twilio Number** from your cell phone.
2.  **The AI will answer** with the "Greeting Message" you set.
3.  **Talk naturally**: Ask "What are your hours?"
4.  **The AI will check the Knowledge Base** and reply with your custom answer!
5.  **Monitor Live**: Watch the **Dashboard** to see the transcript and latency in real-time.

---

## 🚀 Pro-Tips for World-Class Performance
*   **VRAM**: If you have an NVIDIA GPU, ensure Ollama is using it for 10ms response times.
*   **Keep Alive**: The app automatically keeps the model loaded in memory (`keep_alive: -1`) so there is no "wake up" delay.
*   **Webhooks**: Connect the Agent's "Webhook URL" to your CRM (like Zapier or Make.com) to automatically save call details.
