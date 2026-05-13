/**
 * Authentication Routes
 * OAuth connect/callback for Google and Microsoft
 * Uses Firestore for all database operations
 */
import { Router } from 'express';
import { authenticate, generateToken, optionalAuth } from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimiter.js';
import * as googleAuth from '../services/google/auth.service.js';
import * as msAuth from '../services/microsoft/auth.service.js';
import * as googleWebhook from '../services/google/webhook.service.js';
import * as msWebhook from '../services/microsoft/webhook.service.js';
import { fullSync } from '../services/sync/engine.js';
import { users, identities, webhookSubscriptions, shadowBlocks } from '../db/index.js';
import config from '../config/env.js';
import logger from '../utils/logger.js';

const router = Router();

// ============ Google OAuth ============

/** GET /api/auth/google - Start Google OAuth flow */
router.get('/google', authLimiter, optionalAuth, async (req, res) => {
  try {
    let userId = req.user?.id;
    if (!userId) {
      // Create a new user for first-time connect
      const user = await users.create({ email: `pending-${Date.now()}@temp`, displayName: 'New User' });
      userId = user.id;
    }
    const authUrl = googleAuth.getAuthUrl(userId);
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

    const stateData = JSON.parse(Buffer.from(state, 'base64').toString());
    const identity = await googleAuth.handleCallback(code, stateData.userId);

    // Update user email if it was a temp placeholder
    const user = await users.findById(stateData.userId);
    if (user?.email?.startsWith('pending-')) {
      await users.update(stateData.userId, { email: identity.providerEmail, displayName: identity.providerEmail.split('@')[0] });
    }

    // Register webhook for real-time sync
    try { await googleWebhook.registerWebhook(identity); } catch (e) { logger.warn('Webhook registration deferred', { error: e.message }); }

    // Trigger initial full sync
    fullSync(stateData.userId).catch(e => logger.error('Initial sync failed', { error: e.message }));

    // Generate JWT and set cookie
    const token = generateToken(stateData.userId);
    res.cookie('auth_token', token, { httpOnly: true, secure: config.nodeEnv === 'production', sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 });
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
    let userId = req.user?.id;
    if (!userId) {
      const user = await users.create({ email: `pending-${Date.now()}@temp`, displayName: 'New User' });
      userId = user.id;
    }
    const authUrl = await msAuth.getAuthUrl(userId);
    res.redirect(authUrl);
  } catch (error) {
    logger.error('Microsoft auth init failed', { error: error.message });
    res.redirect(`${config.frontendUrl}?error=auth_failed`);
  }
});

/** GET /api/auth/microsoft/callback */
router.get('/microsoft/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code || !state) return res.redirect(`${config.frontendUrl}?error=missing_params`);

    const stateData = JSON.parse(Buffer.from(state, 'base64').toString());
    const identity = await msAuth.handleCallback(code, stateData.userId);

    const user = await users.findById(stateData.userId);
    if (user?.email?.startsWith('pending-')) {
      await users.update(stateData.userId, { email: identity.providerEmail, displayName: identity.providerEmail.split('@')[0] });
    }

    try { await msWebhook.registerWebhook(identity); } catch (e) { logger.warn('MS Webhook registration deferred', { error: e.message }); }
    fullSync(stateData.userId).catch(e => logger.error('Initial sync failed', { error: e.message }));

    const token = generateToken(stateData.userId);
    res.cookie('auth_token', token, { httpOnly: true, secure: config.nodeEnv === 'production', sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 });
    res.redirect(`${config.frontendUrl}?connected=microsoft&success=true`);
  } catch (error) {
    logger.error('Microsoft callback failed', { error: error.message });
    res.redirect(`${config.frontendUrl}?error=callback_failed`);
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

/** POST /api/auth/logout */
router.post('/logout', (req, res) => {
  res.clearCookie('auth_token');
  res.json({ success: true });
});

/** GET /api/auth/status */
router.get('/status', optionalAuth, (req, res) => {
  res.json({ authenticated: !!req.user, user: req.user || null });
});

export default router;
