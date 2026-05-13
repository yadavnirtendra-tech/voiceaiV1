/**
 * Google Webhook Service
 * Manages Push Notification channels for real-time event sync
 * Uses Firestore for subscription storage
 */
import { google } from 'googleapis';
import { v4 as uuidv4 } from 'uuid';
import { getAuthenticatedClient } from './auth.service.js';
import { GOOGLE_WEBHOOK_CHANNEL_TTL } from '../../utils/constants.js';
import { webhookSubscriptions } from '../../db/index.js';
import config from '../../config/env.js';
import logger from '../../utils/logger.js';

/**
 * Register a webhook channel for a Google Calendar
 * Google will send POST requests to our webhook URL when events change
 * 
 * @param {Object} identity - Identity record
 * @returns {Object} Webhook subscription record
 */
export async function registerWebhook(identity) {
  const auth = await getAuthenticatedClient(identity);
  const calendar = google.calendar({ version: 'v3', auth });

  const channelId = uuidv4();
  const expiration = Date.now() + GOOGLE_WEBHOOK_CHANNEL_TTL * 1000;

  try {
    const response = await calendar.events.watch({
      calendarId: identity.calendarId || 'primary',
      requestBody: {
        id: channelId,
        type: 'web_hook',
        address: config.webhook.googleUrl,
        token: `userId=${identity.userId}&identityId=${identity.id}`,
        expiration,
      },
    });

    // Store subscription in Firestore
    const subscription = await webhookSubscriptions.create({
      userId: identity.userId,
      identityId: identity.id,
      providerType: identity.providerType,
      subscriptionId: channelId,
      resourceId: response.data.resourceId,
      expiresAt: new Date(parseInt(response.data.expiration)),
      isActive: true,
    });

    logger.info('Google webhook registered', {
      identityId: identity.id,
      channelId,
      resourceId: response.data.resourceId,
      expiresAt: new Date(expiration).toISOString(),
    });

    return subscription;
  } catch (error) {
    logger.error('Failed to register Google webhook', {
      identityId: identity.id,
      error: error.message,
    });
    throw error;
  }
}

/**
 * Stop/unsubscribe a webhook channel
 * @param {Object} subscription - Webhook subscription record
 * @param {Object} identity - Identity record (for auth)
 */
export async function unregisterWebhook(subscription, identity) {
  try {
    const auth = await getAuthenticatedClient(identity);
    const calendar = google.calendar({ version: 'v3', auth });

    await calendar.channels.stop({
      requestBody: {
        id: subscription.subscriptionId,
        resourceId: subscription.resourceId,
      },
    });

    await webhookSubscriptions.update(subscription.id, { isActive: false });

    logger.info('Google webhook unregistered', {
      subscriptionId: subscription.subscriptionId,
    });
  } catch (error) {
    logger.warn('Failed to unregister Google webhook (may have already expired)', {
      subscriptionId: subscription.subscriptionId,
      error: error.message,
    });
    // Still mark as inactive in DB
    await webhookSubscriptions.update(subscription.id, { isActive: false });
  }
}

/**
 * Renew expiring webhook channels
 * Called by the cron job to prevent webhook expiration
 */
export async function renewExpiringWebhooks() {
  const bufferMs = 60 * 60 * 1000; // 1 hour buffer
  const expiringBefore = new Date(Date.now() + bufferMs);

  const expiringSubs = await webhookSubscriptions.findExpiringByProvider(
    ['GOOGLE_PERSONAL', 'GOOGLE_WORKSPACE'],
    expiringBefore
  );

  for (const sub of expiringSubs) {
    try {
      if (!sub.identity) continue;
      // Unregister old channel
      await unregisterWebhook(sub, sub.identity);
      // Register new channel
      await registerWebhook(sub.identity);
      logger.info('Google webhook renewed', { identityId: sub.identityId });
    } catch (error) {
      logger.error('Failed to renew Google webhook', {
        identityId: sub.identityId,
        error: error.message,
      });
    }
  }
}
