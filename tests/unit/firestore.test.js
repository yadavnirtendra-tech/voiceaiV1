/**
 * Firestore Data Layer Tests
 * Tests the core database operations
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestUser, createTestIdentity, createTestEvent, createTestShadowBlock } from '../helpers/testUtils.js';
import { users, identities, calendarEvents, shadowBlocks, syncLogs } from '../../src/db/firestore.js';

describe('Firestore Data Layer', () => {

  describe('Users', () => {
    it('should create and retrieve a user', async () => {
      const user = await users.create(createTestUser({ email: 'db-test@gmail.com' }));
      assert.ok(user.id);
      assert.equal(user.email, 'db-test@gmail.com');

      const found = await users.findById(user.id);
      assert.ok(found);
      assert.equal(found.email, 'db-test@gmail.com');
    });

    it('should update user fields', async () => {
      const user = await users.create(createTestUser());
      const updated = await users.update(user.id, { timezone: 'America/New_York' });
      assert.equal(updated.timezone, 'America/New_York');
    });

    it('should find user by email', async () => {
      const email = `findme-${Date.now()}@gmail.com`;
      await users.create(createTestUser({ email }));
      const found = await users.findByEmail(email);
      assert.ok(found);
      assert.equal(found.email, email);
    });

    it('should return null for non-existent user', async () => {
      const found = await users.findById('non-existent-id');
      assert.equal(found, null);
    });
  });

  describe('Identities', () => {
    let userId;

    beforeEach(async () => {
      const user = await users.create(createTestUser());
      userId = user.id;
    });

    it('should create and retrieve an identity', async () => {
      const ident = await identities.create(createTestIdentity(userId));
      assert.ok(ident.id);
      assert.equal(ident.userId, userId);
      assert.equal(ident.isActive, true);
    });

    it('should upsert identity - create when new', async () => {
      const result = await identities.upsert(
        userId, 'GOOGLE_PERSONAL', 'upsert@gmail.com',
        { accessTokenEnc: 'enc1', tokenIv: 'iv1' },
        { accessTokenEnc: 'enc2' }
      );
      assert.ok(result.id);
      assert.equal(result.providerEmail, 'upsert@gmail.com');
    });

    it('should upsert identity - update when exists', async () => {
      await identities.create(createTestIdentity(userId, {
        providerType: 'GOOGLE_PERSONAL',
        providerEmail: 'existing@gmail.com',
      }));

      const result = await identities.upsert(
        userId, 'GOOGLE_PERSONAL', 'existing@gmail.com',
        { accessTokenEnc: 'create-enc', tokenIv: 'iv' },
        { accessTokenEnc: 'updated-enc' }
      );
      assert.equal(result.accessTokenEnc, 'updated-enc');
    });

    it('should find active identities by user', async () => {
      await identities.create(createTestIdentity(userId, { isActive: true }));
      await identities.create(createTestIdentity(userId, { isActive: false }));
      const active = await identities.findActiveByUser(userId);
      assert.ok(active.length >= 1);
      assert.ok(active.every(i => i.isActive === true));
    });
  });

  describe('Calendar Events', () => {
    let userId, identityId;

    beforeEach(async () => {
      const user = await users.create(createTestUser());
      userId = user.id;
      const ident = await identities.create(createTestIdentity(userId));
      identityId = ident.id;
    });

    it('should create and retrieve events', async () => {
      const event = await calendarEvents.create(createTestEvent(userId, identityId));
      assert.ok(event.id);
      const found = await calendarEvents.findById(event.id);
      assert.ok(found);
    });

    it('should find overlapping events', async () => {
      await calendarEvents.create(createTestEvent(userId, identityId, {
        startTime: '2026-06-01T10:00:00Z',
        endTime: '2026-06-01T11:00:00Z',
      }));

      const overlaps = await calendarEvents.findOverlapping(
        userId, '2026-06-01T10:30:00Z', '2026-06-01T11:30:00Z'
      );
      assert.ok(overlaps.length > 0);
    });

    it('should NOT find non-overlapping events', async () => {
      await calendarEvents.create(createTestEvent(userId, identityId, {
        startTime: '2026-06-01T10:00:00Z',
        endTime: '2026-06-01T11:00:00Z',
      }));

      const overlaps = await calendarEvents.findOverlapping(
        userId, '2026-06-01T12:00:00Z', '2026-06-01T13:00:00Z'
      );
      assert.equal(overlaps.length, 0);
    });
  });

  describe('Shadow Blocks', () => {
    let userId, sourceEventId, sourceIdentityId, targetIdentityId;

    beforeEach(async () => {
      const user = await users.create(createTestUser());
      userId = user.id;
      const srcIdent = await identities.create(createTestIdentity(userId, { providerType: 'GOOGLE_PERSONAL' }));
      sourceIdentityId = srcIdent.id;
      const tgtIdent = await identities.create(createTestIdentity(userId, { providerType: 'MICROSOFT_PERSONAL' }));
      targetIdentityId = tgtIdent.id;
      const event = await calendarEvents.create(createTestEvent(userId, sourceIdentityId));
      sourceEventId = event.id;
    });

    it('should create and find active shadow blocks', async () => {
      await shadowBlocks.create(createTestShadowBlock(userId, sourceEventId, sourceIdentityId, targetIdentityId));
      const active = await shadowBlocks.findActiveByUser(userId);
      assert.ok(active.length > 0);
    });

    it('should cancel shadow blocks by source identity', async () => {
      await shadowBlocks.create(createTestShadowBlock(userId, sourceEventId, sourceIdentityId, targetIdentityId));
      const count = await shadowBlocks.cancelBySourceIdentity(sourceIdentityId);
      assert.ok(count > 0);
      const active = await shadowBlocks.findActiveBySource(sourceEventId);
      assert.equal(active.length, 0);
    });
  });

  describe('Sync Logs', () => {
    it('should create and query sync logs', async () => {
      const user = await users.create(createTestUser());
      await syncLogs.create({
        userId: user.id,
        action: 'FULL_SYNC',
        status: 'COMPLETED',
        completedAt: new Date(),
      });

      const logs = await syncLogs.findByUser(user.id, { limit: 10 });
      assert.ok(logs.length > 0);
      assert.equal(logs[0].action, 'FULL_SYNC');
    });
  });
});
