/**
 * Microsoft OAuth 2.0 Authentication Service
 * Handles authorization flow with MSAL for Microsoft Graph API
 * Uses Prisma/PostgreSQL for identity storage
 */
import * as msal from '@azure/msal-node';
import config from '../../config/env.js';
import { encrypt, decrypt } from '../../config/encryption.js';
import { identities, syncLogs } from '../../db/index.js';
import logger from '../../utils/logger.js';

// MSAL Configuration
const msalConfig = {
  auth: {
    clientId: config.microsoft.clientId,
    clientSecret: config.microsoft.clientSecret,
    authority: `https://login.microsoftonline.com/${config.microsoft.tenantId}`,
  },
  system: {
    loggerOptions: {
      loggerCallback: (level, message) => {
        if (level === msal.LogLevel.Error) logger.error('MSAL: ' + message);
      },
      piiLoggingEnabled: false,
      logLevel: msal.LogLevel.Error,
    },
  },
};

let msalClient = null;

function getMsalClient() {
  if (!msalClient) {
    msalClient = new msal.ConfidentialClientApplication(msalConfig);
  }
  return msalClient;
}

/**
 * Generate the Microsoft authorization URL
 * @param {string} state - HMAC-signed state parameter for CSRF protection
 * @returns {string} Authorization URL
 */
export function getAuthUrl(state) {
  const client = getMsalClient();

  const authCodeUrlParams = {
    scopes: config.microsoft.scopes,
    redirectUri: config.microsoft.redirectUri,
    state,
    prompt: 'consent',
  };

  return client.getAuthCodeUrl(authCodeUrlParams);
}

/**
 * Exchange authorization code for tokens and create/update identity
 * @param {string} code - Authorization code from callback
 * @param {string} userId - User ID
 * @returns {Object} Created/updated identity
 */
export async function handleCallback(code, userId) {
  const client = getMsalClient();

  // Exchange code for tokens
  const tokenResponse = await client.acquireTokenByCode({
    code,
    scopes: config.microsoft.scopes,
    redirectUri: config.microsoft.redirectUri,
  });

  const accessToken = tokenResponse.accessToken;

  // Get user info from Microsoft Graph
  const userInfoResponse = await fetch('https://graph.microsoft.com/v1.0/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const userInfo = await userInfoResponse.json();

  const email = userInfo.mail || userInfo.userPrincipalName;

  // Determine provider type
  const personalDomains = ['outlook.com', 'hotmail.com', 'live.com', 'msn.com'];
  const domain = email.split('@')[1]?.toLowerCase();
  const isPersonal = personalDomains.some(d => domain?.endsWith(d));
  const providerType = isPersonal ? 'MICROSOFT_PERSONAL' : 'MICROSOFT_365';

  // Encrypt tokens — each gets its own IV for AES-256-GCM security
  const accessTokenData = encrypt(accessToken);
  
  // Store the MSAL cache for token refresh (with its own IV)
  const cacheData = client.getTokenCache().serialize();
  const cacheEncrypted = encrypt(cacheData);
  // Store cache as "iv:ciphertext" so it carries its own IV
  const cacheCombined = `${cacheEncrypted.iv}:${cacheEncrypted.encrypted}`;

  // Get default calendar
  const calendarResponse = await fetch('https://graph.microsoft.com/v1.0/me/calendar', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const calendarInfo = await calendarResponse.json();

  // Upsert identity in database
  const identity = await identities.upsert(
    userId, providerType, email,
    // Create data
    {
      providerAccountId: userInfo.id,
      accessTokenEnc: accessTokenData.encrypted,
      refreshTokenEnc: cacheCombined,
      tokenIv: accessTokenData.iv,
      tokenExpiresAt: tokenResponse.expiresOn ? new Date(tokenResponse.expiresOn) : null,
      calendarId: calendarInfo.id,
      calendarName: calendarInfo.name || 'Calendar',
    },
    // Update data
    {
      accessTokenEnc: accessTokenData.encrypted,
      refreshTokenEnc: cacheCombined,
      tokenIv: accessTokenData.iv,
      tokenExpiresAt: tokenResponse.expiresOn ? new Date(tokenResponse.expiresOn) : null,
      isActive: true,
      calendarId: calendarInfo.id,
      calendarName: calendarInfo.name || 'Calendar',
    }
  );

  logger.info('Microsoft identity connected', {
    userId,
    email,
    providerType,
    identityId: identity.id,
  });

  return identity;
}

/**
 * Get a valid access token for Microsoft Graph API calls
 * Automatically refreshes using MSAL's built-in token cache
 * @param {Object} identity - Identity record from database
 * @returns {string} Valid access token
 */
export async function getAccessToken(identity) {
  const client = getMsalClient();

  // Try to get token silently from cache
  const accessToken = decrypt(identity.accessTokenEnc, identity.tokenIv);
  const now = Date.now();
  const expiresAt = identity.tokenExpiresAt ? new Date(identity.tokenExpiresAt).getTime() : 0;
  const bufferMs = 5 * 60 * 1000;

  if (expiresAt - now > bufferMs) {
    return accessToken;
  }

  // Token is expiring, try to refresh via MSAL cache
  try {
    if (identity.refreshTokenEnc) {
      // MSAL cache stores its own IV as "iv:ciphertext"
      const parts = identity.refreshTokenEnc.split(':');
      let cachedData;
      if (parts.length === 2) {
        cachedData = decrypt(parts[1], parts[0]);
      } else {
        // Legacy format: try with access token IV as fallback
        cachedData = decrypt(identity.refreshTokenEnc, identity.tokenIv);
      }
      if (cachedData) {
        client.getTokenCache().deserialize(cachedData);
      }
    }

    const accounts = await client.getTokenCache().getAllAccounts();
    if (accounts.length > 0) {
      const silentResult = await client.acquireTokenSilent({
        scopes: config.microsoft.scopes,
        account: accounts[0],
      });

      if (silentResult) {
        // Update stored tokens in database
        const newAccessTokenData = encrypt(silentResult.accessToken);
        const newCacheData = encrypt(client.getTokenCache().serialize());

        await identities.update(identity.id, {
          accessTokenEnc: newAccessTokenData.encrypted,
          refreshTokenEnc: `${newCacheData.iv}:${newCacheData.encrypted}`,
          tokenIv: newAccessTokenData.iv,
          tokenExpiresAt: silentResult.expiresOn ? new Date(silentResult.expiresOn) : null,
        });

        await syncLogs.create({
          userId: identity.userId,
          identityId: identity.id,
          action: 'TOKEN_REFRESHED',
          status: 'COMPLETED',
          providerType: identity.providerType,
          completedAt: new Date(),
        });

        logger.debug('Microsoft token refreshed', { identityId: identity.id });
        return silentResult.accessToken;
      }
    }
  } catch (error) {
    logger.error('Microsoft token refresh failed', {
      identityId: identity.id,
      error: error.message,
    });
  }

  // If all else fails, return the existing token
  return accessToken;
}
