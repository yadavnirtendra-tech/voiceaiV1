/**
 * Conflict Resolution Service
 * 
 * Detects time slot overlaps across all connected calendars and
 * determines the appropriate action based on user's conflict strategy.
 * 
 * CRITICAL: This is the primary defense against double-booking.
 * When an event on Google overlaps with an event on Outlook,
 * this service detects the conflict and decides what to do.
 * 
 * Uses Prisma/PostgreSQL for all database operations.
 */
import { calendarEvents, shadowBlocks, users, identities } from '../../db/index.js';
import logger from '../../utils/logger.js';

/**
 * Check if a new event conflicts with existing events across all providers
 * 
 * This is the CORE conflict detection that prevents double-booking:
 * 1. Finds all BUSY events across ALL connected calendars that overlap
 * 2. Finds all active shadow blocks that overlap
 * 3. Excludes the source calendar (since the event already exists there)
 * 4. Excludes system-generated events to avoid self-conflicts
 * 
 * @param {string} userId - User ID
 * @param {Date|string} startTime - Event start time
 * @param {Date|string} endTime - Event end time  
 * @param {string} excludeIdentityId - Identity to exclude (the source)
 * @param {string} excludeEventId - Event to exclude (the source event itself)
 * @returns {Object} { hasConflict, conflicts[] }
 */
export async function checkConflicts(userId, startTime, endTime, excludeIdentityId = null, excludeEventId = null) {
  const start = new Date(startTime);
  const end = new Date(endTime);

  // Query overlapping events from Firestore
  const overlappingEvents = await calendarEvents.findOverlapping(
    userId, start, end, excludeIdentityId, excludeEventId
  );

  // Enrich with identity info
  for (const event of overlappingEvents) {
    const identity = await identities.findById(event.identityId);
    event.identity = identity ? {
      providerType: identity.providerType,
      providerEmail: identity.providerEmail,
      calendarName: identity.calendarName,
    } : null;
  }

  // Also check shadow blocks for overlaps
  const overlappingShadows = await shadowBlocks.findOverlapping(
    userId, start, end, excludeIdentityId
  );

  const conflicts = overlappingEvents.map(event => ({
    type: 'EVENT',
    id: event.id,
    title: event.title,
    startTime: event.startTime,
    endTime: event.endTime,
    provider: event.identity?.providerType,
    email: event.identity?.providerEmail,
    calendar: event.identity?.calendarName,
  }));

  const shadowConflicts = overlappingShadows.map(block => ({
    type: 'SHADOW_BLOCK',
    id: block.id,
    title: block.title,
    startTime: block.startTime,
    endTime: block.endTime,
  }));

  const allConflicts = [...conflicts, ...shadowConflicts];

  if (allConflicts.length > 0) {
    logger.info('Conflicts detected', {
      userId,
      timeRange: `${start.toISOString()} - ${end.toISOString()}`,
      conflictCount: allConflicts.length,
      conflictDetails: allConflicts.map(c => ({
        type: c.type,
        title: c.title,
        provider: c.provider || 'shadow',
      })),
    });
  }

  return {
    hasConflict: allConflicts.length > 0,
    conflicts: allConflicts,
  };
}

/**
 * Resolve a conflict based on user's strategy
 * 
 * Strategies:
 * - BLOCK_ALL: Always proceed — shadow blocks ensure all calendars show busy
 * - PRIORITY_BASED: Higher-priority provider wins
 * - MANUAL_RESOLVE: Notify user and skip automatic sync
 * 
 * @param {string} userId - User ID
 * @param {Object} newEvent - The new event being synced
 * @param {Array} conflicts - List of conflicting events
 * @returns {Object} { action: 'PROCEED'|'SKIP'|'NOTIFY', reason }
 */
export async function resolveConflict(userId, newEvent, conflicts) {
  const user = await users.findById(userId);
  
  // ALIEN TECH: Active Shielding (Auto-Decline Overlaps)
  if (user?.autoDeclineConflicts) {
    return {
      action: 'DECLINE',
      reason: 'Active Shielding: Auto-Decline Conflicts is enabled and a schedule overlap was detected.',
      conflicts
    };
  }

  const strategy = user?.conflictStrategy || 'BLOCK_ALL';

  switch (strategy) {
    case 'BLOCK_ALL':
      // The event already exists on one provider, so the shadow block
      // should still be created on OTHER providers to mark as busy.
      // This is the CORRECT behavior: conflicts are acknowledged,
      // and shadow blocks ensure unified busy status.
      return {
        action: 'PROCEED',
        reason: 'BLOCK_ALL strategy: Shadow blocks are always created to maintain unified availability',
      };

    case 'PRIORITY_BASED': {
      // Check if the new event's provider has higher priority
      // First connected identity has highest priority
      const userIdentities = await identities.findActiveByUser(userId);
      
      const priorityMap = {};
      userIdentities
        .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''))
        .forEach((identity, index) => {
          priorityMap[identity.id] = index;
        });

      // If source has higher priority (lower index), proceed
      const sourcePriority = priorityMap[newEvent.identityId] ?? 999;
      const hasHigherPriority = conflicts.every(c => {
        if (c.type === 'SHADOW_BLOCK') return true; // Shadow blocks don't have priority
        const conflictIdentityId = c.identityId;
        const conflictPriority = priorityMap[conflictIdentityId] ?? 999;
        return sourcePriority <= conflictPriority;
      });

      if (hasHigherPriority) {
        return {
          action: 'PROCEED',
          reason: 'Source event has higher provider priority',
        };
      }

      return {
        action: 'SKIP',
        reason: 'Conflicting event has higher provider priority',
      };
    }

    case 'MANUAL_RESOLVE':
      return {
        action: 'NOTIFY',
        reason: 'User prefers manual conflict resolution',
        conflicts,
      };

    default:
      return { action: 'PROCEED', reason: 'Default: proceed with sync' };
  }
}
