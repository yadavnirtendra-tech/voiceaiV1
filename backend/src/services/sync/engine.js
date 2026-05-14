/**
 * Core Sync Engine - The State Machine Orchestrator
 * Processes webhook events through the full sync pipeline
 * Uses Prisma/PostgreSQL for all database operations
 */
import { shouldProcessEvent, markAsProcessed, isAlreadyProcessed } from './loopGuard.js';
import { checkConflicts, resolveConflict } from './conflictResolver.js';
import { createShadowBlocks, deleteShadowBlocks } from './shadowBlock.js';
import * as googleCal from '../google/calendar.service.js';
import * as msCal from '../microsoft/calendar.service.js';
import { GOOGLE_PROVIDERS, MICROSOFT_PROVIDERS, SYNC_STATES } from '../../utils/constants.js';
import { identities, calendarEvents, syncLogs } from '../../db/index.js';
import logger from '../../utils/logger.js';

/**
 * Process a webhook notification - main entry point for the state machine
 */
export async function processWebhook(identityId, providerPayload) {
  let state = SYNC_STATES.WEBHOOK_RECEIVED;

  let logEntry;
  try {
    // Fetch the identity with user info
    const identity = await identities.findByIdWithUser(identityId);
    if (!identity || !identity.isActive) {
      return;
    }

    logEntry = await syncLogs.create({
      userId: identity.userId,
      identityId,
      action: 'WEBHOOK_RECEIVED',
      status: 'PROCESSING',
      metadata: { payload: providerPayload },
    });

    // Fetch changed events from the provider
    state = SYNC_STATES.FETCH_EVENT;
    const isGoogle = GOOGLE_PROVIDERS.includes(identity.providerType);
    let changedEvents = [];

    if (isGoogle) {
      const result = await googleCal.listEvents(identity, { syncToken: identity.latestSyncToken });
      changedEvents = result.events;
      if (result.nextSyncToken) {
        await identities.update(identity.id, { latestSyncToken: result.nextSyncToken, lastSyncedAt: new Date() });
      }
    } else {
      const result = await msCal.listEvents(identity, { deltaLink: identity.latestSyncToken });
      changedEvents = result.events;
      if (result.deltaLink) {
        await identities.update(identity.id, { latestSyncToken: result.deltaLink, lastSyncedAt: new Date() });
      }
    }

    logger.info(`Processing ${changedEvents.length} changed events`, { identityId, provider: identity.providerType });

    for (const event of changedEvents) {
      await processEvent(event, identity);
    }

    await updateLog(logEntry.id, 'COMPLETED');
  } catch (error) {
    logger.error('Sync engine error', { identityId, state, error: error.message, stack: error.stack });
    await updateLog(logEntry.id, 'FAILED', error.message);
  }
}

/**
 * Process a single calendar event through the state machine
 */
async function processEvent(externalEvent, identity) {
  const isGoogle = GOOGLE_PROVIDERS.includes(identity.providerType);
  const eventId = externalEvent.id;

  // STATE: LOOP_CHECK
  const { shouldProcess, reason } = shouldProcessEvent(externalEvent, identity.providerType, identity.id);
  if (!shouldProcess) {
    await syncLogs.create({
      userId: identity.userId, identityId: identity.id, action: 'LOOP_PREVENTED', status: 'SKIPPED',
      externalEventId: eventId, providerType: identity.providerType, metadata: { reason }, completedAt: new Date(),
    });
    return;
  }

  // Database-level dedup check
  if (await isAlreadyProcessed(eventId, identity.id)) return;

  // Mark as processed immediately
  markAsProcessed(eventId, identity.id);

  // Parse event data
  const isCancelled = isGoogle ? externalEvent.status === 'cancelled' : externalEvent['@removed'];
  const startTime = isGoogle ? (externalEvent.start?.dateTime || externalEvent.start?.date) : externalEvent.start?.dateTime;
  const endTime = isGoogle ? (externalEvent.end?.dateTime || externalEvent.end?.date) : externalEvent.end?.dateTime;
  const title = isGoogle ? externalEvent.summary : externalEvent.subject;
  const busyStatus = isGoogle
    ? (externalEvent.transparency === 'transparent' ? 'FREE' : 'BUSY')
    : (externalEvent.showAs === 'free' ? 'FREE' : 'BUSY');

  // Handle deleted/cancelled events
  if (isCancelled) {
    const existing = await calendarEvents.findByIdentityAndExternalId(identity.id, eventId);
    if (existing) {
      await calendarEvents.update(existing.id, { status: 'CANCELLED' });
      await deleteShadowBlocks(existing.id);
      await syncLogs.create({
        userId: identity.userId, identityId: identity.id, action: 'EVENT_DELETED', status: 'COMPLETED',
        externalEventId: eventId, providerType: identity.providerType, completedAt: new Date(),
      });
    }
    return;
  }

  if (!startTime || !endTime) return; // Skip events without times

  // Skip free/transparent events
  if (busyStatus === 'FREE') return;

  // Upsert the event in Firestore
  const calEvent = await calendarEvents.upsert(
    identity.id, eventId,
    // Create data
    {
      userId: identity.userId,
      externalCalendarId: identity.calendarId,
      title: title || 'Untitled',
      startTime: new Date(startTime),
      endTime: new Date(endTime),
      status: 'CONFIRMED',
      busyStatus,
      etag: externalEvent.etag || externalEvent.changeKey,
      rawPayload: externalEvent,
    },
    // Update data
    {
      title: title || 'Untitled',
      startTime: new Date(startTime),
      endTime: new Date(endTime),
      status: 'CONFIRMED',
      busyStatus,
      etag: externalEvent.etag || externalEvent.changeKey,
      rawPayload: externalEvent,
    }
  );

  // STATE: CONFLICT_CHECK — Prevents double-booking across calendars
  const { hasConflict, conflicts } = await checkConflicts(identity.userId, startTime, endTime, identity.id, calEvent.id);

  if (hasConflict) {
    const resolution = await resolveConflict(identity.userId, calEvent, conflicts);
    if (resolution.action === 'SKIP') {
      await syncLogs.create({
        userId: identity.userId, identityId: identity.id, action: 'CONFLICT_DETECTED', status: 'SKIPPED',
        externalEventId: eventId, providerType: identity.providerType, metadata: { conflicts, resolution }, completedAt: new Date(),
      });
      return;
    }
  }

  // STATE: SHADOW_BLOCK - Create blocks on all other providers
  await createShadowBlocks(identity.userId, calEvent, identity);
}

/**
 * Full sync for a user - processes all events from all identities
 */
export async function fullSync(userId) {
  const userIdentities = await identities.findActiveByUser(userId);
  logger.info('Starting full sync', { userId, identityCount: userIdentities.length });

  for (const identity of userIdentities) {
    try {
      const isGoogle = GOOGLE_PROVIDERS.includes(identity.providerType);
      let events;
      if (isGoogle) {
        const result = await googleCal.listEvents(identity, {});
        events = result.events;
        if (result.nextSyncToken) {
          await identities.update(identity.id, { latestSyncToken: result.nextSyncToken, lastSyncedAt: new Date() });
        }
      } else {
        const result = await msCal.listEvents(identity, {});
        events = result.events;
        if (result.deltaLink) {
          await identities.update(identity.id, { latestSyncToken: result.deltaLink, lastSyncedAt: new Date() });
        }
      }
      for (const event of events) {
        await processEvent(event, identity);
      }
    } catch (error) {
      logger.error('Full sync error for identity', { identityId: identity.id, error: error.message });
    }
  }

  await syncLogs.create({
    userId, action: 'FULL_SYNC', status: 'COMPLETED', completedAt: new Date(),
  });
}

async function updateLog(id, status, errorMessage = null) {
  await syncLogs.update(id, { status, errorMessage, completedAt: new Date() });
}
