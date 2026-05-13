/**
 * Google OAuth 2.0 Authentication Service
 * Handles authorization flow, token exchange, and token refresh
 * Uses Firestore for identity storage
 */
import { google } from 'googleapis';
import config from '../../config/env.js';
import { encrypt, decrypt } from '../../config/encryption.js';
import { identities, syncLogs } from '../../db/index.js';
import logger from '../../utils/logger.js';

/**
 * Create a Google OAuth2 client
 */
export function createOAuth2Client() {
  return new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    config.google.redirectUri,
  );
}

/**
 * Generate the Google authorization URL
 * @param {string} userId - The user ID to include in state
 * @returns {string} Authorization URL
 */
export function getAuthUrl(userId) {
  const oauth2Client = createOAuth2Client();
  
  const state = Buffer.from(JSON.stringify({
    userId,
    provider: 'google',
    timestamp: Date.now(),
  })).toString('base64');

  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: config.google.scopes,
    state,
    prompt: 'consent', // Force consent to get refresh token
    include_granted_scopes: true,
  });
}

/**
 * Exchange authorization code for tokens and create/update identity
 * @param {string} code - Authorization code from callback
 * @param {string} userId - User ID
 * @returns {Object} Created/updated identity
 */
export async function handleCallback(code, userId) {
  const oauth2Client = createOAuth2Client();
  
  // Exchange code for tokens
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);

  // Get user info from Google
  const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
  const { data: userInfo } = await oauth2.userinfo.get();

  // Determine provider type
  const email = userInfo.email;
  const isWorkspace = !email.endsWith('@gmail.com') && !email.endsWith('@googlemail.com');
  const providerType = isWorkspace ? 'GOOGLE_WORKSPACE' : 'GOOGLE_PERSONAL';

  // Encrypt tokens
  const accessTokenData = encrypt(tokens.access_token);
  const refreshTokenData = tokens.refresh_token ? encrypt(tokens.refresh_token) : { encrypted: '', iv: '' };

  // Get the primary calendar ID
  const calendarService = google.calendar({ version: 'v3', auth: oauth2Client });
  const { data: calendarList } = await calendarService.calendarList.list();
  const primaryCalendar = calendarList.items.find(c => c.primary) || calendarList.items[0];

  // Upsert identity in Firestore
  const identity = await identities.upsert(
    userId, providerType, email,
    // Create data
    {
      providerAccountId: userInfo.id,
      accessTokenEnc: accessTokenData.encrypted,
      refreshTokenEnc: refreshTokenData.encrypted,
      tokenIv: accessTokenData.iv,
      tokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
      calendarId: primaryCalendar?.id || 'primary',
      calendarName: primaryCalendar?.summary || 'Primary Calendar',
    },
    // Update data
    {
      accessTokenEnc: accessTokenData.encrypted,
      refreshTokenEnc: refreshTokenData.encrypted || undefined,
      tokenIv: accessTokenData.iv,
      tokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
      isActive: true,
      calendarId: primaryCalendar?.id || 'primary',
      calendarName: primaryCalendar?.summary || 'Primary Calendar',
    }
  );

  logger.info('Google identity connected', { 
    userId, 
    email, 
    providerType, 
    identityId: identity.id,
  });

  return identity;
}

/**
 * Get an authenticated OAuth2 client for a given identity
 * Automatically refreshes expired tokens
 * @param {Object} identity - Identity record from database
 * @returns {Object} Authenticated OAuth2 client
 */
export async function getAuthenticatedClient(identity) {
  const oauth2Client = createOAuth2Client();
  
  const accessToken = decrypt(identity.accessTokenEnc, identity.tokenIv);
  const refreshToken = identity.refreshTokenEnc ? decrypt(identity.refreshTokenEnc, identity.tokenIv) : null;

  oauth2Client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
    expiry_date: identity.tokenExpiresAt ? new Date(identity.tokenExpiresAt).getTime() : undefined,
  });

  // Check if token needs refresh
  const now = Date.now();
  const expiresAt = identity.tokenExpiresAt ? new Date(identity.tokenExpiresAt).getTime() : 0;
  const bufferMs = 5 * 60 * 1000; // 5 minutes buffer

  if (expiresAt - now < bufferMs && refreshToken) {
    try {
      const { credentials } = await oauth2Client.refreshAccessToken();
      
      // Update stored tokens in Firestore
      const newAccessTokenData = encrypt(credentials.access_token);
      const updateData = {
        accessTokenEnc: newAccessTokenData.encrypted,
        tokenIv: newAccessTokenData.iv,
        tokenExpiresAt: credentials.expiry_date ? new Date(credentials.expiry_date).toISOString() : null,
      };

      if (credentials.refresh_token) {
        const newRefreshData = encrypt(credentials.refresh_token);
        updateData.refreshTokenEnc = newRefreshData.encrypted;
      }

      await identities.update(identity.id, updateData);

      // Log token refresh
      await syncLogs.create({
        userId: identity.userId,
        identityId: identity.id,
        action: 'TOKEN_REFRESHED',
        status: 'COMPLETED',
        providerType: identity.providerType,
        completedAt: new Date(),
      });

      logger.debug('Google token refreshed', { identityId: identity.id });
    } catch (error) {
      logger.error('Google token refresh failed', { 
        identityId: identity.id, 
        error: error.message,
      });
      throw error;
    }
  }

  return oauth2Client;
}
