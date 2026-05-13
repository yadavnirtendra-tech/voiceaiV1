/**
 * Loop Guard Tests
 * Tests infinite loop prevention for cross-calendar sync
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { shouldProcessEvent, markAsProcessed, _getProcessedCache } from '../../src/services/sync/loopGuard.js';

describe('Loop Guard', () => {
  beforeEach(() => {
    // Clear the in-memory cache
    _getProcessedCache().clear();
  });

  describe('shouldProcessEvent', () => {
    it('should process a normal user event', () => {
      const event = { id: 'event-123', summary: 'Team Standup' };
      const result = shouldProcessEvent(event, 'GOOGLE_PERSONAL', 'identity-1');
      assert.equal(result.shouldProcess, true);
      assert.equal(result.reason, 'USER_EVENT');
    });

    it('should skip Google system-generated events', () => {
      const event = {
        id: 'event-456',
        summary: 'Some Event',
        extendedProperties: {
          private: {
            calendarSyncOrigin: 'calendarsync-ai-system',
          },
        },
      };
      const result = shouldProcessEvent(event, 'GOOGLE_PERSONAL', 'identity-1');
      assert.equal(result.shouldProcess, false);
      assert.equal(result.reason, 'SYSTEM_GENERATED_TAG');
    });

    it('should skip Microsoft system-generated events', () => {
      const event = {
        id: 'event-789',
        subject: 'Some Event',
        singleValueExtendedProperties: [
          {
            id: 'String {66f5a359-4659-4830-9070-00047ec6ac6e} Name calendarSyncOrigin',
            value: 'calendarsync-ai-system',
          },
        ],
      };
      const result = shouldProcessEvent(event, 'MICROSOFT_PERSONAL', 'identity-2');
      assert.equal(result.shouldProcess, false);
      assert.equal(result.reason, 'SYSTEM_GENERATED_TAG');
    });

    it('should skip recently processed events', () => {
      const event = { id: 'event-repeat', summary: 'Meeting' };
      const identityId = 'identity-1';

      // First time: should process
      const first = shouldProcessEvent(event, 'GOOGLE_PERSONAL', identityId);
      assert.equal(first.shouldProcess, true);

      // Mark as processed
      markAsProcessed('event-repeat', identityId);

      // Second time: should skip
      const second = shouldProcessEvent(event, 'GOOGLE_PERSONAL', identityId);
      assert.equal(second.shouldProcess, false);
      assert.equal(second.reason, 'RECENTLY_PROCESSED');
    });

    it('should skip events with shadow block title pattern', () => {
      const event = { id: 'event-shadow', summary: 'Reserved (CalendarSync)' };
      const result = shouldProcessEvent(event, 'GOOGLE_PERSONAL', 'identity-1');
      assert.equal(result.shouldProcess, false);
      assert.equal(result.reason, 'SHADOW_BLOCK_TITLE_MATCH');
    });

    it('should process events with similar but different titles', () => {
      const event = { id: 'event-ok', summary: 'Calendar Sync Discussion' };
      const result = shouldProcessEvent(event, 'GOOGLE_PERSONAL', 'identity-1');
      // Should process because it doesn't match both "CalendarSync" AND "Reserved"
      assert.equal(result.shouldProcess, true);
    });

    it('should handle Microsoft event format with subject field', () => {
      const event = { id: 'ms-event', subject: 'Team Meeting' };
      const result = shouldProcessEvent(event, 'MICROSOFT_365', 'identity-3');
      assert.equal(result.shouldProcess, true);
    });
  });

  describe('markAsProcessed', () => {
    it('should add event to processed cache', () => {
      markAsProcessed('evt-1', 'id-1');
      const cache = _getProcessedCache();
      assert.ok(cache.has('id-1:evt-1'));
    });

    it('should prevent same event from being processed again', () => {
      markAsProcessed('evt-2', 'id-1');
      const event = { id: 'evt-2', summary: 'Test' };
      const result = shouldProcessEvent(event, 'GOOGLE_PERSONAL', 'id-1');
      assert.equal(result.shouldProcess, false);
    });

    it('should allow same event on different identity', () => {
      markAsProcessed('evt-3', 'id-1');
      const event = { id: 'evt-3', summary: 'Test' };
      // Different identity should still process
      const result = shouldProcessEvent(event, 'GOOGLE_PERSONAL', 'id-2');
      assert.equal(result.shouldProcess, true);
    });
  });
});
