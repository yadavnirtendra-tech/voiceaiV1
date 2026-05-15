/**
 * VoiceForge AI - Ollama LLM Service
 * Streams responses from local Ollama for ultra-low latency
 * Supports: llama3.2, mistral, phi3, gemma2, deepseek-coder, etc.
 */
import config from '../../config/env.js';
import logger from '../../utils/logger.js';

const OLLAMA_API = `${config.ollamaBaseUrl}/api`;

/**
 * Check if Ollama is running and the model is loaded
 */
export async function checkOllamaHealth() {
  try {
    const res = await fetch(`${config.ollamaBaseUrl}/api/tags`);
    if (!res.ok) return { healthy: false, error: 'Ollama not responding' };
    const data = await res.json();
    const models = data.models?.map(m => m.name) || [];
    const hasModel = models.some(m => m.startsWith(config.ollamaModel));
    return { healthy: true, models, hasModel, activeModel: config.ollamaModel };
  } catch (err) {
    return { healthy: false, error: err.message };
  }
}

/**
 * Warm up the model (keep it loaded in memory)
 */
export async function warmupModel() {
  try {
    logger.info(`Warming up Ollama model: ${config.ollamaModel}`);
    const res = await fetch(`${OLLAMA_API}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.ollamaModel,
        prompt: 'Hello',
        stream: false,
        keep_alive: -1,
        options: { num_predict: 1 },
      }),
    });
    if (res.ok) {
      logger.info('Ollama model warmed up and resident in memory');
      return true;
    }
    return false;
  } catch (err) {
    logger.warn('Ollama warmup failed - model will load on first request', { error: err.message });
    return false;
  }
}

/**
 * Generate a streaming response from the local LLM
 * @param {Array} messages - Chat messages [{role, content}]
 * @param {Object} options - {model, temperature, maxTokens}
 * @returns {AsyncGenerator<string>} - Token stream
 */
export async function* streamChat(messages, options = {}) {
  const model = options.model || config.ollamaModel;
  const temperature = options.temperature ?? 0.7;
  const maxTokens = options.maxTokens ?? 150;
  
  const startTime = Date.now();
  let firstTokenTime = null;
  let totalTokens = 0;

  try {
    const res = await fetch(`${OLLAMA_API}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        keep_alive: -1,
        options: {
          temperature,
          num_predict: maxTokens,
          top_p: 0.9,
          repeat_penalty: 1.1,
        },
      }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Ollama error ${res.status}: ${errorText}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.message?.content) {
            if (!firstTokenTime) {
              firstTokenTime = Date.now();
              logger.debug(`LLM TTFT: ${firstTokenTime - startTime}ms`);
            }
            totalTokens++;
            yield parsed.message.content;
          }
          if (parsed.done) {
            const totalTime = Date.now() - startTime;
            logger.debug(`LLM complete: ${totalTokens} tokens in ${totalTime}ms (${Math.round(totalTokens / (totalTime / 1000))} tok/s)`);
          }
        } catch (e) {
          // Skip malformed JSON lines
        }
      }
    }
  } catch (err) {
    logger.error('LLM stream error', { error: err.message });
    yield "I'm sorry, I'm having trouble processing that right now.";
  }
}

/**
 * Generate a complete (non-streaming) response
 */
export async function generateResponse(messages, options = {}) {
  const model = options.model || config.ollamaModel;
  const temperature = options.temperature ?? 0.7;
  const maxTokens = options.maxTokens ?? 150;

  const startTime = Date.now();

  try {
    const res = await fetch(`${OLLAMA_API}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        keep_alive: -1,
        options: {
          temperature,
          num_predict: maxTokens,
          top_p: 0.9,
          repeat_penalty: 1.1,
        },
      }),
    });

    if (!res.ok) throw new Error(`Ollama error: ${res.status}`);
    const data = await res.json();
    const latency = Date.now() - startTime;
    
    logger.debug(`LLM response: ${latency}ms`, { tokens: data.eval_count });
    
    return {
      content: data.message?.content || '',
      latencyMs: latency,
      tokens: data.eval_count || 0,
    };
  } catch (err) {
    logger.error('LLM generation error', { error: err.message });
    return {
      content: "I'm sorry, I couldn't process that right now.",
      latencyMs: Date.now() - startTime,
      tokens: 0,
    };
  }
}

/**
 * List available models
 */
export async function listModels() {
  try {
    const res = await fetch(`${config.ollamaBaseUrl}/api/tags`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.models || [];
  } catch {
    return [];
  }
}

/**
 * Pull a new model
 */
export async function pullModel(modelName) {
  try {
    const res = await fetch(`${OLLAMA_API}/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: modelName, stream: false }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
