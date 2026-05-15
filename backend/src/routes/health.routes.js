/**
 * VoiceForge AI - System Health Routes
 * Checks all AI services: Ollama, Kokoro TTS, Whisper STT
 */
import { Router } from 'express';
import { checkOllamaHealth, listModels } from '../services/llm/ollama.service.js';
import { checkTtsHealth, getVoices } from '../services/tts/kokoro.service.js';
import { checkSttHealth } from '../services/stt/whisper.service.js';
import config from '../config/env.js';

const router = Router();

/**
 * GET /api/health
 * Complete system health check
 */
router.get('/', async (req, res) => {
  const [llm, tts, stt] = await Promise.all([
    checkOllamaHealth(),
    checkTtsHealth(),
    checkSttHealth(),
  ]);

  const allHealthy = llm.healthy && tts.healthy;
  // STT is optional (browser can use Web Speech API)

  res.status(allHealthy ? 200 : 503).json({
    status: allHealthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    uptime: `${Math.floor(process.uptime())}s`,
    services: {
      llm: {
        status: llm.healthy ? 'online' : 'offline',
        provider: 'Ollama (Local)',
        model: config.ollamaModel,
        url: config.ollamaBaseUrl,
        ...llm,
      },
      tts: {
        status: tts.healthy ? 'online' : 'offline',
        provider: 'Kokoro 82M (Local)',
        voice: config.kokoroVoice,
        url: config.kokoroTtsUrl,
        ...tts,
      },
      stt: {
        status: stt.healthy ? 'online' : 'offline',
        provider: 'Faster-Whisper (Local)',
        model: config.whisperModel,
        url: config.whisperSttUrl,
        ...stt,
      },
      twilio: {
        status: config.twilioEnabled ? 'configured' : 'not_configured',
        provider: 'Twilio',
        hasNumber: !!config.twilioPhoneNumber,
      },
    },
    cost: {
      llm: '$0 (self-hosted)',
      tts: '$0 (self-hosted)',
      stt: '$0 (self-hosted)',
      total: '$0.00/month',
    },
  });
});

/**
 * GET /api/health/models
 * List available LLM models
 */
router.get('/models', async (req, res) => {
  const models = await listModels();
  res.json({ models });
});

/**
 * GET /api/health/voices
 * List available TTS voices
 */
router.get('/voices', async (req, res) => {
  const voices = await getVoices();
  res.json({ voices });
});

export default router;
