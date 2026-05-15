/**
 * VoiceForge AI - Whisper STT Service  
 * Self-hosted speech-to-text using Faster-Whisper
 * Supports: WebSocket streaming + HTTP batch
 * Languages: 99+ languages (auto-detect or specify)
 */
import config from '../../config/env.js';
import logger from '../../utils/logger.js';

const WHISPER_HTTP_URL = config.whisperSttUrl.replace('ws://', 'http://').replace('wss://', 'https://');

/**
 * Check STT service health
 */
export async function checkSttHealth() {
  try {
    // Try the HTTP endpoint
    const res = await fetch(`${WHISPER_HTTP_URL}/health`);
    return { healthy: res.ok };
  } catch (err) {
    // WhisperLive might only have WS - try a simple connection test
    return { healthy: false, error: err.message, note: 'WebSocket-only mode' };
  }
}

/**
 * Transcribe audio buffer (batch mode)
 * @param {Buffer} audioBuffer - WAV/PCM audio data
 * @param {Object} options - {language, model}
 * @returns {Promise<{text: string, language: string, latencyMs: number}>}
 */
export async function transcribe(audioBuffer, options = {}) {
  const language = options.language || config.whisperLanguage;
  const startTime = Date.now();

  try {
    // Try OpenAI-compatible endpoint first (speaches / whisper-asr-webservice)
    const formData = new FormData();
    formData.append('file', new Blob([audioBuffer], { type: 'audio/wav' }), 'audio.wav');
    formData.append('model', config.whisperModel);
    if (language !== 'auto') {
      formData.append('language', language);
    }

    const res = await fetch(`${WHISPER_HTTP_URL}/v1/audio/transcriptions`, {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) throw new Error(`STT error: ${res.status}`);
    
    const data = await res.json();
    const latencyMs = Date.now() - startTime;

    logger.debug(`STT transcribed in ${latencyMs}ms: "${data.text?.substring(0, 80)}"`);

    return {
      text: data.text || '',
      language: data.language || language,
      latencyMs,
    };
  } catch (err) {
    logger.error('STT transcription error', { error: err.message });
    throw err;
  }
}

/**
 * Create a streaming STT WebSocket connection
 * Used for real-time phone call transcription
 * @param {Object} callbacks - {onTranscript, onPartial, onError}
 * @returns {Object} - {send(audioChunk), close()}
 */
export function createStreamingSession(callbacks = {}) {
  const { onTranscript, onPartial, onError } = callbacks;
  
  let ws = null;
  let isConnected = false;
  let buffer = [];

  const connect = async () => {
    try {
      // Dynamic import for WebSocket (works in Node.js)
      const { default: WebSocket } = await import('ws');
      
      ws = new WebSocket(config.whisperSttUrl);

      ws.on('open', () => {
        isConnected = true;
        logger.debug('STT WebSocket connected');
        
        // Send configuration
        ws.send(JSON.stringify({
          type: 'config',
          model: config.whisperModel,
          language: config.whisperLanguage === 'auto' ? null : config.whisperLanguage,
          use_vad: true,
        }));

        // Flush buffered audio
        for (const chunk of buffer) {
          ws.send(chunk);
        }
        buffer = [];
      });

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          
          if (msg.type === 'transcript' || msg.text) {
            const text = msg.text || msg.transcript || '';
            const isFinal = msg.is_final !== false;
            
            if (isFinal && text.trim()) {
              onTranscript?.(text.trim(), msg.language);
            } else if (!isFinal && text.trim()) {
              onPartial?.(text.trim());
            }
          }
        } catch (e) {
          // Binary response or non-JSON
        }
      });

      ws.on('error', (err) => {
        logger.error('STT WebSocket error', { error: err.message });
        onError?.(err);
      });

      ws.on('close', () => {
        isConnected = false;
        logger.debug('STT WebSocket closed');
      });
    } catch (err) {
      logger.error('STT WebSocket connection failed', { error: err.message });
      onError?.(err);
    }
  };

  connect();

  return {
    send(audioChunk) {
      if (isConnected && ws?.readyState === 1) {
        ws.send(audioChunk);
      } else {
        buffer.push(audioChunk);
      }
    },
    close() {
      isConnected = false;
      ws?.close();
    },
    get connected() {
      return isConnected;
    },
  };
}

/**
 * Convert μ-law (mulaw) 8kHz audio from Twilio to PCM16 for Whisper
 */
export function mulawToPcm16(mulawBuffer) {
  const MULAW_DECODE_TABLE = new Int16Array(256);
  
  // Build decode table
  for (let i = 0; i < 256; i++) {
    let mulaw = ~i & 0xFF;
    const sign = mulaw & 0x80;
    const exponent = (mulaw >> 4) & 0x07;
    const mantissa = mulaw & 0x0F;
    let sample = ((mantissa << 3) + 0x84) << exponent;
    sample -= 0x84;
    MULAW_DECODE_TABLE[i] = sign ? -sample : sample;
  }

  const pcm16 = new Int16Array(mulawBuffer.length);
  for (let i = 0; i < mulawBuffer.length; i++) {
    pcm16[i] = MULAW_DECODE_TABLE[mulawBuffer[i]];
  }

  return Buffer.from(pcm16.buffer);
}

/**
 * Upsample from 8kHz to 16kHz (what Whisper expects)
 * Simple linear interpolation
 */
export function upsample8to16(pcm16Buffer) {
  const samples = new Int16Array(pcm16Buffer.buffer, pcm16Buffer.byteOffset, pcm16Buffer.byteLength / 2);
  const upsampled = new Int16Array(samples.length * 2);

  for (let i = 0; i < samples.length - 1; i++) {
    upsampled[i * 2] = samples[i];
    upsampled[i * 2 + 1] = Math.round((samples[i] + samples[i + 1]) / 2);
  }
  // Last sample
  upsampled[(samples.length - 1) * 2] = samples[samples.length - 1];
  upsampled[(samples.length - 1) * 2 + 1] = samples[samples.length - 1];

  return Buffer.from(upsampled.buffer);
}
