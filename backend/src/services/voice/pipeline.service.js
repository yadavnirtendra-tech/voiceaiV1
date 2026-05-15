/**
 * VoiceForge AI - Voice Pipeline Orchestrator
 * The core engine that coordinates STT → LLM → TTS in real-time
 * Designed for minimal latency with streaming at every stage
 */
import { v4 as uuidv4 } from 'uuid';
import logger from '../../utils/logger.js';
import prisma from '../../db/prisma.js';
import { streamChat, generateResponse } from '../llm/ollama.service.js';
import { synthesize, wavToMulaw, streamSynthesize } from '../tts/kokoro.service.js';
import { createStreamingSession, mulawToPcm16, upsample8to16 } from '../stt/whisper.service.js';

/**
 * Active voice sessions (in-memory for speed)
 */
const activeSessions = new Map();

/**
 * Create a new voice session
 * @param {Object} params - {agentId, direction, callerNumber, calledNumber, twilioCallSid}
 * @returns {VoiceSession}
 */
export async function createSession(params) {
  const { agentId, direction = 'browser', callerNumber, calledNumber, twilioCallSid } = params;

  // Load agent config
  const agent = await prisma.agent.findUnique({ where: { id: agentId } });
  if (!agent) throw new Error(`Agent not found: ${agentId}`);

  // Create call record
  const call = await prisma.call.create({
    data: {
      agentId: agent.id,
      direction,
      status: 'active',
      callerNumber,
      calledNumber,
      twilioCallSid,
      answeredAt: new Date(),
    },
  });

  // Build conversation context
  const systemMessage = buildSystemPrompt(agent);
  const conversationHistory = [
    { role: 'system', content: systemMessage },
  ];

  const session = {
    id: call.id,
    callId: call.id,
    agent,
    conversationHistory,
    isProcessing: false,
    audioQueue: [],
    sttSession: null,
    pendingText: '',
    silenceTimer: null,
    metrics: {
      turnCount: 0,
      totalSttMs: 0,
      totalLlmMs: 0,
      totalTtsMs: 0,
    },
    // Callbacks set by the transport layer (WebSocket/Twilio)
    onAudioResponse: null,
    onTextResponse: null,
    onTranscript: null,
    onSessionEnd: null,
  };

  activeSessions.set(call.id, session);
  logger.info(`Voice session created: ${call.id}`, { agent: agent.name, direction });

  return session;
}

/**
 * Process incoming audio chunk through the full pipeline
 * STT → LLM → TTS (all streaming)
 */
export async function processAudioChunk(sessionId, audioChunk, format = 'mulaw') {
  const session = activeSessions.get(sessionId);
  if (!session) return;

  // Initialize STT session if needed
  if (!session.sttSession) {
    session.sttSession = createStreamingSession({
      onTranscript: (text, language) => handleTranscript(sessionId, text, language),
      onPartial: (text) => session.onTranscript?.({ partial: true, text }),
      onError: (err) => logger.error('STT error in session', { sessionId, error: err.message }),
    });
  }

  // Convert Twilio mulaw to PCM16 for Whisper
  let pcmChunk = audioChunk;
  if (format === 'mulaw') {
    pcmChunk = mulawToPcm16(audioChunk);
    pcmChunk = upsample8to16(pcmChunk);
  }

  // Feed to STT
  session.sttSession.send(pcmChunk);
}

/**
 * Process text input directly (for browser/WebRTC sessions)
 */
export async function processTextInput(sessionId, text) {
  await handleTranscript(sessionId, text, 'en');
}

/**
 * Handle completed transcript from STT
 * This triggers the LLM → TTS pipeline
 */
async function handleTranscript(sessionId, text, language) {
  const session = activeSessions.get(sessionId);
  if (!session || !text.trim()) return;

  // Clear any silence timer
  if (session.silenceTimer) {
    clearTimeout(session.silenceTimer);
    session.silenceTimer = null;
  }

  // Don't process if already generating a response
  if (session.isProcessing) {
    session.pendingText += ' ' + text;
    return;
  }

  const fullText = (session.pendingText + ' ' + text).trim();
  session.pendingText = '';
  session.isProcessing = true;

  logger.info(`User said: "${fullText}"`, { sessionId });
  session.onTranscript?.({ partial: false, text: fullText });

  // Save user message
  const sttStartTime = Date.now();
  await prisma.message.create({
    data: { callId: session.callId, role: 'user', content: fullText },
  });

  // Check for end-call phrases
  const endPhrases = session.agent.endCallPhrases.split(',').map(p => p.trim().toLowerCase());
  if (endPhrases.some(phrase => fullText.toLowerCase().includes(phrase))) {
    await endSession(sessionId, 'user_ended');
    return;
  }

  // Add to conversation history
  session.conversationHistory.push({ role: 'user', content: fullText });

  // Search knowledge base for context
  const kbContext = await searchKnowledgeBase(session.agent.id, fullText);
  if (kbContext) {
    session.conversationHistory.push({
      role: 'system',
      content: `Relevant information: ${kbContext}`,
    });
  }

  try {
    // === STREAMING PIPELINE: LLM → TTS ===
    const llmStartTime = Date.now();
    let fullResponse = '';
    let sentenceBuffer = '';
    let firstAudioSent = false;

    // Stream tokens from LLM
    for await (const token of streamChat(session.conversationHistory, {
      model: session.agent.llmModel,
      temperature: session.agent.temperature,
      maxTokens: session.agent.maxTokens,
    })) {
      fullResponse += token;
      sentenceBuffer += token;

      // Check if we have a complete sentence to synthesize
      const sentenceEnd = findSentenceEnd(sentenceBuffer);
      if (sentenceEnd > 0) {
        const sentence = sentenceBuffer.substring(0, sentenceEnd).trim();
        sentenceBuffer = sentenceBuffer.substring(sentenceEnd).trim();

        if (sentence) {
          const ttsStartTime = Date.now();

          try {
            // Synthesize this sentence
            const { audioBuffer, latencyMs: ttsLatency } = await synthesize(sentence, {
              voice: session.agent.voice,
            });

            if (!firstAudioSent) {
              const totalLatency = Date.now() - llmStartTime;
              logger.info(`⚡ First audio latency: ${totalLatency}ms`, { sessionId });
              firstAudioSent = true;
            }

            // Send audio to client
            if (session.onAudioResponse) {
              // Convert to mulaw if this is a phone call
              const outputAudio = session.agent.direction === 'browser'
                ? audioBuffer
                : wavToMulaw(audioBuffer);
              session.onAudioResponse(outputAudio, sentence);
            }

            session.onTextResponse?.(sentence, false);
          } catch (ttsErr) {
            logger.error('TTS failed for sentence', { error: ttsErr.message });
          }
        }
      }
    }

    // Synthesize any remaining text
    if (sentenceBuffer.trim()) {
      try {
        const { audioBuffer } = await synthesize(sentenceBuffer.trim(), {
          voice: session.agent.voice,
        });
        if (session.onAudioResponse) {
          session.onAudioResponse(audioBuffer, sentenceBuffer.trim());
        }
        session.onTextResponse?.(sentenceBuffer.trim(), true);
      } catch (ttsErr) {
        logger.error('TTS failed for remainder', { error: ttsErr.message });
      }
    }

    const totalLlmMs = Date.now() - llmStartTime;

    // Save assistant message
    session.conversationHistory.push({ role: 'assistant', content: fullResponse });
    await prisma.message.create({
      data: {
        callId: session.callId,
        role: 'assistant',
        content: fullResponse,
        llmMs: totalLlmMs,
      },
    });

    // Update metrics
    session.metrics.turnCount++;
    session.metrics.totalLlmMs += totalLlmMs;

    // Fire webhook if configured
    await fireWebhook(session.agent, 'turn.complete', {
      callId: session.callId,
      userText: fullText,
      assistantText: fullResponse,
      latencyMs: totalLlmMs,
    });

  } catch (err) {
    logger.error('Pipeline error', { sessionId, error: err.message });
  } finally {
    session.isProcessing = false;

    // Process pending text if any
    if (session.pendingText.trim()) {
      const pending = session.pendingText;
      session.pendingText = '';
      await handleTranscript(sessionId, pending, 'en');
    }
  }
}

/**
 * End a voice session
 */
export async function endSession(sessionId, reason = 'normal') {
  const session = activeSessions.get(sessionId);
  if (!session) return;

  // Close STT session
  session.sttSession?.close();

  // Calculate final metrics
  const durationMs = Date.now() - (session.startedAt || Date.now());

  // Update call record
  await prisma.call.update({
    where: { id: session.callId },
    data: {
      status: 'ended',
      endedAt: new Date(),
      durationMs,
      totalLatencyMs: session.metrics.totalLlmMs,
      costUsd: 0, // Self-hosted = FREE
    },
  });

  // Fire webhook
  await fireWebhook(session.agent, 'call.ended', {
    callId: session.callId,
    durationMs,
    turnCount: session.metrics.turnCount,
    reason,
  });

  // Notify client
  session.onSessionEnd?.(reason);

  // Cleanup
  activeSessions.delete(sessionId);
  logger.info(`Voice session ended: ${sessionId}`, { reason, durationMs });
}

/**
 * Get session by ID
 */
export function getSession(sessionId) {
  return activeSessions.get(sessionId);
}

/**
 * Get all active sessions
 */
export function getActiveSessions() {
  return Array.from(activeSessions.entries()).map(([id, session]) => ({
    id,
    agentName: session.agent.name,
    direction: session.agent.direction,
    turnCount: session.metrics.turnCount,
  }));
}

// =============================================
// HELPER FUNCTIONS
// =============================================

function buildSystemPrompt(agent) {
  let prompt = agent.systemPrompt;
  
  // Add voice-optimized instructions
  prompt += `\n\nIMPORTANT RULES FOR VOICE CONVERSATION:
- Keep responses SHORT and conversational (1-3 sentences max)
- Use natural speech patterns, contractions, and filler words sparingly
- Never use markdown, bullet points, or formatting
- Never say "as an AI" or similar disclaimers
- If transferring, say "Let me transfer you now"
- Speak in ${agent.language === 'en' ? 'English' : agent.language}`;

  if (agent.transferNumber) {
    prompt += `\n- You can transfer the caller to a human agent if needed. The transfer number is ${agent.transferNumber}`;
  }

  return prompt;
}

function findSentenceEnd(text) {
  // Find the end of the first complete sentence
  const endings = ['. ', '! ', '? ', '.\n', '!\n', '?\n'];
  let earliest = -1;

  for (const ending of endings) {
    const idx = text.indexOf(ending);
    if (idx !== -1 && (earliest === -1 || idx < earliest)) {
      earliest = idx + ending.length;
    }
  }

  // Also check for end of text with punctuation
  if (earliest === -1 && text.length > 0) {
    const lastChar = text[text.length - 1];
    if (['.', '!', '?'].includes(lastChar) && text.length > 10) {
      earliest = text.length;
    }
  }

  return earliest;
}

async function searchKnowledgeBase(agentId, query) {
  try {
    const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    if (keywords.length === 0) return null;

    const items = await prisma.knowledgeItem.findMany({
      where: {
        agentId,
        isActive: true,
        OR: keywords.map(kw => ({
          OR: [
            { question: { contains: kw } },
            { keywords: { contains: kw } },
            { answer: { contains: kw } },
          ],
        })),
      },
      orderBy: { priority: 'desc' },
      take: 3,
    });

    if (items.length === 0) return null;
    return items.map(i => `Q: ${i.question}\nA: ${i.answer}`).join('\n\n');
  } catch {
    return null;
  }
}

async function fireWebhook(agent, event, data) {
  if (!agent.webhookUrl) return;
  
  const events = agent.webhookEvents.split(',').map(e => e.trim());
  if (!events.includes(event)) return;

  try {
    await fetch(agent.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event,
        timestamp: new Date().toISOString(),
        agentId: agent.id,
        ...data,
      }),
    });
  } catch (err) {
    logger.error('Webhook delivery failed', { url: agent.webhookUrl, error: err.message });
  }
}
