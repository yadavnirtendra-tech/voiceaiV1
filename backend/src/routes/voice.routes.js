/**
 * VoiceForge AI - Voice API Routes
 * Handles browser WebSocket calls, Twilio webhooks, and voice management
 */
import { Router } from 'express';
import logger from '../utils/logger.js';
import prisma from '../db/prisma.js';
import config from '../config/env.js';
import {
  createSession,
  processTextInput,
  endSession,
  getActiveSessions,
} from '../services/voice/pipeline.service.js';
import {
  generateIncomingTwiml,
  handleStatusCallback,
  makeOutboundCall,
} from '../services/twilio/twilio.service.js';
import { synthesize, getVoices } from '../services/tts/kokoro.service.js';

const router = Router();

// ============================================
// TWILIO WEBHOOKS
// ============================================

/**
 * POST /api/voice/twilio/incoming
 * Twilio calls this when a phone call comes in
 * Returns TwiML to connect the call to our WebSocket stream
 */
router.post('/twilio/incoming', async (req, res) => {
  try {
    const { To, From, CallSid } = req.body;
    logger.info(`Incoming Twilio call: ${From} → ${To}`, { callSid: CallSid });

    // Find agent mapped to this phone number
    const phoneMapping = await prisma.phoneNumber.findFirst({
      where: { number: To, isActive: true },
      include: { agent: true },
    });

    const agentId = phoneMapping?.agentId;
    if (!agentId) {
      logger.warn(`No agent mapped to number: ${To}`);
      res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<Response><Say>Sorry, this number is not configured. Goodbye.</Say><Hangup/></Response>`);
      return;
    }

    // Generate TwiML with WebSocket stream URL
    const wsUrl = config.apiBaseUrl.replace('http', 'ws');
    const twiml = generateIncomingTwiml(agentId, wsUrl);

    res.type('text/xml').send(twiml);
  } catch (err) {
    logger.error('Twilio incoming handler error', { error: err.message });
    res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<Response><Say>An error occurred. Please try again later.</Say><Hangup/></Response>`);
  }
});

/**
 * POST /api/voice/twilio/status
 * Call status updates from Twilio
 */
router.post('/twilio/status', async (req, res) => {
  try {
    await handleStatusCallback(req.body);
    res.sendStatus(200);
  } catch (err) {
    logger.error('Status callback error', { error: err.message });
    res.sendStatus(200); // Always return 200 to Twilio
  }
});

/**
 * POST /api/voice/outbound
 * Initiate an outbound phone call
 */
router.post('/outbound', async (req, res) => {
  try {
    const { toNumber, agentId } = req.body;
    if (!toNumber || !agentId) {
      return res.status(400).json({ error: 'toNumber and agentId required' });
    }

    const call = await makeOutboundCall(toNumber, agentId);
    res.json({ success: true, callSid: call.sid });
  } catch (err) {
    logger.error('Outbound call error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// AGENT MANAGEMENT
// ============================================

/**
 * GET /api/voice/agents
 * List all voice agents
 */
router.get('/agents', async (req, res) => {
  try {
    const agents = await prisma.agent.findMany({
      include: {
        _count: { select: { calls: true, phoneNumbers: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ agents });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/voice/agents
 * Create a new voice agent
 */
router.post('/agents', async (req, res) => {
  try {
    const {
      name, systemPrompt, greeting, voice, language,
      llmModel, temperature, maxTokens, interruptible,
      silenceTimeout, endCallPhrases, transferNumber,
      webhookUrl, webhookEvents,
    } = req.body;

    if (!name) return res.status(400).json({ error: 'Agent name is required' });

    const agent = await prisma.agent.create({
      data: {
        name,
        ...(systemPrompt && { systemPrompt }),
        ...(greeting && { greeting }),
        ...(voice && { voice }),
        ...(language && { language }),
        ...(llmModel && { llmModel }),
        ...(temperature !== undefined && { temperature }),
        ...(maxTokens && { maxTokens }),
        ...(interruptible !== undefined && { interruptible }),
        ...(silenceTimeout && { silenceTimeout }),
        ...(endCallPhrases && { endCallPhrases }),
        ...(transferNumber && { transferNumber }),
        ...(webhookUrl && { webhookUrl }),
        ...(webhookEvents && { webhookEvents }),
      },
    });

    res.status(201).json({ agent });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/voice/agents/:id
 * Update an agent
 */
router.put('/agents/:id', async (req, res) => {
  try {
    const agent = await prisma.agent.update({
      where: { id: req.params.id },
      data: req.body,
    });
    res.json({ agent });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/voice/agents/:id
 * Delete an agent
 */
router.delete('/agents/:id', async (req, res) => {
  try {
    await prisma.agent.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// CALLS & ANALYTICS
// ============================================

/**
 * GET /api/voice/calls
 * List calls with pagination
 */
router.get('/calls', async (req, res) => {
  try {
    const { page = 1, limit = 50, agentId, status } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    if (agentId) where.agentId = agentId;
    if (status) where.status = status;

    const [calls, total] = await Promise.all([
      prisma.call.findMany({
        where,
        include: {
          agent: { select: { name: true } },
          _count: { select: { messages: true } },
        },
        orderBy: { startedAt: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.call.count({ where }),
    ]);

    res.json({ calls, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/voice/calls/:id
 * Get call details with full transcript
 */
router.get('/calls/:id', async (req, res) => {
  try {
    const call = await prisma.call.findUnique({
      where: { id: req.params.id },
      include: {
        agent: true,
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!call) return res.status(404).json({ error: 'Call not found' });
    res.json({ call });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/voice/analytics
 * Dashboard analytics
 */
router.get('/analytics', async (req, res) => {
  try {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const thisWeek = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [totalCalls, todayCalls, weekCalls, activeCalls, avgLatency, totalMinutes, agents] = await Promise.all([
      prisma.call.count(),
      prisma.call.count({ where: { startedAt: { gte: today } } }),
      prisma.call.count({ where: { startedAt: { gte: thisWeek } } }),
      prisma.call.count({ where: { status: 'active' } }),
      prisma.call.aggregate({ _avg: { totalLatencyMs: true } }),
      prisma.call.aggregate({ _sum: { durationMs: true } }),
      prisma.agent.count(),
    ]);

    const totalMinutesVal = Math.round((totalMinutes._sum.durationMs || 0) / 60000);

    res.json({
      totalCalls,
      todayCalls,
      weekCalls,
      activeCalls: getActiveSessions().length,
      avgLatencyMs: Math.round(avgLatency._avg.totalLatencyMs || 0),
      totalMinutes: totalMinutesVal,
      totalAgents: agents,
      costUsd: 0, // Always free - self-hosted!
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// TTS VOICES
// ============================================

/**
 * GET /api/voice/voices
 * List available TTS voices
 */
router.get('/voices', async (req, res) => {
  try {
    const voices = await getVoices();
    res.json({ voices });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/voice/tts/preview
 * Preview a voice with custom text
 */
router.post('/tts/preview', async (req, res) => {
  try {
    const { text, voice } = req.body;
    if (!text) return res.status(400).json({ error: 'text is required' });

    const { audioBuffer, latencyMs } = await synthesize(text, { voice });

    res.set({
      'Content-Type': 'audio/wav',
      'Content-Length': audioBuffer.length,
      'X-Latency-Ms': latencyMs.toString(),
    });
    res.send(audioBuffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// KNOWLEDGE BASE
// ============================================

/**
 * GET /api/voice/knowledge/:agentId
 * Get knowledge items for an agent
 */
router.get('/knowledge/:agentId', async (req, res) => {
  try {
    const items = await prisma.knowledgeItem.findMany({
      where: { agentId: req.params.agentId },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    });
    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/voice/knowledge
 * Add a knowledge item
 */
router.post('/knowledge', async (req, res) => {
  try {
    const { agentId, category, question, answer, keywords, priority } = req.body;
    if (!agentId || !question || !answer) {
      return res.status(400).json({ error: 'agentId, question, and answer are required' });
    }

    const item = await prisma.knowledgeItem.create({
      data: { agentId, category, question, answer, keywords, priority },
    });
    res.status(201).json({ item });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/voice/knowledge/:id
 * Delete a knowledge item
 */
router.delete('/knowledge/:id', async (req, res) => {
  try {
    await prisma.knowledgeItem.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// PHONE NUMBER MANAGEMENT
// ============================================

/**
 * GET /api/voice/phones
 */
router.get('/phones', async (req, res) => {
  try {
    const numbers = await prisma.phoneNumber.findMany({
      include: { agent: { select: { name: true } } },
    });
    res.json({ numbers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/voice/phones
 */
router.post('/phones', async (req, res) => {
  try {
    const { number, agentId, label } = req.body;
    if (!number || !agentId) {
      return res.status(400).json({ error: 'number and agentId required' });
    }

    const phone = await prisma.phoneNumber.create({
      data: { number, agentId, label },
    });
    res.status(201).json({ phone });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/voice/phones/:id
 */
router.delete('/phones/:id', async (req, res) => {
  try {
    await prisma.phoneNumber.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
