/**
 * VoiceForge AI - Environment Configuration
 * Kept from original stack pattern
 */
import dotenv from 'dotenv';
dotenv.config();

const config = {
  // Server
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  apiBaseUrl: process.env.API_BASE_URL || 'http://localhost:3000',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',

  // JWT
  jwtSecret: process.env.JWT_SECRET || 'voiceforge-dev-secret',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',

  // Ollama (Local LLM)
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
  ollamaModel: process.env.OLLAMA_MODEL || 'llama3.2',
  ollamaKeepAlive: process.env.OLLAMA_KEEP_ALIVE || '-1',

  // Kokoro TTS
  kokoroTtsUrl: process.env.KOKORO_TTS_URL || 'http://localhost:8880',
  kokoroVoice: process.env.KOKORO_VOICE || 'af_heart',
  kokoroSpeed: parseFloat(process.env.KOKORO_SPEED || '1.0'),

  // Whisper STT
  whisperSttUrl: process.env.WHISPER_STT_URL || 'ws://localhost:8765',
  whisperModel: process.env.WHISPER_MODEL || 'base',
  whisperLanguage: process.env.WHISPER_LANGUAGE || 'auto',

  // Twilio
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID || '',
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN || '',
  twilioPhoneNumber: process.env.TWILIO_PHONE_NUMBER || '',
  twilioWebhookUrl: process.env.TWILIO_WEBHOOK_URL || '',

  // Feature flags
  get twilioEnabled() {
    return !!(this.twilioAccountSid && this.twilioAuthToken);
  },
};

export default config;
