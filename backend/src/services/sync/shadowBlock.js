/**
 * Shadow Block Service - Creates/updates/deletes blocker events across providers
 * Uses Prisma/PostgreSQL for all database operations
 */
import * as googleCal from '../google/calendar.service.js';
import * as msCal from '../microsoft/calendar.service.js';
import { GOOGLE_PROVIDERS, MICROSOFT_PROVIDERS, SHADOW_BLOCK_TITLE } from '../../utils/constants.js';
import { identities, shadowBlocks, syncLogs, users } from '../../db/index.js';
import logger from '../../utils/logger.js';

function getSyncDirection(src, tgt) {
  const sG = GOOGLE_PROVIDERS.includes(src);
  const tG = GOOGLE_PROVIDERS.includes(tgt);
  if (sG && !tG) return 'GOOGLE_TO_MICROSOFT';
  if (!sG && tG) return 'MICROSOFT_TO_GOOGLE';
  if (sG && tG) return 'GOOGLE_TO_GOOGLE';
  return 'MICROSOFT_TO_MICROSOFT';
}

export async function createShadowBlocks(userId, sourceEvent, sourceIdentity) {
  const targets = await identities.findActiveByUserExcluding(userId, sourceIdentity.id);
  if (!targets.length) return [];
  
  const user = await users.findById(userId);
  const userTimezone = user?.timezone || 'UTC';

  const results = [];
  for (const target of targets) {
    try {
      const isGT = GOOGLE_PROVIDERS.includes(target.providerType);
      const isMT = MICROSOFT_PROVIDERS.includes(target.providerType);
      const data = {
        title: SHADOW_BLOCK_TITLE,
        startTime: sourceEvent.startTime,
        endTime: sourceEvent.endTime,
        description: `Synced from ${sourceIdentity.providerEmail} | ${sourceEvent.title}`,
        sourceEventId: sourceEvent.id,
        sourceProvider: sourceIdentity.providerType,
        timeZone: userTimezone,
      };

      const existing = await shadowBlocks.findActiveBySourceAndTarget(sourceEvent.id, target.id);
      let block = existing;
      let ext;

      if (block) {
        try {
          await updateShadowBlock(block, target, sourceEvent, userTimezone);
        } catch (err) {
          const isDeleted = err.message?.includes('404') || err.code === 404 || err.code === 410 || err.message?.includes('not found');
          if (isDeleted) {
            logger.info('Shadow block was manually deleted, will recreate', { targetId: target.id });
            block = null; // Recreate
          } else {
            throw err;
          }
        }
      }

      if (!block) {
        if (isGT) ext = await googleCal.createShadowBlock(target, data);
        else if (isMT) ext = await msCal.createShadowBlock(target, data);
        
        if (ext) {
          block = await shadowBlocks.create({
            userId,
            sourceEventId: sourceEvent.id,
            sourceIdentityId: sourceIdentity.id,
            targetIdentityId: target.id,
            targetExternalId: ext.id,
            title: SHADOW_BLOCK_TITLE,
            startTime: sourceEvent.startTime,
            endTime: sourceEvent.endTime,
            status: 'ACTIVE',
          });
        }
      }

      if (block) {
        await syncLogs.create({
          userId,
          identityId: target.id,
          action: 'SHADOW_CREATED',
          status: 'COMPLETED',
          sourceEventId: sourceEvent.id,
          targetEventId: block.id,
          externalEventId: ext ? ext.id : (existing ? existing.targetExternalId : null),
          providerType: target.providerType,
          direction: getSyncDirection(sourceIdentity.providerType, target.providerType),
          completedAt: new Date(),
          metadata: { 
            sourceEmail: sourceIdentity.providerEmail, 
            targetEmail: target.providerEmail,
            isUpdate: !!existing 
          },
        });
        results.push(block);
      }
    } catch (error) {
      logger.error('Shadow block creation failed', { targetId: target.id, error: error.message });
      await syncLogs.create({
        userId,
        identityId: target.id,
        action: 'SHADOW_CREATED',
        status: 'FAILED',
        sourceEventId: sourceEvent.id,
        providerType: target.providerType,
        errorMessage: error.message,
        completedAt: new Date(),
      });
    }
  }
  return results;
}

async function updateShadowBlock(block, target, event, userTimezone = 'UTC') {
  try {
    const updates = { startTime: event.startTime, endTime: event.endTime, timeZone: userTimezone };
    if (GOOGLE_PROVIDERS.includes(target.providerType) && block.targetExternalId)
      await googleCal.updateShadowBlock(target, block.targetExternalId, updates);
    else if (MICROSOFT_PROVIDERS.includes(target.providerType) && block.targetExternalId)
      await msCal.updateShadowBlock(target, block.targetExternalId, updates);
    await shadowBlocks.update(block.id, {
      startTime: new Date(event.startTime).toISOString(),
      endTime: new Date(event.endTime).toISOString(),
    });
  } catch (e) {
    logger.error('Shadow block update failed', { blockId: block.id, error: e.message });
  }
}

export async function deleteShadowBlocks(sourceEventId) {
  const blocks = await shadowBlocks.findActiveBySource(sourceEventId);
  for (const block of blocks) {
    try {
      const target = await identities.findById(block.targetIdentityId);
      if (!target || !block.targetExternalId) continue;
      if (GOOGLE_PROVIDERS.includes(target.providerType))
        await googleCal.deleteShadowBlock(target, block.targetExternalId);
      else if (MICROSOFT_PROVIDERS.includes(target.providerType))
        await msCal.deleteShadowBlock(target, block.targetExternalId);
      await shadowBlocks.update(block.id, { status: 'CANCELLED' });
      await syncLogs.create({
        userId: block.userId,
        identityId: block.targetIdentityId,
        action: 'SHADOW_DELETED',
        status: 'COMPLETED',
        sourceEventId: block.sourceEventId,
        targetEventId: block.id,
        providerType: target.providerType,
        completedAt: new Date(),
      });
    } catch (e) {
      logger.error('Shadow block deletion failed', { blockId: block.id, error: e.message });
    }
  }
}
