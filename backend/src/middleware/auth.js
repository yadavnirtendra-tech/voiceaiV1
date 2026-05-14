/**
 * JWT Authentication Middleware
 * Validates JWT tokens from cookies or Authorization header
 * Uses Prisma/PostgreSQL for user lookups
 */
import jwt from 'jsonwebtoken';
import config from '../config/env.js';
import { users, identities } from '../db/index.js';
import logger from '../utils/logger.js';

export async function authenticate(req, res, next) {
  try {
    // Extract token from cookie or Authorization header
    let token = req.cookies?.auth_token;
    
    if (!token) {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        token = authHeader.substring(7);
      }
    }

    if (!token) {
      return res.status(401).json({ 
        error: 'Authentication required',
        message: 'Please connect a calendar to get started',
      });
    }

    // Verify JWT
    const decoded = jwt.verify(token, config.jwt.secret);
    
    // Fetch user with active identities from Firestore
    const user = await users.findWithIdentities(decoded.userId);

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
    }
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token' });
    }
    logger.error('Auth middleware error', { error: error.message });
    return res.status(500).json({ error: 'Authentication error' });
  }
}

/**
 * Optional auth - doesn't fail if no token, just sets req.user to null
 */
export async function optionalAuth(req, res, next) {
  try {
    let token = req.cookies?.auth_token;
    if (!token) {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        token = authHeader.substring(7);
      }
    }

    if (token) {
      const decoded = jwt.verify(token, config.jwt.secret);
      req.user = await users.findById(decoded.userId);
    } else {
      req.user = null;
    }
    next();
  } catch {
    req.user = null;
    next();
  }
}

/**
 * Generate a JWT token for a user
 */
export function generateToken(userId) {
  return jwt.sign({ userId }, config.jwt.secret, { expiresIn: config.jwt.expiresIn });
}
