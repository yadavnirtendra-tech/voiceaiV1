/**
 * Google Calendar Operations Service
 * CRUD operations and event management for Google Calendar
 */
import { google } from 'googleapis';
import { getAuthenticatedClient } from './auth.service.js';
import { SYSTEM_TAG_KEY, SYSTEM_TAG_VALUE, SHADOW_BLOCK_TITLE } from '../../utils/constants.js';
import logger from '../../utils/logger.js';

/**
 * Get a Google Calendar service instance for an identity
 * @param {Object} identity - Identity record
 * @returns {Object} Google Calendar v3 service
 */
async function getCalendarService(identity) {
  const auth = await getAuthenticatedClient(identity);
  return google.calendar({ version: 'v3', auth });
}

/**
 * List events from a Google Calendar
 * @param {Object} identity - Identity record
 * @param {Object} options - Query options
 * @returns {Object} { events, nextSyncToken }
 */
export async function listEvents(identity, options = {}) {
  const calendar = await getCalendarService(identity);
  
  const params = {
    calendarId: identity.calendarId || 'primary',
    maxResults: options.maxResults || 250,
    singleEvents: true,
    orderBy: 'startTime',
  };

  // Use sync token for incremental sync, or time range for initial sync
  if (options.syncToken) {
    params.syncToken = options.syncToken;
  } else {
    params.timeMin = options.timeMin || new Date().toISOString();
    params.timeMax = options.timeMax || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  }

  try {
    const response = await calendar.events.list(params);
    return {
      events: response.data.items || [],
      nextSyncToken: response.data.nextSyncToken,
      nextPageToken: response.data.nextPageToken,
    };
  } catch (error) {
    // If sync token is invalid, do a full sync
    if (error.code === 410) {
      logger.warn('Google sync token expired, performing full sync', { identityId: identity.id });
      delete params.syncToken;
      params.timeMin = new Date().toISOString();
      params.timeMax = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const response = await calendar.events.list(params);
      return {
        events: response.data.items || [],
        nextSyncToken: response.data.nextSyncToken,
      };
    }
    throw error;
  }
}

/**
 * Get a single event by ID
 * @param {Object} identity - Identity record
 * @param {string} eventId - Google event ID
 * @returns {Object|null} Event data
 */
export async function getEvent(identity, eventId) {
  const calendar = await getCalendarService(identity);
  
  try {
    const response = await calendar.events.get({
      calendarId: identity.calendarId || 'primary',
      eventId,
    });
    return response.data;
  } catch (error) {
    if (error.code === 404) return null;
    throw error;
  }
}

/**
 * Create a Shadow Block event in Google Calendar
 * This is the core mechanism that blocks time on Google when an event exists on another provider
 * 
 * @param {Object} identity - Target Google identity
 * @param {Object} eventData - { title, startTime, endTime, description }
 * @returns {Object} Created event
 */
export async function createShadowBlock(identity, eventData) {
  const calendar = await getCalendarService(identity);

  const event = {
    summary: eventData.title || SHADOW_BLOCK_TITLE,
    description: eventData.description || 'This time slot has been reserved by OpenCalendar.',
    start: {
      dateTime: new Date(eventData.startTime).toISOString(),
      timeZone: eventData.timeZone || 'UTC',
    },
    end: {
      dateTime: new Date(eventData.endTime).toISOString(),
      timeZone: eventData.timeZone || 'UTC',
    },
    // Mark as busy
    transparency: 'opaque',
    // Use extended properties to tag as system-generated (LOOP PREVENTION)
    extendedProperties: {
      private: {
        [SYSTEM_TAG_KEY]: SYSTEM_TAG_VALUE,
        sourceEventId: eventData.sourceEventId || '',
        sourceProvider: eventData.sourceProvider || '',
      },
    },
    // Set visibility to private so external users see "Busy"
    visibility: 'private',
    // Color: Graphite (8) to visually distinguish from user events
    colorId: '8',
    // Reminders: None for shadow blocks
    reminders: {
      useDefault: false,
      overrides: [],
    },
  };

  const response = await calendar.events.insert({
    calendarId: identity.calendarId || 'primary',
    requestBody: event,
  });

  logger.info('Google shadow block created', {
    identityId: identity.id,
    eventId: response.data.id,
    start: eventData.startTime,
    end: eventData.endTime,
  });

  return response.data;
}

/**
 * Update a Shadow Block event
 * @param {Object} identity - Target Google identity
 * @param {string} eventId - Event ID to update
 * @param {Object} updates - Updated fields
 * @returns {Object} Updated event
 */
export async function updateShadowBlock(identity, eventId, updates) {
  const calendar = await getCalendarService(identity);

  const patch = {};
  if (updates.startTime) {
    patch.start = { dateTime: new Date(updates.startTime).toISOString() };
  }
  if (updates.endTime) {
    patch.end = { dateTime: new Date(updates.endTime).toISOString() };
  }
  if (updates.title) {
    patch.summary = updates.title;
  }

  const response = await calendar.events.patch({
    calendarId: identity.calendarId || 'primary',
    eventId,
    requestBody: patch,
  });

  return response.data;
}

/**
 * Delete a Shadow Block event (when source event is cancelled)
 * @param {Object} identity - Target Google identity
 * @param {string} eventId - Event ID to delete
 */
export async function deleteShadowBlock(identity, eventId) {
  const calendar = await getCalendarService(identity);

  try {
    await calendar.events.delete({
      calendarId: identity.calendarId || 'primary',
      eventId,
    });
    logger.info('Google shadow block deleted', { identityId: identity.id, eventId });
  } catch (error) {
    if (error.code === 404 || error.code === 410) {
      logger.warn('Google shadow block already deleted', { identityId: identity.id, eventId });
      return;
    }
    throw error;
  }
}

/**
 * Check if a Google event is a system-generated shadow block
 * This is critical for INFINITE LOOP PREVENTION
 * @param {Object} event - Google Calendar event object
 * @returns {boolean}
 */
export function isSystemGenerated(event) {
  const props = event.extendedProperties?.private;
  if (!props) return false;
  return props[SYSTEM_TAG_KEY] === SYSTEM_TAG_VALUE;
}
