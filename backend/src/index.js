/**
 * VoiceForge AI - Main Entry Point
 * Self-hosted Voice AI platform with local LLM, STT, TTS
 * Zero cost. Unlimited minutes. Natural human voice.
 */
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { URL } from 'url';
import path from 'path';
import { fileURLToPath } from 'url';

import config from './config/env.js';
import logger from './utils/logger.js';
import voiceRoutes from './routes/voice.routes.js';
import healthRoutes from './routes/health.routes.js';
import { handleMediaStream } from './services/twilio/twilio.service.js';
import {
  createSession,
  processTextInput,
  processAudioChunk,
  endSession,
  getActiveSessions,
} from './services/voice/pipeline.service.js';
import { warmupModel } from './services/llm/ollama.service.js';
import { synthesize, wavToMulaw } from './services/tts/kokoro.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);

// ============ Trust Proxy ============
app.set('trust proxy', 1);

// ============ Middleware ============
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdn.jsdelivr.net"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "ws://localhost:*", "wss://localhost:*", config.apiBaseUrl],
      mediaSrc: ["'self'", "blob:", "data:"],
    },
  },
}));
app.use(cors({
  origin: config.nodeEnv === 'production'
    ? [config.frontendUrl, config.apiBaseUrl]
    : true,
  credentials: true,
}));
app.use(morgan('short', {
  stream: { write: (message) => logger.info(message.trim()) },
}));
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ============ Static Frontend ============
app.use(express.static(path.join(__dirname, '../../frontend/public')));

// ============ API Routes ============
app.use('/api/voice', voiceRoutes);
app.use('/api/health', healthRoutes);

// Root redirect to dashboard
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../../frontend/public/index.html'));
});

// ============ Error Handler ============
app.use((err, req, res, next) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack, path: req.path });
  res.status(err.statusCode || 500).json({
    success: false,
    error: config.nodeEnv === 'production' ? 'Internal server error' : err.message,
  });
});

// ============ WebSocket Server ============
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;

  if (pathname === '/api/voice/twilio/stream') {
    // Twilio media stream
    wss.handleUpgrade(request, socket, head, (ws) => {
      handleMediaStream(ws, request);
    });
  } else if (pathname === '/api/voice/browser') {
    // Browser WebRTC/WebSocket voice session
    wss.handleUpgrade(request, socket, head, (ws) => {
      handleBrowserVoiceSession(ws, request);
    });
  } else {
    socket.destroy();
  }
});

/**
 * Handle browser-based voice sessions
 * Protocol: JSON messages over WebSocket
 */
async function handleBrowserVoiceSession(ws, request) {
  let session = null;

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());

      switch (msg.type) {
        case 'start': {
          // Start a new voice session
          const { agentId } = msg;
          if (!agentId) {
            ws.send(JSON.stringify({ type: 'error', message: 'agentId required' }));
            return;
          }

          session = await createSession({
            agentId,
            direction: 'browser',
          });

          // Set up callbacks
          session.onAudioResponse = (audioBuffer, text) => {
            // Send audio as binary frame
            if (ws.readyState === 1) {
              ws.send(audioBuffer);
            }
          };

          session.onTextResponse = (text, isFinal) => {
            if (ws.readyState === 1) {
              ws.send(JSON.stringify({
                type: 'assistant_text',
                text,
                isFinal,
              }));
            }
          };

          session.onTranscript = (data) => {
            if (ws.readyState === 1) {
              ws.send(JSON.stringify({
                type: 'transcript',
                ...data,
              }));
            }
          };

          session.onSessionEnd = (reason) => {
            if (ws.readyState === 1) {
              ws.send(JSON.stringify({ type: 'session_ended', reason }));
            }
          };

          // Send session info
          ws.send(JSON.stringify({
            type: 'session_started',
            sessionId: session.id,
            agent: {
              name: session.agent.name,
              voice: session.agent.voice,
              greeting: session.agent.greeting,
            },
          }));

          // Send greeting audio
          try {
            const { audioBuffer } = await synthesize(session.agent.greeting, {
              voice: session.agent.voice,
            });
            ws.send(audioBuffer);
            ws.send(JSON.stringify({
              type: 'assistant_text',
              text: session.agent.greeting,
              isFinal: true,
            }));
          } catch (err) {
            logger.error('Failed to send greeting', { error: err.message });
          }
          break;
        }

        case 'text': {
          // Text input from browser (user typed or Web Speech API result)
          if (session && msg.text) {
            await processTextInput(session.id, msg.text);
          }
          break;
        }

        case 'audio': {
          // Audio chunk from browser (PCM16 or mulaw)
          if (session && msg.data) {
            const audioBuffer = Buffer.from(msg.data, 'base64');
            await processAudioChunk(session.id, audioBuffer, msg.format || 'pcm16');
          }
          break;
        }

        case 'end': {
          if (session) {
            await endSession(session.id, 'user_ended');
          }
          break;
        }
      }
    } catch (err) {
      logger.error('Browser WebSocket message error', { error: err.message });
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'error', message: err.message }));
      }
    }
  });

  ws.on('close', async () => {
    if (session) {
      await endSession(session.id, 'browser_disconnected');
    }
  });

  ws.on('error', (err) => {
    logger.error('Browser WebSocket error', { error: err.message });
  });
}

// ============ Start Server ============
server.listen(config.port, async () => {
  logger.info('');
  logger.info('╔══════════════════════════════════════════════════╗');
  logger.info('║         🎙️  VoiceForge AI - Running            ║');
  logger.info('║         Zero-Cost Self-Hosted Voice AI          ║');
  logger.info('╚══════════════════════════════════════════════════╝');
  logger.info('');
  logger.info(`🌐 Dashboard:    ${config.apiBaseUrl}`);
  logger.info(`📡 Voice WS:     ws://localhost:${config.port}/api/voice/browser`);
  logger.info(`📞 Twilio WS:    ws://localhost:${config.port}/api/voice/twilio/stream`);
  logger.info(`🔧 Health:       ${config.apiBaseUrl}/api/health`);
  logger.info('');
  logger.info(`🧠 LLM:  Ollama @ ${config.ollamaBaseUrl} (${config.ollamaModel})`);
  logger.info(`🗣️  TTS:  Kokoro @ ${config.kokoroTtsUrl} (${config.kokoroVoice})`);
  logger.info(`👂 STT:  Whisper @ ${config.whisperSttUrl} (${config.whisperModel})`);
  logger.info(`📞 Twilio: ${config.twilioEnabled ? 'Configured ✅' : 'Not configured (phone calls disabled)'}`);
  logger.info('');

  // Warm up LLM model
  warmupModel().catch(() => {});
});

export default app;
