/**
 * Microsoft Calendar Operations Service
 * CRUD operations via Microsoft Graph API for Outlook Calendar
 */
import { getAccessToken } from './auth.service.js';
import { SYSTEM_TAG_KEY, SYSTEM_TAG_VALUE, SHADOW_BLOCK_TITLE, MS_GRAPH_BASE_URL } from '../../utils/constants.js';
import logger from '../../utils/logger.js';

function formatDateTimeTz(dateStr, timeZone) {
  const date = new Date(dateStr);
  if (timeZone === 'UTC') return date.toISOString().replace('Z', '');
  
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(date);
  
  const map = {};
  for (const part of parts) map[part.type] = part.value;
  if (map.hour === '24') map.hour = '00';
  
  return `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}:${map.second}.000`;
}

/**
 * Helper: Make an authenticated Microsoft Graph API call
 */
async function graphFetch(identity, endpoint, options = {}) {
  const token = await getAccessToken(identity);
  
  const response = await fetch(`${MS_GRAPH_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Prefer': 'outlook.timezone="UTC"',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Graph API error ${response.status}: ${errorBody}`);
  }

  if (response.status === 204) return null; // No content (e.g., DELETE)
  return response.json();
}

/**
 * List events from Outlook Calendar
 * Supports delta queries for incremental sync
 * @param {Object} identity - Identity record
 * @param {Object} options - Query options
 * @returns {Object} { events, deltaLink }
 */
export async function listEvents(identity, options = {}) {
  let endpoint;

  if (options.deltaLink) {
    // Use delta link for incremental sync
    // Delta links are full URLs, so we need to strip the base
    endpoint = options.deltaLink.replace(MS_GRAPH_BASE_URL, '');
  } else {
    const timeMin = options.timeMin || new Date().toISOString();
    const timeMax = options.timeMax || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    
    endpoint = `/me/calendarView?startDateTime=${timeMin}&endDateTime=${timeMax}&$top=${options.maxResults || 250}&$orderby=start/dateTime`;
  }

  try {
    const data = await graphFetch(identity, endpoint);
    
    return {
      events: data.value || [],
      deltaLink: data['@odata.deltaLink'],
      nextLink: data['@odata.nextLink'],
    };
  } catch (error) {
    // If delta token is expired, do a full sync
    if (error.message.includes('410') || error.message.includes('syncStateNotFound')) {
      logger.warn('Microsoft delta token expired, performing full sync', { identityId: identity.id });
      const timeMin = new Date().toISOString();
      const timeMax = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const fallbackEndpoint = `/me/calendarView?startDateTime=${timeMin}&endDateTime=${timeMax}&$top=250`;
      const data = await graphFetch(identity, fallbackEndpoint);
      return {
        events: data.value || [],
        deltaLink: data['@odata.deltaLink'],
      };
    }
    throw error;
  }
}

/**
 * Get a single event by ID
 * @param {Object} identity - Identity record
 * @param {string} eventId - Outlook event ID
 * @returns {Object|null} Event data
 */
export async function getEvent(identity, eventId) {
  try {
    return await graphFetch(identity, `/me/events/${eventId}`);
  } catch (error) {
    if (error.message.includes('404')) return null;
    throw error;
  }
}

/**
 * Create a Shadow Block event in Outlook Calendar
 * Maps to a "Private" event with "Busy" show-as status
 * 
 * @param {Object} identity - Target Microsoft identity
 * @param {Object} eventData - { title, startTime, endTime, description }
 * @returns {Object} Created event
 */
export async function createShadowBlock(identity, eventData) {
  const event = {
    subject: eventData.title || SHADOW_BLOCK_TITLE,
    body: {
      contentType: 'text',
      content: eventData.description || 'This time slot has been reserved by OpenCalendar.',
    },
    start: {
      dateTime: formatDateTimeTz(eventData.startTime, eventData.timeZone || 'UTC'),
      timeZone: eventData.timeZone || 'UTC',
    },
    end: {
      dateTime: formatDateTimeTz(eventData.endTime, eventData.timeZone || 'UTC'),
      timeZone: eventData.timeZone || 'UTC',
    },
    // Mark as busy
    showAs: 'busy',
    // Private visibility
    sensitivity: 'private',
    // System tag in extended properties (LOOP PREVENTION)
    singleValueExtendedProperties: [
      {
        id: `String {66f5a359-4659-4830-9070-00047ec6ac6e} Name ${SYSTEM_TAG_KEY}`,
        value: SYSTEM_TAG_VALUE,
      },
      {
        id: `String {66f5a359-4659-4830-9070-00047ec6ac6e} Name sourceEventId`,
        value: eventData.sourceEventId || '',
      },
      {
        id: `String {66f5a359-4659-4830-9070-00047ec6ac6e} Name sourceProvider`,
        value: eventData.sourceProvider || '',
      },
    ],
    // No reminders for shadow blocks
    isReminderOn: false,
    // Categories for visual distinction
    categories: ['CalendarSync Block'],
  };

  const result = await graphFetch(identity, '/me/events', {
    method: 'POST',
    body: JSON.stringify(event),
  });

  logger.info('Microsoft shadow block created', {
    identityId: identity.id,
    eventId: result.id,
    start: eventData.startTime,
    end: eventData.endTime,
  });

  return result;
}

/**
 * Update a Shadow Block event
 * @param {Object} identity - Target Microsoft identity
 * @param {string} eventId - Event ID to update
 * @param {Object} updates - Updated fields
 * @returns {Object} Updated event
 */
export async function updateShadowBlock(identity, eventId, updates) {
  const patch = {};
  
  if (updates.startTime) {
    const tz = updates.timeZone || 'UTC';
    patch.start = { dateTime: formatDateTimeTz(updates.startTime, tz), timeZone: tz };
  }
  if (updates.endTime) {
    const tz = updates.timeZone || 'UTC';
    patch.end = { dateTime: formatDateTimeTz(updates.endTime, tz), timeZone: tz };
  }
  if (updates.title) {
    patch.subject = updates.title;
  }

  return graphFetch(identity, `/me/events/${eventId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

/**
 * Delete a Shadow Block event
 * @param {Object} identity - Target Microsoft identity
 * @param {string} eventId - Event ID to delete
 */
export async function deleteShadowBlock(identity, eventId) {
  try {
    await graphFetch(identity, `/me/events/${eventId}`, { method: 'DELETE' });
    logger.info('Microsoft shadow block deleted', { identityId: identity.id, eventId });
  } catch (error) {
    if (error.message.includes('404')) {
      logger.warn('Microsoft shadow block already deleted', { identityId: identity.id, eventId });
      return;
    }
    throw error;
  }
}

/**
 * Check if a Microsoft event is a system-generated shadow block
 * Critical for INFINITE LOOP PREVENTION
 * @param {Object} event - Microsoft Graph event object
 * @returns {boolean}
 */
export function isSystemGenerated(event) {
  const props = event.singleValueExtendedProperties;
  if (!props || !Array.isArray(props)) return false;
  
  return props.some(p => 
    p.id?.includes(SYSTEM_TAG_KEY) && p.value === SYSTEM_TAG_VALUE
  );
}
