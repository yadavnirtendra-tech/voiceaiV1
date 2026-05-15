/**
 * VoiceForge AI - Twilio Voice Integration
 * Handles inbound/outbound phone calls via Twilio Media Streams
 * Bidirectional WebSocket for real-time voice AI
 */
import config from '../../config/env.js';
import logger from '../../utils/logger.js';
import { createSession, processAudioChunk, endSession, getSession } from '../voice/pipeline.service.js';
import { wavToMulaw } from '../tts/kokoro.service.js';

/**
 * Generate TwiML for incoming calls
 * Connects the call to our WebSocket media stream
 */
export function generateIncomingTwiml(agentId, wsUrl) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${wsUrl}/api/voice/twilio/stream" statusCallback="${wsUrl}/api/voice/twilio/status">
      <Parameter name="agentId" value="${agentId}" />
    </Stream>
  </Connect>
</Response>`;
}

/**
 * Generate TwiML for outbound calls
 */
export function generateOutboundTwiml(agentId, wsUrl) {
  return generateIncomingTwiml(agentId, wsUrl);
}

/**
 * Make an outbound call via Twilio
 */
export async function makeOutboundCall(toNumber, agentId) {
  if (!config.twilioEnabled) {
    throw new Error('Twilio is not configured');
  }

  const twilio = (await import('twilio')).default;
  const client = twilio(config.twilioAccountSid, config.twilioAuthToken);

  const wsUrl = config.apiBaseUrl.replace('http', 'ws');

  const call = await client.calls.create({
    to: toNumber,
    from: config.twilioPhoneNumber,
    twiml: generateOutboundTwiml(agentId, wsUrl),
    statusCallback: `${config.apiBaseUrl}/api/voice/twilio/status`,
    statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
  });

  logger.info(`Outbound call initiated: ${call.sid}`, { to: toNumber, agentId });
  return call;
}

/**
 * Handle Twilio Media Stream WebSocket connection
 * This is where the real-time voice processing happens
 */
export async function handleMediaStream(ws, req) {
  let session = null;
  let streamSid = null;

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());

      switch (msg.event) {
        case 'connected':
          logger.info('Twilio media stream connected');
          break;

        case 'start':
          streamSid = msg.start.streamSid;
          const agentId = msg.start.customParameters?.agentId;
          const callSid = msg.start.callSid;

          logger.info(`Twilio stream started: ${streamSid}`, { callSid, agentId });

          if (!agentId) {
            logger.error('No agentId in Twilio stream parameters');
            ws.close();
            return;
          }

          // Create voice session
          session = await createSession({
            agentId,
            direction: 'inbound',
            callerNumber: msg.start.from,
            calledNumber: msg.start.to,
            twilioCallSid: callSid,
          });

          // Set up audio response callback - sends audio back to Twilio
          session.onAudioResponse = (audioBuffer, text) => {
            sendAudioToTwilio(ws, streamSid, audioBuffer);
          };

          session.onSessionEnd = (reason) => {
            ws.close();
          };

          // Send greeting
          const { synthesize: synthGreeting } = await import('../tts/kokoro.service.js');
          try {
            const { audioBuffer } = await synthGreeting(session.agent.greeting, {
              voice: session.agent.voice,
            });
            sendAudioToTwilio(ws, streamSid, wavToMulaw(audioBuffer));
          } catch (err) {
            logger.error('Failed to send greeting', { error: err.message });
          }
          break;

        case 'media':
          if (!session) return;

          // Decode base64 mulaw audio from Twilio
          const audioChunk = Buffer.from(msg.media.payload, 'base64');
          
          // Process through voice pipeline
          await processAudioChunk(session.id, audioChunk, 'mulaw');
          break;

        case 'mark':
          // Audio playback marker acknowledged by Twilio
          logger.debug(`Mark received: ${msg.mark.name}`);
          break;

        case 'stop':
          logger.info('Twilio stream stopped');
          if (session) {
            await endSession(session.id, 'twilio_stream_ended');
          }
          break;
      }
    } catch (err) {
      logger.error('Twilio WebSocket message error', { error: err.message });
    }
  });

  ws.on('close', async () => {
    if (session) {
      await endSession(session.id, 'twilio_disconnected');
    }
  });

  ws.on('error', (err) => {
    logger.error('Twilio WebSocket error', { error: err.message });
  });
}

/**
 * Send audio back to Twilio via the media stream WebSocket
 * Audio must be base64-encoded mulaw/8000
 */
function sendAudioToTwilio(ws, streamSid, mulawBuffer) {
  if (ws.readyState !== 1) return;

  // Twilio expects chunks of ~20ms (160 samples at 8kHz)
  const CHUNK_SIZE = 160;
  let offset = 0;
  let markId = 0;

  // Send clear event first to interrupt any playing audio
  ws.send(JSON.stringify({
    event: 'clear',
    streamSid,
  }));

  while (offset < mulawBuffer.length) {
    const chunk = mulawBuffer.slice(offset, offset + CHUNK_SIZE);
    
    ws.send(JSON.stringify({
      event: 'media',
      streamSid,
      media: {
        payload: chunk.toString('base64'),
      },
    }));

    offset += CHUNK_SIZE;
  }

  // Send a mark to know when audio finishes playing
  ws.send(JSON.stringify({
    event: 'mark',
    streamSid,
    mark: {
      name: `response_${Date.now()}_${markId++}`,
    },
  }));
}

/**
 * Handle call status webhook from Twilio
 */
export async function handleStatusCallback(body) {
  const { CallSid, CallStatus, CallDuration } = body;
  logger.info(`Twilio call status: ${CallStatus}`, { callSid: CallSid });

  if (CallStatus === 'completed' || CallStatus === 'failed' || CallStatus === 'canceled') {
    // Find and end the session
    // Session cleanup happens in the media stream handler
  }
}
