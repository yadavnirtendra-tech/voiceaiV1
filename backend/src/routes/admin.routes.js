import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { adminAuthenticate } from '../middleware/adminAuth.js';
import { users, identities, syncLogs } from '../db/index.js';
import prisma from '../db/prismaClient.js';
import bcrypt from 'bcryptjs';
import logger from '../utils/logger.js';

const router = Router();

// Apply both middlewares to all routes here
router.use(authenticate);
router.use(adminAuthenticate);

/** GET /api/admin/settings - Get Platform Settings */
router.get('/settings', async (req, res) => {
  try {
    const { getPlatformSettings } = await import('../utils/platformSettings.js');
    res.json({ success: true, settings: getPlatformSettings() });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

/** PATCH /api/admin/settings - Update Platform Settings */
router.patch('/settings', async (req, res) => {
  try {
    const { systemLockdown } = req.body;
    const { updatePlatformSettings } = await import('../utils/platformSettings.js');
    const updated = updatePlatformSettings({ systemLockdown });
    res.json({ success: true, settings: updated });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

/** POST /api/admin/users - Manually create user */
router.post('/users', async (req, res) => {
  try {
    const { email, displayName, password, plan, isAdmin } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    
    const existing = await users.findByEmail(email);
    if (existing) return res.status(400).json({ error: 'Email already exists' });
    
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: {
        email,
        displayName: displayName || email.split('@')[0],
        passwordHash,
        plan: plan || 'PRO',
        isAdmin: isAdmin || false
      }
    });
    
    res.json({ success: true, user });
  } catch (error) {
    logger.error('Admin user creation failed', { error: error.message });
    res.status(500).json({ error: 'Failed to create user' });
  }
});

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
    const { email, displayName, plan, subscriptionStatus, isAdmin } = req.body;
    
    // Use prisma directly to allow updating email/displayName which might not be in users.update wrapper
    const updatedUser = await prisma.user.update({
      where: { id: req.params.id },
      data: {
        ...(email && { email }),
        ...(displayName && { displayName }),
        ...(plan && { plan }),
        ...(subscriptionStatus && { subscriptionStatus }),
        ...(isAdmin !== undefined && { isAdmin })
      }
    });
    
    res.json({ success: true, user: updatedUser });
  } catch (error) {
    res.status(500).json({ error: 'Update failed' });
  }
});

/** POST /api/admin/users/:id/reset-password - Force Reset to Temp Password */
router.post('/users/:id/reset-password', async (req, res) => {
  try {
    const tempPassword = 'OpenCalendar123!';
    const passwordHash = await bcrypt.hash(tempPassword, 12);
    
    await prisma.user.update({
      where: { id: req.params.id },
      data: { passwordHash }
    });
    
    res.json({ 
      success: true, 
      message: `Password has been reset to: ${tempPassword}. Please tell the user to change it upon login.` 
    });
  } catch (error) {
    logger.error('Admin password reset failed', { error: error.message });
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

/** DELETE /api/admin/users/:id - Delete User Account */
router.delete('/users/:id', async (req, res) => {
  try {
    await prisma.user.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: 'User permanently deleted' });
  } catch (error) {
    logger.error('Admin user delete failed', { error: error.message });
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

/** POST /api/admin/purge-all - Emergency Purge (deletes all non-admin users) */
router.post('/purge-all', async (req, res) => {
  try {
    const result = await prisma.user.deleteMany({
      where: { isAdmin: false }
    });
    res.json({ success: true, message: `Emergency purge complete. Deleted ${result.count} users.` });
  } catch (error) {
    logger.error('Emergency purge failed', { error: error.message });
    res.status(500).json({ error: 'Failed to purge users' });
  }
});

/** POST /api/admin/purge-test-users - Delete all 'testuser-*' accounts */
router.post('/purge-test-users', async (req, res) => {
  try {
    const result = await prisma.user.deleteMany({
      where: { email: { startsWith: 'testuser-' } }
    });
    res.json({ success: true, message: `Successfully deleted ${result.count} test users.` });
  } catch (error) {
    logger.error('Test user purge failed', { error: error.message });
    res.status(500).json({ error: 'Failed to purge test users' });
  }
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
