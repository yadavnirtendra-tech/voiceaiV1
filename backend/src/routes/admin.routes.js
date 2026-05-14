import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { adminAuthenticate } from '../middleware/adminAuth.js';
import { users, identities, syncLogs } from '../db/index.js';
import prisma from '../db/prismaClient.js';
import logger from '../utils/logger.js';

const router = Router();

// Apply both middlewares to all routes here
router.use(authenticate);
router.use(adminAuthenticate);

/** GET /api/admin/users - List all users with stats */
router.get('/users', async (req, res) => {
  try {
    const allUsers = await prisma.user.findMany({
      include: {
        _count: {
          select: { identities: true, calendarEvents: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json({ success: true, users: allUsers });
  } catch (error) {
    logger.error('Admin users fetch failed', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

/** PATCH /api/admin/users/:id - Update user account/subscription */
router.patch('/users/:id', async (req, res) => {
  try {
    const { plan, subscriptionStatus, isAdmin } = req.body;
    const updatedUser = await users.update(req.params.id, {
      plan,
      subscriptionStatus,
      isAdmin
    });
    res.json({ success: true, user: updatedUser });
  } catch (error) {
    res.status(500).json({ error: 'Update failed' });
  }
});

/** POST /api/admin/users/:id/reset-password - Trigger reset */
router.post('/users/:id/reset-password', async (req, res) => {
  // In a real app, this would send an email. For now, we mock it.
  res.json({ success: true, message: 'Password reset link sent to user email' });
});

/** GET /api/admin/stats - Global SaaS Stats */
router.get('/stats', async (req, res) => {
  try {
    const [userCount, identityCount, syncCount] = await Promise.all([
      prisma.user.count(),
      prisma.identity.count(),
      prisma.syncLog.count({
        where: { startedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } }
      })
    ]);

    res.json({
      success: true,
      stats: {
        totalUsers: userCount,
        totalIdentities: identityCount,
        syncsLast24h: syncCount
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Stats failed' });
  }
});

export default router;
