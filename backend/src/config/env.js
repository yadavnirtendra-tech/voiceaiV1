import dotenv from 'dotenv';

dotenv.config();

const requiredEnvVars = [
  'DATABASE_URL',
  'JWT_SECRET',
  'ENCRYPTION_KEY',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'MICROSOFT_CLIENT_ID',
  'MICROSOFT_CLIENT_SECRET'
];

if (process.env.NODE_ENV === 'production') {
  const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);
  if (missingEnvVars.length > 0) {
    console.error(`[FATAL] Missing required environment variables: ${missingEnvVars.join(', ')}`);
    process.exit(1);
  }
}

const config = {
  // Server
  port: parseInt(process.env.PORT || '3000'),
  nodeEnv: process.env.NODE_ENV || 'development',
  apiBaseUrl: process.env.API_BASE_URL || 'http://localhost:3000',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',

  // JWT
  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret-change-me',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },

  // Encryption
  encryption: {
    key: process.env.ENCRYPTION_KEY || 'a'.repeat(64), // 32 bytes hex
  },

  // Google OAuth
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    redirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/auth/google/callback',
    scopes: [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
    ],
  },

  // Microsoft OAuth
  microsoft: {
    clientId: process.env.MICROSOFT_CLIENT_ID || '',
    clientSecret: process.env.MICROSOFT_CLIENT_SECRET || '',
    tenantId: process.env.MICROSOFT_TENANT_ID || 'common',
    redirectUri: process.env.MICROSOFT_REDIRECT_URI || 'http://localhost:3000/api/auth/microsoft/callback',
    scopes: [
      'Calendars.ReadWrite',
      'User.Read',
      'offline_access',
    ],
  },

  // Webhook
  webhook: {
    secret: process.env.WEBHOOK_SECRET || 'webhook-secret',
    googleUrl: process.env.GOOGLE_WEBHOOK_URL || 'http://localhost:3000/api/webhook/google',
    microsoftUrl: process.env.MICROSOFT_WEBHOOK_URL || 'http://localhost:3000/api/webhook/microsoft',
  },

  // Sync Engine
  sync: {
    originTag: process.env.SYNC_ORIGIN_TAG || 'calendarsync-ai-system',
    shadowBlockTitle: process.env.SHADOW_BLOCK_TITLE || 'Reserved (CalendarSync)',
    maxRetries: parseInt(process.env.MAX_SYNC_RETRIES || '3'),
    retryDelayMs: parseInt(process.env.SYNC_RETRY_DELAY_MS || '1000'),
  },
};

export default config;
