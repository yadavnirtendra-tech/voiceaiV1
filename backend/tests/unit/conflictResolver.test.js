/**
 * Conflict Resolver Tests
 * Tests the core conflict detection and resolution logic
 */
import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestUser, createTestIdentity, createTestEvent } from '../helpers/testUtils.js';
import { users, identities, calendarEvents, shadowBlocks } from '../../src/db/firestore.js';
import { checkConflicts, resolveConflict } from '../../src/services/sync/conflictResolver.js';

describe('Conflict Resolver', () => {
  let userId, googleIdentityId, msIdentityId;

  beforeEach(async () => {
    // Create fresh test user and identities
    const user = await users.create(createTestUser());
    userId = user.id;

    const googleIdent = await identities.create(createTestIdentity(userId, {
      providerType: 'GOOGLE_PERSONAL',
      providerEmail: 'test@gmail.com',
    }));
    googleIdentityId = googleIdent.id;

    const msIdent = await identities.create(createTestIdentity(userId, {
      providerType: 'MICROSOFT_PERSONAL',
      providerEmail: 'test@outlook.com',
    }));
    msIdentityId = msIdent.id;
  });

  describe('checkConflicts', () => {
    it('should detect no conflicts when no overlapping events exist', async () => {
      const now = new Date();
      const start = new Date(now.getTime() + 86400000); // Tomorrow
      const end = new Date(now.getTime() + 90000000);   // Tomorrow + 1hr

      const result = await checkConflicts(userId, start, end);
      assert.equal(result.hasConflict, false);
      assert.equal(result.conflicts.length, 0);
    });

    it('should detect conflict when Google event overlaps with Outlook time', async () => {
      const start = new Date('2026-06-01T10:00:00Z');
      const end = new Date('2026-06-01T11:00:00Z');

      // Create a Google event from 10:00 to 11:00
      await calendarEvents.create(createTestEvent(userId, googleIdentityId, {
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        title: 'Google Meeting',
      }));

      // Check for conflict with overlapping time on Outlook
      const overlapStart = new Date('2026-06-01T10:30:00Z');
      const overlapEnd = new Date('2026-06-01T11:30:00Z');

      const result = await checkConflicts(userId, overlapStart, overlapEnd, msIdentityId);
      assert.equal(result.hasConflict, true);
      assert.ok(result.conflicts.length > 0);
      assert.equal(result.conflicts[0].title, 'Google Meeting');
    });

    it('should NOT conflict when events do not overlap', async () => {
      // Event from 10:00-11:00
      await calendarEvents.create(createTestEvent(userId, googleIdentityId, {
        startTime: '2026-06-01T10:00:00Z',
        endTime: '2026-06-01T11:00:00Z',
      }));

      // Check 12:00-13:00 — no overlap
      const result = await checkConflicts(userId, '2026-06-01T12:00:00Z', '2026-06-01T13:00:00Z', msIdentityId);
      assert.equal(result.hasConflict, false);
    });

    it('should exclude events from the same identity', async () => {
      await calendarEvents.create(createTestEvent(userId, googleIdentityId, {
        startTime: '2026-06-01T10:00:00Z',
        endTime: '2026-06-01T11:00:00Z',
      }));

      // Check same time, same identity — should NOT conflict
      const result = await checkConflicts(userId, '2026-06-01T10:00:00Z', '2026-06-01T11:00:00Z', googleIdentityId);
      assert.equal(result.hasConflict, false);
    });

    it('should ignore cancelled events', async () => {
      await calendarEvents.create(createTestEvent(userId, googleIdentityId, {
        startTime: '2026-06-01T10:00:00Z',
        endTime: '2026-06-01T11:00:00Z',
        status: 'CANCELLED',
      }));

      const result = await checkConflicts(userId, '2026-06-01T10:00:00Z', '2026-06-01T11:00:00Z', msIdentityId);
      assert.equal(result.hasConflict, false);
    });

    it('should ignore FREE events', async () => {
      await calendarEvents.create(createTestEvent(userId, googleIdentityId, {
        startTime: '2026-06-01T10:00:00Z',
        endTime: '2026-06-01T11:00:00Z',
        busyStatus: 'FREE',
      }));

      const result = await checkConflicts(userId, '2026-06-01T10:00:00Z', '2026-06-01T11:00:00Z', msIdentityId);
      assert.equal(result.hasConflict, false);
    });

    it('should detect multiple overlapping conflicts', async () => {
      // Two overlapping events on Google
      await calendarEvents.create(createTestEvent(userId, googleIdentityId, {
        startTime: '2026-06-01T09:00:00Z',
        endTime: '2026-06-01T10:30:00Z',
        title: 'Morning Meeting',
      }));
      await calendarEvents.create(createTestEvent(userId, googleIdentityId, {
        startTime: '2026-06-01T10:00:00Z',
        endTime: '2026-06-01T11:00:00Z',
        title: 'Late Morning Meeting',
      }));

      const result = await checkConflicts(userId, '2026-06-01T09:30:00Z', '2026-06-01T10:30:00Z', msIdentityId);
      assert.equal(result.hasConflict, true);
      assert.ok(result.conflicts.length >= 2);
    });
  });

  describe('resolveConflict', () => {
    it('should PROCEED with BLOCK_ALL strategy', async () => {
      const result = await resolveConflict(userId, { identityId: googleIdentityId }, []);
      assert.equal(result.action, 'PROCEED');
    });

    it('should PROCEED with PRIORITY_BASED when source has higher priority', async () => {
      await users.update(userId, { conflictStrategy: 'PRIORITY_BASED' });
      
      // Google was created first, so it has higher priority
      const result = await resolveConflict(userId, { identityId: googleIdentityId }, [
        { type: 'EVENT', identityId: msIdentityId },
      ]);
      assert.equal(result.action, 'PROCEED');
    });

    it('should return NOTIFY with MANUAL_RESOLVE strategy', async () => {
      await users.update(userId, { conflictStrategy: 'MANUAL_RESOLVE' });

      const conflicts = [{ type: 'EVENT', title: 'Conflict Meeting' }];
      const result = await resolveConflict(userId, { identityId: googleIdentityId }, conflicts);
      assert.equal(result.action, 'NOTIFY');
    });
  });
});
