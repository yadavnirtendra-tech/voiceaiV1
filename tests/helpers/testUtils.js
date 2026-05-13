/**
 * Test Helper - utilities for test data creation
 */

// Set test environment before any imports
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-key-for-testing-only';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);

let _counter = 0;
function uid() { return `${Date.now()}-${++_counter}-${Math.random().toString(36).slice(2, 6)}`; }
process.env.FIREBASE_SERVICE_ACCOUNT_PATH = '';

/**
 * Create test data helpers
 */
export function createTestUser(overrides = {}) {
  return {
    email: `testuser-${uid()}@gmail.com`,
    displayName: 'Test User',
    timezone: 'UTC',
    conflictStrategy: 'BLOCK_ALL',
    autoSyncEnabled: true,
    ...overrides,
  };
}

export function createTestIdentity(userId, overrides = {}) {
  return {
    userId,
    providerType: 'GOOGLE_PERSONAL',
    providerEmail: `test-${uid()}@gmail.com`,
    providerAccountId: `goog-${uid()}`,
    accessTokenEnc: 'enc-access-token',
    refreshTokenEnc: 'enc-refresh-token',
    tokenIv: 'test-iv-base64',
    tokenExpiresAt: new Date(Date.now() + 3600000).toISOString(),
    calendarId: 'primary',
    calendarName: 'Primary Calendar',
    isActive: true,
    isPrimary: false,
    ...overrides,
  };
}

export function createTestEvent(userId, identityId, overrides = {}) {
  const now = new Date();
  const start = new Date(now.getTime() + 3600000); // 1 hour from now
  const end = new Date(now.getTime() + 7200000);   // 2 hours from now
  return {
    userId,
    identityId,
    externalEventId: `ext-${uid()}`,
    externalCalendarId: 'primary',
    title: 'Test Meeting',
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    status: 'CONFIRMED',
    busyStatus: 'BUSY',
    isSystemGenerated: false,
    ...overrides,
  };
}

export function createTestShadowBlock(userId, sourceEventId, sourceIdentityId, targetIdentityId, overrides = {}) {
  const now = new Date();
  return {
    userId,
    sourceEventId,
    sourceIdentityId,
    targetIdentityId,
    targetExternalId: `shadow-ext-${uid()}`,
    title: 'Reserved (CalendarSync)',
    startTime: new Date(now.getTime() + 3600000).toISOString(),
    endTime: new Date(now.getTime() + 7200000).toISOString(),
    status: 'ACTIVE',
    ...overrides,
  };
}

/**
 * Wait utility for async operations
 */
export function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
