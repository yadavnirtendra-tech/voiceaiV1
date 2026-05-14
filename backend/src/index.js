/**
 * OpenCalendar - Main Entry Point
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
import adminRoutes from './routes/admin.routes.js';
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
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdn.jsdelivr.net"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      imgSrc: ["'self'", "data:", "https:", "https://www.gstatic.com"],
      connectSrc: ["'self'", "https://autocalender-production.up.railway.app", "https://opencalender.site"],
    },
  },
}));
app.use(cors({
  origin: config.nodeEnv === 'production' 
    ? [config.frontendUrl, config.apiBaseUrl]
    : [config.frontendUrl, 'http://localhost:3000', 'http://localhost:5173'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
}));
app.use(morgan('short', {
  stream: { write: (message) => logger.info(message.trim()) },
}));
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ============ API Routes ============
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
app.use('/api/admin', adminRoutes);

// Root route for sanity check
app.get('/', (req, res) => {
  res.send(`
    <body style="font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; background: #0a0e1a; color: #fff; margin: 0;">
      <div style="text-align: center; padding: 40px; background: #111827; border-radius: 16px; border: 1px solid rgba(99, 102, 241, 0.2); box-shadow: 0 20px 50px rgba(0,0,0,0.5);">
        <h1 style="color: #6366f1;">🚀 OpenCalendar Backend</h1>
        <p style="color: #94a3b8;">Status: <span style="color: #10b981;">Online & Secure</span></p>
        <p style="font-size: 0.9rem; color: #64748b;">The API is functioning correctly. Access the dashboard via your frontend URL.</p>
      </div>
    </body>
  `);
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'OpenCalendar API',
    environment: config.nodeEnv,
    timestamp: new Date().toISOString(),
    uptime: `${Math.floor(process.uptime())}s`,
  });
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
  logger.info(`🚀 OpenCalendar running on port ${config.port}`);
  logger.info(`📊 Dashboard: ${config.apiBaseUrl}`);
  logger.info(`🔗 Google OAuth: ${config.apiBaseUrl}/api/auth/google`);
  logger.info(`🔗 Microsoft OAuth: ${config.apiBaseUrl}/api/auth/microsoft`);
  logger.info(`📡 Google Webhook: ${config.apiBaseUrl}/api/webhook/google`);
  logger.info(`📡 Microsoft Webhook: ${config.apiBaseUrl}/api/webhook/microsoft`);
});

export default app;
