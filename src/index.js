/**
 * CalendarSync AI - Main Entry Point
 * Express server with webhook listeners and cron jobs
 */
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import cron from 'node-cron';
import path from 'path';
import { fileURLToPath } from 'url';

import config from './config/env.js';
import logger from './utils/logger.js';
import authRoutes from './routes/auth.routes.js';
import webhookRoutes from './routes/webhook.routes.js';
import calendarRoutes from './routes/calendar.routes.js';
import { renewExpiringWebhooks as renewGoogleWebhooks } from './services/google/webhook.service.js';
import { renewExpiringWebhooks as renewMicrosoftWebhooks } from './services/microsoft/webhook.service.js';
import rateLimit from 'express-rate-limit';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// ============ Trust Proxy for Railway/Cloudflare ============
app.set('trust proxy', 1);

// ============ Middleware ============
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
    },
  },
}));
app.use(cors({
  origin: config.nodeEnv === 'production' 
    ? [config.frontendUrl, /\.vercel\.app$/] 
    : [config.frontendUrl, 'http://localhost:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
}));
app.use(morgan('short', {
  stream: { write: (message) => logger.info(message.trim()) },
}));
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ============ Static Files (Dashboard) ============
app.use(express.static(path.join(__dirname, '..', 'public')));

// ============ Rate Limiting ============
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per `window` (here, per 15 minutes)
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  message: { error: 'Too many requests from this IP, please try again after 15 minutes' }
});

// Apply the rate limiting middleware to API calls
app.use('/api/', apiLimiter);

// ============ API Routes ============
app.use('/api/auth', authRoutes);
app.use('/api/webhook', webhookRoutes);
app.use('/api/calendar', calendarRoutes);
app.use('/api/user', calendarRoutes);  // User routes are in the same file
app.use('/api/dashboard', calendarRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'CalendarSync AI',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// SPA fallback
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  }
});

// ============ Error Handler ============
app.use((err, req, res, next) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack, path: req.path });
  
  const isProduction = config.nodeEnv === 'production';
  const statusCode = err.statusCode || 500;
  
  res.status(statusCode).json({ 
    success: false,
    error: isProduction ? 'Internal server error' : err.message,
    ...(isProduction ? {} : { stack: err.stack })
  });
});

// ============ Cron Jobs ============
// Renew webhooks every hour
cron.schedule('0 * * * *', async () => {
  logger.info('Running webhook renewal cron');
  try {
    await renewGoogleWebhooks();
    await renewMicrosoftWebhooks();
  } catch (error) {
    logger.error('Webhook renewal cron failed', { error: error.message });
  }
});

// ============ Start Server ============
app.listen(config.port, () => {
  logger.info(`🚀 CalendarSync AI running on port ${config.port}`);
  logger.info(`📊 Dashboard: ${config.apiBaseUrl}`);
  logger.info(`🔗 Google OAuth: ${config.apiBaseUrl}/api/auth/google`);
  logger.info(`🔗 Microsoft OAuth: ${config.apiBaseUrl}/api/auth/microsoft`);
  logger.info(`📡 Google Webhook: ${config.apiBaseUrl}/api/webhook/google`);
  logger.info(`📡 Microsoft Webhook: ${config.apiBaseUrl}/api/webhook/microsoft`);
});

export default app;
