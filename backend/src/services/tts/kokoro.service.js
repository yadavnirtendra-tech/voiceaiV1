/**
 * VoiceForge AI - Kokoro TTS Service
 * Natural human-like voice synthesis (82M param, MOS 4.2)
 * OpenAI-compatible API via kokoro-fastapi Docker container
 * 
 * Voices: af_heart, af_bella, af_nicole, af_sky, am_adam, am_michael, bf_emma, bm_george
 * Languages: en, ja, zh, ko, fr, de, es, pt, it, hi, ar (multilingual)
 */
import config from '../../config/env.js';
import logger from '../../utils/logger.js';

const TTS_API = `${config.kokoroTtsUrl}/v1`;

/**
 * Check TTS service health
 */
export async function checkTtsHealth() {
  try {
    const res = await fetch(`${config.kokoroTtsUrl}/v1/audio/voices`);
    if (!res.ok) return { healthy: false, error: 'Kokoro TTS not responding' };
    const voices = await res.json();
    return { healthy: true, voices: Array.isArray(voices) ? voices : [] };
  } catch (err) {
    // Try alternative health check endpoint
    try {
      const res2 = await fetch(`${config.kokoroTtsUrl}/`);
      return { healthy: res2.ok, voices: [], fallback: true };
    } catch {
      return { healthy: false, error: err.message };
    }
  }
}

/**
 * Generate speech audio from text
 * Returns raw audio buffer (WAV format)
 * @param {string} text - Text to synthesize
 * @param {Object} options - {voice, speed, format}
 * @returns {Promise<{audioBuffer: Buffer, latencyMs: number}>}
 */
export async function synthesize(text, options = {}) {
  const voice = options.voice || config.kokoroVoice;
  const speed = options.speed || config.kokoroSpeed;
  const format = options.format || 'wav';

  const startTime = Date.now();

  try {
    const res = await fetch(`${TTS_API}/audio/speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'kokoro',
        input: text,
        voice: voice,
        speed: speed,
        response_format: format,
      }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`TTS error ${res.status}: ${errorText}`);
    }

    const audioBuffer = Buffer.from(await res.arrayBuffer());
    const latencyMs = Date.now() - startTime;

    logger.debug(`TTS synthesized: "${text.substring(0, 50)}..." in ${latencyMs}ms (${audioBuffer.length} bytes)`);

    return { audioBuffer, latencyMs, format };
  } catch (err) {
    logger.error('TTS synthesis error', { error: err.message, text: text.substring(0, 100) });
    throw err;
  }
}

/**
 * Generate speech and return as streaming chunks for ultra-low latency
 * Splits text into sentences and synthesizes each independently
 * @param {string} text - Full text to synthesize
 * @param {Object} options - {voice, speed}
 * @returns {AsyncGenerator<{audioBuffer: Buffer, sentence: string, latencyMs: number}>}
 */
export async function* streamSynthesize(text, options = {}) {
  // Split into sentences for faster first-audio response
  const sentences = splitIntoSentences(text);

  for (const sentence of sentences) {
    if (!sentence.trim()) continue;
    try {
      const result = await synthesize(sentence.trim(), options);
      yield { ...result, sentence: sentence.trim() };
    } catch (err) {
      logger.error('TTS stream chunk error', { error: err.message });
      // Continue with next sentence
    }
  }
}

/**
 * Convert WAV buffer to μ-law (mulaw) 8kHz for Twilio
 * Twilio requires: audio/x-mulaw, 8000Hz, mono
 */
export function wavToMulaw(wavBuffer) {
  // Skip WAV header (44 bytes) to get raw PCM data
  const pcmData = wavBuffer.slice(44);
  const samples = new Int16Array(pcmData.buffer, pcmData.byteOffset, pcmData.byteLength / 2);
  
  // Resample from whatever rate to 8000Hz (simple decimation)
  // Kokoro outputs at 24000Hz typically, so downsample by factor of 3
  const downsampleFactor = 3;
  const outputLength = Math.floor(samples.length / downsampleFactor);
  const mulawData = new Uint8Array(outputLength);

  for (let i = 0; i < outputLength; i++) {
    const sample = samples[i * downsampleFactor];
    mulawData[i] = linearToMulaw(sample);
  }

  return Buffer.from(mulawData);
}

/**
 * Linear PCM sample to μ-law encoding
 */
function linearToMulaw(sample) {
  const MULAW_MAX = 0x1FFF;
  const MULAW_BIAS = 33;
  const sign = (sample >> 8) & 0x80;
  
  if (sign !== 0) sample = -sample;
  if (sample > MULAW_MAX) sample = MULAW_MAX;
  
  sample += MULAW_BIAS;
  
  let exponent = 7;
  let mask = 0x4000;
  
  for (; exponent > 0; exponent--) {
    if (sample >= mask) break;
    mask >>= 1;
  }
  
  const mantissa = (sample >> (exponent + 3)) & 0x0F;
  const mulawByte = ~(sign | (exponent << 4) | mantissa);
  
  return mulawByte & 0xFF;
}

/**
 * Split text into natural sentence boundaries
 */
function splitIntoSentences(text) {
  // Split on sentence-ending punctuation while keeping the punctuation
  return text
    .replace(/([.!?])\s+/g, '$1|SPLIT|')
    .split('|SPLIT|')
    .filter(s => s.trim().length > 0);
}

/**
 * Get available voices
 */
export async function getVoices() {
  try {
    const res = await fetch(`${config.kokoroTtsUrl}/v1/audio/voices`);
    if (res.ok) return await res.json();
    return getDefaultVoices();
  } catch {
    return getDefaultVoices();
  }
}

function getDefaultVoices() {
  return [
    { id: 'af_heart', name: 'Heart (Female)', language: 'en' },
    { id: 'af_bella', name: 'Bella (Female)', language: 'en' },
    { id: 'af_nicole', name: 'Nicole (Female)', language: 'en' },
    { id: 'af_sky', name: 'Sky (Female)', language: 'en' },
    { id: 'am_adam', name: 'Adam (Male)', language: 'en' },
    { id: 'am_michael', name: 'Michael (Male)', language: 'en' },
    { id: 'bf_emma', name: 'Emma (Female, British)', language: 'en-gb' },
    { id: 'bm_george', name: 'George (Male, British)', language: 'en-gb' },
  ];
}
