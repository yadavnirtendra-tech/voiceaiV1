import config from '../config/env.js';

export const SYNC_ORIGIN = config.sync.originTag;
export const SHADOW_BLOCK_TITLE = config.sync.shadowBlockTitle;

// Provider type classifications
export const GOOGLE_PROVIDERS = ['GOOGLE_PERSONAL', 'GOOGLE_WORKSPACE'];
export const MICROSOFT_PROVIDERS = ['MICROSOFT_PERSONAL', 'MICROSOFT_365'];

// Sync State Machine States
export const SYNC_STATES = {
  IDLE: 'IDLE',
  WEBHOOK_RECEIVED: 'WEBHOOK_RECEIVED',
  LOOP_CHECK: 'LOOP_CHECK',
  FETCH_EVENT: 'FETCH_EVENT',
  CONFLICT_CHECK: 'CONFLICT_CHECK',
  SHADOW_BLOCK: 'SHADOW_BLOCK',
  BROADCAST: 'BROADCAST',
  SYNC_LOG: 'SYNC_LOG',
  IGNORED: 'IGNORED',
  CONFLICT_RESOLVE: 'CONFLICT_RESOLVE',
  NOTIFY_USER: 'NOTIFY_USER',
  ERROR: 'ERROR',
};

// Extended properties key used to tag system-generated events
export const SYSTEM_TAG_KEY = 'calendarSyncOrigin';
export const SYSTEM_TAG_VALUE = config.sync.originTag;

// Google Calendar API constants
export const GOOGLE_CALENDAR_SCOPES = config.google.scopes;
export const GOOGLE_WEBHOOK_CHANNEL_TTL = 7 * 24 * 60 * 60; // 7 days in seconds

// Microsoft Graph API constants
export const MS_GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';
export const MS_SUBSCRIPTION_TTL_MINUTES = 4230; // ~2.9 days (max for calendars)

// Time constants
export const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000; // Refresh 5 min before expiry
export const WEBHOOK_RENEWAL_BUFFER_MS = 60 * 60 * 1000; // Renew 1 hour before expiry
