/**
 * Calendar & User API Routes
 * Uses Firestore for all database operations
 */
import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { apiLimiter } from '../middleware/rateLimiter.js';
import { getAvailability, isSlotAvailable } from '../services/availability/globalProfile.js';
import { fullSync } from '../services/sync/engine.js';
import { users, identities, calendarEvents, shadowBlocks, syncLogs } from '../db/index.js';
import logger from '../utils/logger.js';

const router = Router();

/** GET /api/calendar/availability - Get unified availability */
router.get('/availability', authenticate, apiLimiter, async (req, res) => {
  try {
    const { start, end } = req.query;
    const startDate = start ? new Date(start) : new Date();
    const endDate = end ? new Date(end) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const availability = await getAvailability(req.user.id, startDate, endDate);
    res.json({ success: true, ...availability });
  } catch (error) {
    logger.error('Availability fetch failed', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch availability' });
  }
});

/** GET /api/calendar/check-slot - Check if a slot is available */
router.get('/check-slot', authenticate, apiLimiter, async (req, res) => {
  try {
    const { start, end } = req.query;
    if (!start || !end) return res.status(400).json({ error: 'start and end required' });
    const available = await isSlotAvailable(req.user.id, start, end);
    res.json({ success: true, available });
  } catch (error) {
    res.status(500).json({ error: 'Failed to check slot' });
  }
});

/** POST /api/calendar/sync - Trigger a manual full sync */
router.post('/sync', authenticate, apiLimiter, async (req, res) => {
  try {
    res.json({ success: true, message: 'Sync started' });
    fullSync(req.user.id).catch(e => logger.error('Manual sync failed', { error: e.message }));
  } catch (error) {
    res.status(500).json({ error: 'Failed to start sync' });
  }
});

/** GET /api/calendar/events - Get user's synced events */
router.get('/events', authenticate, apiLimiter, async (req, res) => {
  try {
    const { start, end, limit = 50 } = req.query;
    const events = await calendarEvents.findByUser(req.user.id, {
      excludeCancelled: true,
      excludeSystemGenerated: true,
      startAfter: start,
      endBefore: end,
      limit: parseInt(limit),
    });

    // Enrich with identity info
    for (const event of events) {
      const identity = await identities.findById(event.identityId);
      event.identity = identity ? {
        providerType: identity.providerType,
        providerEmail: identity.providerEmail,
        calendarName: identity.calendarName,
      } : null;
    }

    res.json({ success: true, events, count: events.length });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

/** GET /api/calendar/shadow-blocks - Get active shadow blocks */
router.get('/shadow-blocks', authenticate, apiLimiter, async (req, res) => {
  try {
    const blocks = await shadowBlocks.findActiveByUser(req.user.id);
    res.json({ success: true, blocks, count: blocks.length });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch shadow blocks' });
  }
});

/** GET /api/calendar/sync-logs - Get sync history */
router.get('/sync-logs', authenticate, apiLimiter, async (req, res) => {
  try {
    const { limit = 50, action } = req.query;
    const logs = await syncLogs.findByUser(req.user.id, {
      limit: parseInt(limit),
      action,
    });
    res.json({ success: true, logs, count: logs.length });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch sync logs' });
  }
});

/** GET /api/user/profile */
router.get('/profile', authenticate, async (req, res) => {
  res.json({ success: true, user: req.user });
});

/** PATCH /api/user/settings */
router.patch('/settings', authenticate, async (req, res) => {
  try {
    const { conflictStrategy, autoSyncEnabled, timezone } = req.body;
    const updateData = {};
    if (conflictStrategy) updateData.conflictStrategy = conflictStrategy;
    if (typeof autoSyncEnabled === 'boolean') updateData.autoSyncEnabled = autoSyncEnabled;
    if (timezone) updateData.timezone = timezone;

    const user = await users.update(req.user.id, updateData);
    res.json({ success: true, user });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

/** GET /api/dashboard/stats */
router.get('/stats', authenticate, async (req, res) => {
  try {
    const [identityCount, eventCount, shadowCount, syncCount] = await Promise.all([
      identities.countActiveByUser(req.user.id),
      calendarEvents.countByUser(req.user.id, { status: 'CONFIRMED' }),
      shadowBlocks.countActiveByUser(req.user.id),
      syncLogs.countRecent(req.user.id, 24),
    ]);

    const recentLogs = await syncLogs.findByUser(req.user.id, { limit: 10 });

    res.json({
      success: true,
      stats: {
        connectedCalendars: identityCount,
        totalEvents: eventCount,
        activeShadowBlocks: shadowCount,
        syncsToday: syncCount,
      },
      recentActivity: recentLogs,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

export default router;
