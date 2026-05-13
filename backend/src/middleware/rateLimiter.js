/**
 * Rate Limiter Middleware
 * Prevents API abuse with configurable windows and limits
 */
import rateLimit from 'express-rate-limit';

// General API rate limiter
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: {
    error: 'Too many requests',
    message: 'Please try again in 15 minutes',
    retryAfter: 900,
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// OAuth endpoint rate limiter (stricter)
export const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20,
  message: {
    error: 'Too many authentication attempts',
    message: 'Please try again in an hour',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Webhook rate limiter (more permissive for provider callbacks)
export const webhookLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 500,
  message: { error: 'Webhook rate limit exceeded' },
  standardHeaders: true,
  legacyHeaders: false,
});
