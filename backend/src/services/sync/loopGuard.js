/**
 * Infinite Loop Prevention Guard
 * Uses Prisma/PostgreSQL for database-level dedup checks
 */
import { isSystemGenerated as isGoogleSystemGenerated } from '../google/calendar.service.js';
import { isSystemGenerated as isMicrosoftSystemGenerated } from '../microsoft/calendar.service.js';
import { GOOGLE_PROVIDERS, MICROSOFT_PROVIDERS } from '../../utils/constants.js';
import { syncLogs } from '../../db/index.js';
import logger from '../../utils/logger.js';

const recentlyProcessed = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [key, ts] of recentlyProcessed.entries()) {
    if (now - ts > CACHE_TTL_MS) recentlyProcessed.delete(key);
  }
}, 60 * 1000);

export function shouldProcessEvent(event, providerType, identityId) {
  const isGoogle = GOOGLE_PROVIDERS.includes(providerType);
  const isMicrosoft = MICROSOFT_PROVIDERS.includes(providerType);

  if (isGoogle && isGoogleSystemGenerated(event)) {
    logger.debug('Loop guard: skip system event', { eventId: event.id });
    return { shouldProcess: false, reason: 'SYSTEM_GENERATED_TAG' };
  }
  if (isMicrosoft && isMicrosoftSystemGenerated(event)) {
    logger.debug('Loop guard: skip system event', { eventId: event.id });
    return { shouldProcess: false, reason: 'SYSTEM_GENERATED_TAG' };
  }

  const etag = event.etag || event.changeKey || '';
  const cacheKey = `${identityId}:${event.id || event.iCalUId}:${etag}`;
  if (recentlyProcessed.has(cacheKey)) {
    return { shouldProcess: false, reason: 'RECENTLY_PROCESSED' };
  }

  // 🛡️ Alien Tech: Mutex Lock for Race Conditions
  // Instantly mark as processed in memory so concurrent identical webhooks are blocked
  recentlyProcessed.set(cacheKey, Date.now());

  const title = event.summary || event.subject || '';
  if (title.includes('CalendarSync') && title.includes('Reserved')) {
    return { shouldProcess: false, reason: 'SHADOW_BLOCK_TITLE_MATCH' };
  }

  return { shouldProcess: true, reason: 'USER_EVENT', cacheKey };
}

export function markAsProcessed(eventId, identityId) {
  recentlyProcessed.set(`${identityId}:${eventId}`, Date.now());
}

export async function isAlreadyProcessed(externalEventId, identityId) {
  return syncLogs.findRecentByExternalEvent(externalEventId, identityId, CACHE_TTL_MS);
}

export function _getProcessedCache() {
  return recentlyProcessed;
}
