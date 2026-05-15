/**
 * Availability Service Tests
 * Tests the unified availability computation
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestUser, createTestIdentity, createTestEvent } from '../helpers/testUtils.js';
import { users, identities, calendarEvents } from '../../src/db/index.js';
import { getAvailability, isSlotAvailable } from '../../src/services/availability/globalProfile.js';

describe('Availability Service', () => {
  let userId, googleIdentityId, msIdentityId;

  beforeEach(async () => {
    const user = await users.create(createTestUser());
    userId = user.id;

    const gIdent = await identities.create(createTestIdentity(userId, {
      providerType: 'GOOGLE_PERSONAL',
      providerEmail: 'avail@gmail.com',
    }));
    googleIdentityId = gIdent.id;

    const mIdent = await identities.create(createTestIdentity(userId, {
      providerType: 'MICROSOFT_PERSONAL',
      providerEmail: 'avail@outlook.com',
    }));
    msIdentityId = mIdent.id;
  });

  describe('getAvailability', () => {
    it('should return empty slots when no events exist', async () => {
      const result = await getAvailability(userId, new Date('2026-06-01'), new Date('2026-06-02'));
      assert.equal(result.slots.length, 0);
      assert.equal(result.mergedSlots.length, 0);
    });

    it('should return busy slots from both providers', async () => {
      await calendarEvents.create(createTestEvent(userId, googleIdentityId, {
        startTime: '2026-06-01T10:00:00Z',
        endTime: '2026-06-01T11:00:00Z',
        title: 'Google Meeting',
      }));
      await calendarEvents.create(createTestEvent(userId, msIdentityId, {
        startTime: '2026-06-01T14:00:00Z',
        endTime: '2026-06-01T15:00:00Z',
        title: 'Outlook Meeting',
      }));

      const result = await getAvailability(userId, new Date('2026-06-01'), new Date('2026-06-02'));
      assert.equal(result.slots.length, 2);
    });

    it('should merge overlapping slots', async () => {
      await calendarEvents.create(createTestEvent(userId, googleIdentityId, {
        startTime: '2026-06-01T10:00:00Z',
        endTime: '2026-06-01T11:00:00Z',
        title: 'Meeting 1',
      }));
      await calendarEvents.create(createTestEvent(userId, msIdentityId, {
        startTime: '2026-06-01T10:30:00Z',
        endTime: '2026-06-01T11:30:00Z',
        title: 'Meeting 2',
      }));

      const result = await getAvailability(userId, new Date('2026-06-01'), new Date('2026-06-02'));
      assert.equal(result.slots.length, 2);
      assert.equal(result.mergedSlots.length, 1); // Should merge into 1
    });
  });

  describe('isSlotAvailable', () => {
    it('should return true when no events overlap', async () => {
      const available = await isSlotAvailable(userId, '2026-06-01T10:00:00Z', '2026-06-01T11:00:00Z');
      assert.equal(available, true);
    });

    it('should return false when a busy event overlaps', async () => {
      await calendarEvents.create(createTestEvent(userId, googleIdentityId, {
        startTime: '2026-06-01T10:00:00Z',
        endTime: '2026-06-01T11:00:00Z',
      }));

      const available = await isSlotAvailable(userId, '2026-06-01T10:30:00Z', '2026-06-01T11:30:00Z');
      assert.equal(available, false);
    });
  });
});
