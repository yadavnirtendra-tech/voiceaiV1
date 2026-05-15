/**
 * Authentication Routes
 * OAuth connect/callback for Google and Microsoft
 * Uses Prisma/PostgreSQL for all database operations
 */
import { Router } from 'express';
import crypto from 'crypto';
import { authenticate, generateToken, optionalAuth } from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimiter.js';
import * as googleAuth from '../services/google/auth.service.js';
import * as msAuth from '../services/microsoft/auth.service.js';
import * as googleWebhook from '../services/google/webhook.service.js';
import * as msWebhook from '../services/microsoft/webhook.service.js';
import { fullSync } from '../services/sync/engine.js';
import { users, identities, webhookSubscriptions, shadowBlocks } from '../db/index.js';
import bcrypt from 'bcryptjs';
import config from '../config/env.js';
import logger from '../utils/logger.js';

const router = Router();

// ============ Validation Helpers ============
const EMAIL_REGEX = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;
const MIN_PASSWORD_LENGTH = 8;

function sanitizeHtml(str) {
  if (!str) return '';
  return str.replace(/[<>"'&]/g, (char) => {
    const map = { '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '&': '&amp;' };
    return map[char];
  });
}

function validateRegistration(email, password, displayName) {
  const errors = [];
  if (!email || !password) errors.push('Email and password are required');
  if (email && !EMAIL_REGEX.test(email)) errors.push('Invalid email format');
  if (password && password.length < MIN_PASSWORD_LENGTH) errors.push(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  if (password && !/[A-Z]/.test(password)) errors.push('Password must contain at least one uppercase letter');
  if (password && !/[0-9]/.test(password)) errors.push('Password must contain at least one number');
  return errors;
}

/** Generate HMAC-signed OAuth state to prevent CSRF */
function createSignedState(data) {
  const payload = Buffer.from(JSON.stringify(data)).toString('base64');
  const signature = crypto.createHmac('sha256', config.jwt.secret).update(payload).digest('hex');
  return `${payload}.${signature}`;
}

/** Verify and parse HMAC-signed OAuth state */
function verifySignedState(state) {
  const [payload, signature] = state.split('.');
  if (!payload || !signature) return null;
  const expected = crypto.createHmac('sha256', config.jwt.secret).update(payload).digest('hex');
  if (!crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'))) return null;
  try {
    return JSON.parse(Buffer.from(payload, 'base64').toString());
  } catch { return null; }
}

// ============ Traditional Auth ============

/** POST /api/auth/register - Create new account */
router.post('/register', authLimiter, async (req, res) => {
  try {
    const { getPlatformSettings } = await import('../utils/platformSettings.js');
    if (getPlatformSettings().systemLockdown) {
      return res.status(403).json({ error: 'SYSTEM LOCKDOWN: New registrations are currently disabled by the Super Admin.' });
    }

    const { email, password, displayName } = req.body;

    const validationErrors = validateRegistration(email, password, displayName);
    if (validationErrors.length > 0) {
      return res.status(400).json({ error: validationErrors[0], details: validationErrors });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const safeName = sanitizeHtml((displayName || normalizedEmail.split('@')[0]).trim());

    const existingUser = await users.findByEmail(normalizedEmail);
    if (existingUser) {
      return res.status(400).json({ error: 'Email already in use' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await users.create({
      email: normalizedEmail,
      passwordHash,
      displayName: safeName,
      plan: 'PRO',
    });

    const token = generateToken(user.id);
    res.cookie('auth_token', token, { 
      httpOnly: true, 
      secure: config.nodeEnv === 'production', 
      sameSite: config.nodeEnv === 'production' ? 'None' : 'Lax', 
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/'
    });

    res.status(201).json({ success: true, user: { id: user.id, email: user.email, displayName: user.displayName } });
  } catch (error) {
    logger.error('Registration failed', { error: error.message, stack: error.stack, email: req.body?.email });
    res.status(500).json({ error: 'Registration failed. Please try again later.' });
  }
});

/** POST /api/auth/login - Existing account login */
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    if (!EMAIL_REGEX.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const user = await users.findByEmail(normalizedEmail);
    if (!user || !user.passwordHash) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = generateToken(user.id);
    res.cookie('auth_token', token, { 
      httpOnly: true, 
      secure: config.nodeEnv === 'production', 
      sameSite: config.nodeEnv === 'production' ? 'None' : 'Lax', 
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/'
    });

    res.json({ 
      success: true, 
      user: { id: user.id, email: user.email, displayName: user.displayName } 
    });
  } catch (error) {
    logger.error('Login failed', { error: error.message });
    res.status(500).json({ error: 'Login failed' });
  }
});

// ============ Google OAuth ============

/** GET /api/auth/google - Start Google OAuth flow */
router.get('/google', authLimiter, optionalAuth, async (req, res) => {
  try {
    const userId = req.user?.id || null;
    const state = createSignedState({ userId, provider: 'google', timestamp: Date.now() });
    const authUrl = googleAuth.getAuthUrl(state);
    res.redirect(authUrl);
  } catch (error) {
    logger.error('Google auth init failed', { error: error.message });
    res.redirect(`${config.frontendUrl}?error=auth_failed`);
  }
});

/** GET /api/auth/google/callback - Google OAuth callback */
router.get('/google/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code || !state) return res.redirect(`${config.frontendUrl}?error=missing_params`);

    const stateData = verifySignedState(state);
    if (!stateData) {
      logger.warn('Google callback: invalid or tampered state parameter');
      return res.redirect(`${config.frontendUrl}?error=invalid_state`);
    }

    // Reject states older than 10 minutes
    if (Date.now() - stateData.timestamp > 10 * 60 * 1000) {
      return res.redirect(`${config.frontendUrl}?error=state_expired`);
    }

    let userId = stateData.userId;
    let identity;
    
    // If no user ID, this is a new sign-up or sign-in with Google
    if (!userId) {
      // We'll get the user info from Google in handleCallback
      const tempIdentity = await googleAuth.handleCallback(code, null);
      
      // Check if user already exists by email
      let user = await users.findByEmail(tempIdentity.providerEmail);
      if (!user) {
        const { getPlatformSettings } = await import('../utils/platformSettings.js');
        if (getPlatformSettings().systemLockdown) {
          // Rollback identity
          await identities.delete(tempIdentity.id);
          return res.redirect(`${config.frontendUrl}?error=system_lockdown`);
        }
        // Create new user
        user = await users.create({
          email: tempIdentity.providerEmail,
          displayName: tempIdentity.providerEmail.split('@')[0],
          plan: 'PRO',
        });
      }
      userId = user.id;
      
      // Link identity to the found/created user
      identity = await identities.update(tempIdentity.id, { userId });
    } else {
      identity = await googleAuth.handleCallback(code, userId);
    }

    // Register webhook for real-time sync
    try { await googleWebhook.registerWebhook(identity); } catch (e) { logger.warn('Webhook registration deferred', { error: e.message }); }

    // Trigger initial full sync
    fullSync(userId).catch(e => logger.error('Initial sync failed', { error: e.message }));

    // Generate JWT and set cookie
    const token = generateToken(userId);
    res.cookie('auth_token', token, { 
      httpOnly: true, 
      secure: config.nodeEnv === 'production', 
      sameSite: config.nodeEnv === 'production' ? 'None' : 'Lax', 
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/'
    });
    res.redirect(`${config.frontendUrl}?connected=google&success=true`);
  } catch (error) {
    logger.error('Google callback failed', { error: error.message });
    res.redirect(`${config.frontendUrl}?error=callback_failed`);
  }
});

// ============ Microsoft OAuth ============

/** GET /api/auth/microsoft - Start Microsoft OAuth flow */
router.get('/microsoft', authLimiter, optionalAuth, async (req, res) => {
  try {
    const userId = req.user?.id || null;
    const state = createSignedState({ userId, provider: 'microsoft', timestamp: Date.now() });
    const authUrl = await msAuth.getAuthUrl(state);
    res.redirect(authUrl);
  } catch (error) {
    logger.error('Microsoft auth init failed', { error: error.message });
    res.redirect(`${config.frontendUrl}?error=auth_failed`);
  }
});

/** GET /api/auth/microsoft/callback */
router.get('/microsoft/callback', async (req, res) => {
  try {
    const { code, state, error, error_description } = req.query;
    
    if (error) {
      logger.error('Microsoft OAuth error from Azure', { error, error_description });
      return res.redirect(`${config.frontendUrl}?error=${encodeURIComponent(error_description || error)}`);
    }

    if (!code || !state) return res.redirect(`${config.frontendUrl}?error=missing_params`);

    const stateData = verifySignedState(state);
    if (!stateData) {
      logger.warn('Microsoft callback: invalid or tampered state parameter');
      return res.redirect(`${config.frontendUrl}?error=invalid_state`);
    }

    // Reject states older than 10 minutes
    if (Date.now() - stateData.timestamp > 10 * 60 * 1000) {
      return res.redirect(`${config.frontendUrl}?error=state_expired`);
    }

    let userId = stateData.userId;
    let identity;

    if (!userId) {
      const tempIdentity = await msAuth.handleCallback(code, null);
      let user = await users.findByEmail(tempIdentity.providerEmail);
      if (!user) {
        const { getPlatformSettings } = await import('../utils/platformSettings.js');
        if (getPlatformSettings().systemLockdown) {
          // Rollback identity
          await identities.delete(tempIdentity.id);
          return res.redirect(`${config.frontendUrl}?error=system_lockdown`);
        }
        user = await users.create({
          email: tempIdentity.providerEmail,
          displayName: tempIdentity.providerEmail.split('@')[0],
          plan: 'PRO',
        });
      }
      userId = user.id;
      identity = await identities.update(tempIdentity.id, { userId });
    } else {
      identity = await msAuth.handleCallback(code, userId);
    }

    try { await msWebhook.registerWebhook(identity); } catch (e) { logger.warn('MS Webhook registration deferred', { error: e.message }); }
    fullSync(userId).catch(e => logger.error('Initial sync failed', { error: e.message }));

    const token = generateToken(userId);
    res.cookie('auth_token', token, { 
      httpOnly: true, 
      secure: config.nodeEnv === 'production', 
      sameSite: config.nodeEnv === 'production' ? 'None' : 'Lax', 
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/'
    });
    res.redirect(`${config.frontendUrl}?connected=microsoft&success=true`);
  } catch (error) {
    logger.error('Microsoft callback failed', { error: error.message, stack: error.stack });
    res.redirect(`${config.frontendUrl}?error=${encodeURIComponent('Connection failed. Please try again.')}`);
  }
});

// ============ Disconnect ============

/** POST /api/auth/disconnect/:identityId */
router.post('/disconnect/:identityId', authenticate, async (req, res) => {
  try {
    const identity = await identities.findById(req.params.identityId);
    if (!identity || identity.userId !== req.user.id) {
      return res.status(404).json({ error: 'Identity not found' });
    }

    await identities.update(identity.id, { isActive: false });
    
    // Deactivate webhooks
    await webhookSubscriptions.deactivateByIdentity(identity.id);
    
    // Cancel active shadow blocks from this identity
    await shadowBlocks.cancelBySourceIdentity(identity.id);

    res.json({ success: true, message: `${identity.providerEmail} disconnected` });
  } catch (error) {
    logger.error('Disconnect failed', { error: error.message });
    res.status(500).json({ error: 'Failed to disconnect' });
  }
});

router.post('/logout', (req, res) => {
  res.clearCookie('auth_token', { 
    httpOnly: true, 
    secure: config.nodeEnv === 'production', 
    sameSite: 'lax',
    path: '/' 
  });
  res.json({ success: true, message: 'Logged out' });
});

/** GET /api/auth/status */
router.get('/status', optionalAuth, (req, res) => {
  res.json({ authenticated: !!req.user, user: req.user || null });
});

/** POST /api/auth/forgot-password - Mock reset request */
router.post('/forgot-password', authLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });
    
    const user = await users.findByEmail(email.toLowerCase().trim());
    if (!user) {
      // Security best practice: don't reveal if user exists
      return res.json({ success: true, message: 'If an account exists, a reset link has been sent.' });
    }
    
    // In production, we'd generate a token and send an email
    logger.info('Password reset requested', { email: user.email });
    res.json({ success: true, message: 'If an account exists, a reset link has been sent.' });
  } catch (error) {
    res.status(500).json({ error: 'Internal error' });
  }
});

/** POST /api/auth/reset-password - Update password */
router.post('/reset-password', authLimiter, async (req, res) => {
  try {
    const { email, newPassword } = req.body;
    if (!email || !newPassword) return res.status(400).json({ error: 'Missing fields' });
    
    const validationErrors = validateRegistration(email, newPassword, 'User');
    if (validationErrors.length > 0) return res.status(400).json({ error: validationErrors[0] });

    const user = await users.findByEmail(email.toLowerCase().trim());
    if (!user) return res.status(404).json({ error: 'User not found' });

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await users.update(user.id, { passwordHash });

    res.json({ success: true, message: 'Password updated successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Reset failed' });
  }
});

export default router;
