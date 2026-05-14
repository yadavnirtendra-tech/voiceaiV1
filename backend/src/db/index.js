import prisma from './prismaClient.js';

export const users = {
  create(data) {
    return prisma.user.create({ data });
  },
  findById(id) {
    return prisma.user.findUnique({ where: { id } });
  },
  findByEmail(email) {
    return prisma.user.findUnique({ where: { email } });
  },
  update(id, data) {
    return prisma.user.update({ where: { id }, data });
  },
  findWithIdentities(id) {
    return prisma.user.findUnique({
      where: { id },
      include: {
        identities: {
          where: { isActive: true },
          select: {
            id: true,
            providerType: true,
            providerEmail: true,
            isPrimary: true,
            calendarName: true,
            lastSyncedAt: true,
          },
        },
      },
    });
  },
};

export const identities = {
  create(data) {
    return prisma.identity.create({ data });
  },
  findById(id) {
    return prisma.identity.findUnique({ where: { id } });
  },
  findByIdWithUser(id) {
    return prisma.identity.findUnique({
      where: { id },
      include: { user: true },
    });
  },
  update(id, data) {
    return prisma.identity.update({ where: { id }, data });
  },
  findByUserAndProvider(userId, providerType, providerEmail) {
    return prisma.identity.findUnique({
      where: {
        userId_providerType_providerEmail: {
          userId,
          providerType,
          providerEmail,
        },
      },
    });
  },
  async upsert(userId, providerType, providerEmail, createData, updateData) {
    return prisma.identity.upsert({
      where: {
        userId_providerType_providerEmail: {
          userId,
          providerType,
          providerEmail,
        },
      },
      update: updateData,
      create: {
        userId,
        providerType,
        providerEmail,
        ...createData,
      },
    });
  },
  findActiveByUser(userId) {
    return prisma.identity.findMany({
      where: { userId, isActive: true },
    });
  },
  findActiveByUserExcluding(userId, excludeId) {
    return prisma.identity.findMany({
      where: { userId, isActive: true, id: { not: excludeId } },
    });
  },
  countActiveByUser(userId) {
    return prisma.identity.count({
      where: { userId, isActive: true },
    });
  },
};

export const calendarEvents = {
  create(data) {
    return prisma.calendarEvent.create({ data });
  },
  findById(id) {
    return prisma.calendarEvent.findUnique({ where: { id } });
  },
  update(id, data) {
    return prisma.calendarEvent.update({ where: { id }, data });
  },
  findByIdentityAndExternalId(identityId, externalEventId) {
    return prisma.calendarEvent.findUnique({
      where: {
        identityId_externalEventId: {
          identityId,
          externalEventId,
        },
      },
    });
  },
  async upsert(identityId, externalEventId, createData, updateData) {
    return prisma.calendarEvent.upsert({
      where: {
        identityId_externalEventId: {
          identityId,
          externalEventId,
        },
      },
      update: updateData,
      create: {
        identityId,
        externalEventId,
        ...createData,
      },
    });
  },
  findOverlapping(userId, startTime, endTime, excludeIdentityId = null, excludeEventId = null) {
    const start = startTime instanceof Date ? startTime : new Date(startTime);
    const end = endTime instanceof Date ? endTime : new Date(endTime);
    
    const where = {
      userId,
      status: { not: 'CANCELLED' },
      isSystemGenerated: false,
      busyStatus: { in: ['BUSY', 'OUT_OF_OFFICE'] },
      startTime: { lt: end },
      endTime: { gt: start },
    };
    
    if (excludeIdentityId) where.identityId = { not: excludeIdentityId };
    if (excludeEventId) where.id = { not: excludeEventId };
    
    return prisma.calendarEvent.findMany({ where });
  },
  findByUser(userId, options = {}) {
    const where = { 
      userId,
      identity: { isActive: true }
    };
    if (options.excludeCancelled) where.status = { not: 'CANCELLED' };
    if (options.status) where.status = options.status;
    if (options.excludeSystemGenerated) where.isSystemGenerated = false;
    if (options.startAfter) where.startTime = { gte: new Date(options.startAfter) };
    if (options.endBefore) where.endTime = { lte: new Date(options.endBefore) };
    
    return prisma.calendarEvent.findMany({
      where,
      orderBy: { startTime: 'asc' },
      take: options.limit,
    });
  },
  countByUser(userId, options = {}) {
    const where = { 
      userId,
      identity: { isActive: true }
    };
    if (options.status) where.status = options.status;
    return prisma.calendarEvent.count({ where });
  },
  findBusySlots(userId, startTime, endTime) {
    const start = startTime instanceof Date ? startTime : new Date(startTime);
    const end = endTime instanceof Date ? endTime : new Date(endTime);
    
    return prisma.calendarEvent.findMany({
      where: {
        userId,
        identity: { isActive: true },
        status: 'CONFIRMED',
        busyStatus: { in: ['BUSY', 'OUT_OF_OFFICE'] },
        isSystemGenerated: false,
        startTime: { lt: end },
        endTime: { gt: start },
      },
      include: {
        identity: {
          select: { providerType: true, providerEmail: true, calendarName: true },
        },
      },
      orderBy: { startTime: 'asc' },
    });
  },
};

export const shadowBlocks = {
  create(data) {
    return prisma.shadowBlock.create({ data });
  },
  findById(id) {
    return prisma.shadowBlock.findUnique({ where: { id } });
  },
  update(id, data) {
    return prisma.shadowBlock.update({ where: { id }, data });
  },
  findActiveBySourceAndTarget(sourceEventId, targetIdentityId) {
    return prisma.shadowBlock.findFirst({
      where: { sourceEventId, targetIdentityId, status: 'ACTIVE' },
    });
  },
  findActiveBySource(sourceEventId) {
    return prisma.shadowBlock.findMany({
      where: { sourceEventId, status: 'ACTIVE' },
    });
  },
  findActiveByUser(userId) {
    return prisma.shadowBlock.findMany({
      where: { userId, status: 'ACTIVE' },
      orderBy: { startTime: 'asc' },
    });
  },
  findOverlapping(userId, startTime, endTime, excludeIdentityId = null) {
    const start = startTime instanceof Date ? startTime : new Date(startTime);
    const end = endTime instanceof Date ? endTime : new Date(endTime);
    
    const where = {
      userId,
      status: 'ACTIVE',
      startTime: { lt: end },
      endTime: { gt: start },
    };
    if (excludeIdentityId) where.sourceIdentityId = { not: excludeIdentityId };
    
    return prisma.shadowBlock.findMany({ where });
  },
  countActiveByUser(userId) {
    return prisma.shadowBlock.count({
      where: { userId, status: 'ACTIVE' },
    });
  },
  cancelBySourceIdentity(sourceIdentityId) {
    return prisma.shadowBlock.updateMany({
      where: { sourceIdentityId, status: 'ACTIVE' },
      data: { status: 'CANCELLED' },
    });
  },
};

export const syncLogs = {
  create(data) {
    return prisma.syncLog.create({ data });
  },
  update(id, data) {
    return prisma.syncLog.update({ where: { id }, data });
  },
  findByUser(userId, options = {}) {
    const where = { userId };
    if (options.action) where.action = options.action;
    
    return prisma.syncLog.findMany({
      where,
      orderBy: { startedAt: 'desc' },
      take: options.limit,
    });
  },
  countRecent(userId, hours = 24) {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    return prisma.syncLog.count({
      where: { userId, startedAt: { gte: since } },
    });
  },
  async findRecentByExternalEvent(externalEventId, identityId, windowMs = 300000) {
    const since = new Date(Date.now() - windowMs);
    const count = await prisma.syncLog.count({
      where: {
        externalEventId,
        identityId,
        status: 'COMPLETED',
        startedAt: { gte: since },
      },
    });
    return count > 0;
  },
};

export const webhookSubscriptions = {
  create(data) {
    return prisma.webhookSubscription.create({ data });
  },
  findById(id) {
    return prisma.webhookSubscription.findUnique({ where: { id } });
  },
  update(id, data) {
    return prisma.webhookSubscription.update({ where: { id }, data });
  },
  findActiveBySubscriptionId(subscriptionId) {
    return prisma.webhookSubscription.findUnique({
      where: { subscriptionId },
    });
  },
  findExpiringByProvider(providerTypes, beforeDate) {
    const before = beforeDate instanceof Date ? beforeDate : new Date(beforeDate);
    return prisma.webhookSubscription.findMany({
      where: {
        isActive: true,
        providerType: { in: providerTypes },
        expiresAt: { lt: before },
      },
      include: { identity: true },
    });
  },
  deactivateByIdentity(identityId) {
    return prisma.webhookSubscription.updateMany({
      where: { identityId, isActive: true },
      data: { isActive: false },
    });
  },
};

export default { users, identities, calendarEvents, shadowBlocks, syncLogs, webhookSubscriptions };
