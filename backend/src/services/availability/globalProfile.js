/**
 * Global Availability Profile Service
 * Computes unified availability across all connected calendars
 * Uses Prisma/PostgreSQL for all database operations
 */
import { calendarEvents } from '../../db/index.js';
import logger from '../../utils/logger.js';

/**
 * Get unified availability for a user across all providers
 */
export async function getAvailability(userId, startDate, endDate) {
  const events = await calendarEvents.findBusySlots(userId, startDate, endDate);

  const slots = events.map(e => ({
    id: e.id,
    start: e.startTime,
    end: e.endTime,
    title: e.title,
    provider: e.identity?.providerType,
    email: e.identity?.providerEmail,
    calendar: e.identity?.calendarName,
    busyStatus: e.busyStatus,
  }));

  return { slots, mergedSlots: mergeOverlapping(slots) };
}

/**
 * Merge overlapping time slots
 */
function mergeOverlapping(slots) {
  if (!slots.length) return [];
  const sorted = [...slots].sort((a, b) => {
    const aTime = new Date(a.start).getTime();
    const bTime = new Date(b.start).getTime();
    return aTime - bTime;
  });

  const merged = [{
    start: sorted[0].start,
    end: sorted[0].end,
    sources: [sorted[0]],
  }];

  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const lastEnd = new Date(last.end).getTime();
    const curStart = new Date(sorted[i].start).getTime();

    if (curStart <= lastEnd) {
      const curEnd = new Date(sorted[i].end).getTime();
      if (curEnd > lastEnd) {
        last.end = sorted[i].end;
      }
      last.sources.push(sorted[i]);
    } else {
      merged.push({
        start: sorted[i].start,
        end: sorted[i].end,
        sources: [sorted[i]],
      });
    }
  }
  return merged;
}

/**
 * Check if a specific time slot is available
 */
export async function isSlotAvailable(userId, startTime, endTime) {
  const overlaps = await calendarEvents.findOverlapping(userId, startTime, endTime);
  return overlaps.length === 0;
}
