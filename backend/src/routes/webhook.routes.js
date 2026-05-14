/**
 * Webhook Receiver Routes
 * Handles incoming push notifications from Google and Microsoft
 * Uses Prisma/PostgreSQL for all database operations
 */
import { Router } from 'express';
import { webhookLimiter } from '../middleware/rateLimiter.js';
import { processWebhook } from '../services/sync/engine.js';
import { webhookSubscriptions } from '../db/index.js';
import config from '../config/env.js';
import logger from '../utils/logger.js';

const router = Router();

/**
 * POST /api/webhook/google
 * Google sends push notifications here when calendar events change
 * Headers contain: X-Goog-Channel-ID, X-Goog-Resource-ID, X-Goog-Resource-State
 */
router.post('/google', webhookLimiter, async (req, res) => {
  try {
    const channelId = req.headers['x-goog-channel-id'];
    const resourceState = req.headers['x-goog-resource-state'];
    const token = req.headers['x-goog-channel-token'] || '';

    // Acknowledge immediately (Google expects 200 within 10 seconds)
    res.status(200).send('OK');

    // Skip "sync" notifications (initial confirmation)
    if (resourceState === 'sync') {
      logger.debug('Google webhook sync confirmation received', { channelId });
      return;
    }

    // Parse the token to extract userId and identityId
    const params = new URLSearchParams(token);
    const identityId = params.get('identityId');

    if (!identityId) {
      logger.warn('Google webhook missing identityId', { channelId, token });
      return;
    }

    // Verify the subscription exists in database
    const sub = await webhookSubscriptions.findActiveBySubscriptionId(channelId);

    if (!sub) {
      logger.warn('Google webhook for unknown subscription', { channelId });
      return;
    }

    logger.info('Google webhook received', {
      channelId,
      resourceState,
      identityId,
    });

    // Process asynchronously
    processWebhook(identityId, { source: 'google', channelId, resourceState })
      .catch(e => logger.error('Google webhook processing failed', { error: e.message }));

  } catch (error) {
    logger.error('Google webhook handler error', { error: error.message });
    // Already sent 200, so just log
  }
});

/**
 * POST /api/webhook/microsoft
 * Microsoft Graph sends notifications here when calendar events change
 * Also handles subscription validation (lifecycle notifications)
 */
router.post('/microsoft', webhookLimiter, async (req, res) => {
  try {
    // Handle subscription validation
    if (req.query.validationToken) {
      logger.debug('Microsoft webhook validation', { token: req.query.validationToken });
      res.set('Content-Type', 'text/plain');
      return res.status(200).send(req.query.validationToken);
    }

    // Acknowledge immediately
    res.status(202).send();

    const notifications = req.body?.value;
    if (!notifications || !Array.isArray(notifications)) {
      logger.warn('Microsoft webhook: no notifications in payload');
      return;
    }

    for (const notification of notifications) {
      const clientState = notification.clientState || '';
      const params = new URLSearchParams(clientState);
      const identityId = params.get('identityId');

      if (!identityId) {
        logger.warn('Microsoft webhook missing identityId', { subscriptionId: notification.subscriptionId });
        continue;
      }

      // Verify subscription in database
      const sub = await webhookSubscriptions.findActiveBySubscriptionId(notification.subscriptionId);

      if (!sub) {
        logger.warn('Microsoft webhook for unknown subscription', { subscriptionId: notification.subscriptionId });
        continue;
      }

      logger.info('Microsoft webhook received', {
        subscriptionId: notification.subscriptionId,
        changeType: notification.changeType,
        resource: notification.resource,
        identityId,
      });

      // Handle lifecycle notifications (reauthorization required)
      if (notification.lifecycleEvent) {
        logger.warn('Microsoft lifecycle event', { event: notification.lifecycleEvent, identityId });
        continue;
      }

      // Process asynchronously
      processWebhook(identityId, {
        source: 'microsoft',
        subscriptionId: notification.subscriptionId,
        changeType: notification.changeType,
        resourceId: notification.resource,
      }).catch(e => logger.error('Microsoft webhook processing failed', { error: e.message }));
    }
  } catch (error) {
    logger.error('Microsoft webhook handler error', { error: error.message });
  }
});

export default router;
