/**
 * Microsoft Webhook Service
 * Manages Graph API subscriptions for real-time event notifications
 * Uses Prisma/PostgreSQL for subscription storage
 */
import { v4 as uuidv4 } from 'uuid';
import { getAccessToken } from './auth.service.js';
import { MS_GRAPH_BASE_URL, MS_SUBSCRIPTION_TTL_MINUTES } from '../../utils/constants.js';
import { webhookSubscriptions, identities } from '../../db/index.js';
import config from '../../config/env.js';
import logger from '../../utils/logger.js';

/**
 * Register a webhook subscription for Microsoft Calendar events
 * @param {Object} identity - Identity record
 * @returns {Object} Webhook subscription record
 */
export async function registerWebhook(identity) {
  const token = await getAccessToken(identity);

  const expirationDateTime = new Date(
    Date.now() + MS_SUBSCRIPTION_TTL_MINUTES * 60 * 1000
  ).toISOString();

  const subscription = {
    changeType: 'created,updated,deleted',
    notificationUrl: config.webhook.microsoftUrl,
    resource: '/me/events',
    expirationDateTime,
    clientState: `userId=${identity.userId}&identityId=${identity.id}`,
  };

  try {
    const response = await fetch(`${MS_GRAPH_BASE_URL}/subscriptions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(subscription),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Failed to create subscription: ${response.status} ${errorBody}`);
    }

    const data = await response.json();

    // Store subscription in Firestore
    const sub = await webhookSubscriptions.create({
      userId: identity.userId,
      identityId: identity.id,
      providerType: identity.providerType,
      subscriptionId: data.id,
      expiresAt: new Date(data.expirationDateTime),
      isActive: true,
    });

    logger.info('Microsoft webhook registered', {
      identityId: identity.id,
      subscriptionId: data.id,
      expiresAt: data.expirationDateTime,
    });

    return sub;
  } catch (error) {
    logger.error('Failed to register Microsoft webhook', {
      identityId: identity.id,
      error: error.message,
    });
    throw error;
  }
}

/**
 * Unsubscribe a Microsoft webhook
 * @param {Object} subscription - Webhook subscription record
 * @param {Object} identity - Identity record (for auth)
 */
export async function unregisterWebhook(subscription, identity) {
  try {
    const token = await getAccessToken(identity);

    await fetch(`${MS_GRAPH_BASE_URL}/subscriptions/${subscription.subscriptionId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });

    await webhookSubscriptions.update(subscription.id, { isActive: false });

    logger.info('Microsoft webhook unregistered', {
      subscriptionId: subscription.subscriptionId,
    });
  } catch (error) {
    logger.warn('Failed to unregister Microsoft webhook', {
      subscriptionId: subscription.subscriptionId,
      error: error.message,
    });
    await webhookSubscriptions.update(subscription.id, { isActive: false });
  }
}

/**
 * Renew expiring Microsoft webhook subscriptions
 */
export async function renewExpiringWebhooks() {
  const bufferMs = 60 * 60 * 1000; // 1 hour buffer
  const expiringBefore = new Date(Date.now() + bufferMs);

  const expiringSubs = await webhookSubscriptions.findExpiringByProvider(
    ['MICROSOFT_PERSONAL', 'MICROSOFT_365'],
    expiringBefore
  );

  for (const sub of expiringSubs) {
    try {
      if (!sub.identity) continue;
      const token = await getAccessToken(sub.identity);
      const newExpiration = new Date(
        Date.now() + MS_SUBSCRIPTION_TTL_MINUTES * 60 * 1000
      ).toISOString();

      const response = await fetch(
        `${MS_GRAPH_BASE_URL}/subscriptions/${sub.subscriptionId}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ expirationDateTime: newExpiration }),
        }
      );

      if (response.ok) {
        await webhookSubscriptions.update(sub.id, { expiresAt: newExpiration });
        logger.info('Microsoft webhook renewed', { subscriptionId: sub.subscriptionId });
      } else {
        // If renewal fails, re-create
        await unregisterWebhook(sub, sub.identity);
        await registerWebhook(sub.identity);
      }
    } catch (error) {
      logger.error('Failed to renew Microsoft webhook', {
        subscriptionId: sub.subscriptionId,
        error: error.message,
      });
    }
  }
}
